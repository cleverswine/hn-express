'use strict';

require('./lib/prefer-ipv4');

const db = require('db');
const { fetchFrontPage } = require('./hn');
const { summarizeBatch } = require('./summarize');
const { log, logError } = require('./lib/log');

const FETCH_INTERVAL_MS = Number(process.env.FETCH_INTERVAL_MS) || 15 * 60 * 1000;
const SUMMARY_BATCH_SIZE = Number(process.env.SUMMARY_BATCH_SIZE) || 5;
const SUMMARY_IDLE_SLEEP_MS = Number(process.env.SUMMARY_IDLE_SLEEP_MS) || 15000;
const RETRY_FAILED_ON_START = process.argv.includes('--retry-failed') || process.env.RETRY_FAILED === 'true';
const CLEANUP_INTERVAL_MS = Number(process.env.CLEANUP_INTERVAL_MS) || 24 * 60 * 60 * 1000;
const CLEANUP_MAX_AGE_DAYS = Number(process.env.CLEANUP_MAX_AGE_DAYS) || 14;

// Summarization is the only thing that hits Ollama, so it's the only loop
// gated to active hours (local time, per TZ) — no point burning home-server
// GPU time summarizing stories overnight when nobody's reading them.
const ACTIVE_HOURS_START = Number(process.env.ACTIVE_HOURS_START ?? 7);
const ACTIVE_HOURS_END = Number(process.env.ACTIVE_HOURS_END ?? 23);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isActiveNow() {
  if (ACTIVE_HOURS_START === ACTIVE_HOURS_END) return true;
  const hour = new Date().getHours();
  if (ACTIVE_HOURS_START < ACTIVE_HOURS_END) {
    return hour >= ACTIVE_HOURS_START && hour < ACTIVE_HOURS_END;
  }
  return hour >= ACTIVE_HOURS_START || hour < ACTIVE_HOURS_END;
}

function msUntilActive() {
  const now = new Date();
  const start = new Date(now);
  start.setHours(ACTIVE_HOURS_START, 0, 0, 0);
  if (start <= now) start.setDate(start.getDate() + 1);
  return start - now;
}

async function fetchLoop() {
  while (true) {
    try {
      const n = await fetchFrontPage();
      log(`[fetch] refreshed front page (${n} stories)`);
    } catch (err) {
      logError('[fetch] failed:', err);
    }
    await sleep(FETCH_INTERVAL_MS);
  }
}

async function summarizeLoop() {
  while (true) {
    if (!isActiveNow()) {
      const wait = msUntilActive();
      log(
        `[summarize] outside active hours (${ACTIVE_HOURS_START}:00-${ACTIVE_HOURS_END}:00) — sleeping ${Math.round(
          wait / 60000
        )} min`
      );
      await sleep(wait);
      continue;
    }
    let processed = 0;
    try {
      processed = await summarizeBatch(SUMMARY_BATCH_SIZE);
    } catch (err) {
      logError('[summarize] batch failed:', err);
    }
    if (processed === 0) {
      await sleep(SUMMARY_IDLE_SLEEP_MS);
    }
  }
}

async function cleanupLoop() {
  while (true) {
    try {
      const cutoff = Math.floor(Date.now() / 1000) - CLEANUP_MAX_AGE_DAYS * 24 * 60 * 60;
      const deleted = db.deleteOldStories(cutoff);
      log(`[cleanup] deleted ${deleted} stor${deleted === 1 ? 'y' : 'ies'} older than ${CLEANUP_MAX_AGE_DAYS} days`);
    } catch (err) {
      logError('[cleanup] failed:', err);
    }
    await sleep(CLEANUP_INTERVAL_MS);
  }
}

async function main() {
  log('[worker] starting hn-express worker');
  if (RETRY_FAILED_ON_START) {
    const requeued = db.requeueFailed();
    log(`[worker] --retry-failed: requeued ${requeued} failed stor${requeued === 1 ? 'y' : 'ies'} for retry`);
  }
  await Promise.all([fetchLoop(), summarizeLoop(), cleanupLoop()]);
}

main().catch((err) => {
  logError('[worker] fatal error:', err);
  process.exit(1);
});
