'use strict';

const path = require('node:path');
const express = require('express');
const db = require('db');
const { renderPage, renderArchivePage } = require('./render');
const { log } = require('./lib/log');

const PORT = Number(process.env.PORT) || 3000;
const HN_FRONTPAGE_SIZE = Number(process.env.HN_FRONTPAGE_SIZE) || 30;
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

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  const stories = db.getFrontPage(HN_FRONTPAGE_SIZE);
  res.type('html').send(renderPage(stories));
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
