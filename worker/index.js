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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function main() {
  log('[worker] starting hn-express worker');
  if (RETRY_FAILED_ON_START) {
    const requeued = db.requeueFailed();
    log(`[worker] --retry-failed: requeued ${requeued} failed stor${requeued === 1 ? 'y' : 'ies'} for retry`);
  }
  await Promise.all([fetchLoop(), summarizeLoop()]);
}

main().catch((err) => {
  logError('[worker] fatal error:', err);
  process.exit(1);
});
