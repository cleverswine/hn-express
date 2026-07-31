'use strict';

const path = require('node:path');
const express = require('express');
const db = require('db');
const { renderPage, renderArchivePage, renderAdminPage } = require('./render');
const { getOllamaStatus } = require('./lib/ollama-status');
const { log } = require('./lib/log');

const PORT = Number(process.env.PORT) || 3000;
const HN_FRONTPAGE_SIZE = Number(process.env.HN_FRONTPAGE_SIZE) || 30;
const UNREAD_HISTORY_DAYS = 7;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function formatDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Parses as local midnight (per TZ) so archive days line up with how the
// worker's first_seen_at timestamps read on a wall clock.
function parseDate(str) {
  if (!DATE_RE.test(str)) return null;
  const [y, m, d] = str.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function envOr(name, fallback) {
  return process.env[name] !== undefined ? process.env[name] : String(fallback);
}

// Settings are read straight from process.env with the same defaults the
// worker and db packages use — the web and worker processes share one .env,
// so this reflects what's actually configured even though most of these
// only affect the worker.
function buildSettings() {
  return [
    { section: 'Web server', items: [{ key: 'PORT', value: envOr('PORT', 3000) }] },
    {
      section: 'Shared',
      items: [
        { key: 'DB_PATH', value: db.getDbPath() },
        { key: 'HN_FRONTPAGE_SIZE', value: envOr('HN_FRONTPAGE_SIZE', 30) },
        { key: 'TZ', value: envOr('TZ', '(system default)') },
      ],
    },
    {
      section: 'Worker: HN polling',
      items: [
        { key: 'FETCH_INTERVAL_MS', value: envOr('FETCH_INTERVAL_MS', 900000) },
        { key: 'FETCH_TIMEOUT_MS', value: envOr('FETCH_TIMEOUT_MS', 10000) },
      ],
    },
    {
      section: 'Worker: article extraction',
      items: [
        { key: 'PLAYWRIGHT_TIMEOUT_MS', value: envOr('PLAYWRIGHT_TIMEOUT_MS', 20000) },
        { key: 'IMAGE_FETCH_TIMEOUT_MS', value: envOr('IMAGE_FETCH_TIMEOUT_MS', 10000) },
      ],
    },
    {
      section: 'Worker: summarization',
      items: [
        { key: 'SUMMARY_BATCH_SIZE', value: envOr('SUMMARY_BATCH_SIZE', 5) },
        { key: 'SUMMARY_CONCURRENCY', value: envOr('SUMMARY_CONCURRENCY', 2) },
        { key: 'SUMMARY_IDLE_SLEEP_MS', value: envOr('SUMMARY_IDLE_SLEEP_MS', 15000) },
        { key: 'ACTIVE_HOURS_START', value: envOr('ACTIVE_HOURS_START', 7) },
        { key: 'ACTIVE_HOURS_END', value: envOr('ACTIVE_HOURS_END', 23) },
      ],
    },
    {
      section: 'Worker: Ollama',
      items: [
        { key: 'OLLAMA_HOST', value: envOr('OLLAMA_HOST', 'http://127.0.0.1:11434') },
        { key: 'OLLAMA_MODEL', value: envOr('OLLAMA_MODEL', 'llama3.2') },
        { key: 'OLLAMA_TIMEOUT_MS', value: envOr('OLLAMA_TIMEOUT_MS', 120000) },
      ],
    },
  ];
}

// Unread vs. total story counts for each of the past UNREAD_HISTORY_DAYS
// days (including today), newest first — grouped by local day the same way
// the archive splits history, via first_seen_at.
function getUnreadByDay() {
  const todayMidnight = new Date(new Date().setHours(0, 0, 0, 0));
  const days = [];
  for (let i = 0; i < UNREAD_HISTORY_DAYS; i++) {
    const dayStart = addDays(todayMidnight, -i);
    const startSec = Math.floor(dayStart.getTime() / 1000);
    const endSec = startSec + 86400;
    const { total, unread } = db.getStoryCountsByDay(startSec, endSec);
    days.push({ date: formatDate(dayStart), total, unread });
  }
  return days;
}

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const stories = db.getFrontPage(HN_FRONTPAGE_SIZE);
  res.type('html').send(renderPage(stories));
});

app.post('/read-all', (req, res) => {
  const stories = db.getFrontPage(HN_FRONTPAGE_SIZE);
  db.markRead(stories.map((s) => s.id));
  res.redirect('/');
});

app.get('/archive', (req, res) => {
  res.redirect(`/archive/${formatDate(new Date())}`);
});

app.get('/archive/:date', (req, res) => {
  const date = parseDate(req.params.date);
  if (!date) return res.status(404).send('Not found');

  const startSec = Math.floor(date.getTime() / 1000);
  const endSec = startSec + 86400;
  const stories = db.getHistoryDay(startSec, endSec);

  const dateStr = formatDate(date);
  const today = formatDate(new Date());
  res.type('html').send(
    renderArchivePage({
      date: dateStr,
      stories,
      prevDate: formatDate(addDays(date, -1)),
      nextDate: dateStr < today ? formatDate(addDays(date, 1)) : null,
    })
  );
});

app.post('/archive/:date/read-all', (req, res) => {
  const date = parseDate(req.params.date);
  if (!date) return res.status(404).send('Not found');

  const startSec = Math.floor(date.getTime() / 1000);
  const endSec = startSec + 86400;
  const stories = db.getHistoryDay(startSec, endSec);
  db.markRead(stories.map((s) => s.id));
  res.redirect(`/archive/${req.params.date}`);
});

app.get('/admin', async (req, res) => {
  const settings = buildSettings();
  const unreadByDay = getUnreadByDay();
  const summaryStats = db.getSummaryStatusCounts();
  const ollama = await getOllamaStatus();
  res.type('html').send(renderAdminPage({ settings, unreadByDay, summaryStats, ollama }));
});

app.get('/image/:id', (req, res) => {
  const id = Number(req.params.id);
  const image = Number.isInteger(id) ? db.getImage(id) : null;
  if (!image?.image_data) return res.status(404).end();

  res.set('Content-Type', image.image_type || 'application/octet-stream');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(Buffer.from(image.image_data));
});

app.listen(PORT, () => {
  log(`[web] listening on http://localhost:${PORT}`);
});
