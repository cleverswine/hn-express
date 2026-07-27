'use strict';

const db = require('db');
const { mapPool } = require('./lib/pool');
const { describeError } = require('./lib/errors');
const { log, logError } = require('./lib/log');

const HN_BASE = 'https://hacker-news.firebaseio.com/v0';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;
const HN_FRONTPAGE_SIZE = Number(process.env.HN_FRONTPAGE_SIZE) || 30;
const HN_FETCH_CONCURRENCY = 10;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    try {
      return await res.json();
    } catch (err) {
      throw new Error(`invalid JSON from ${url}: ${err.message}`);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`timed out after ${FETCH_TIMEOUT_MS}ms fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the current HN front page (topstories, in HN's own rank order) and
 * store it to the database. Returns the number of stories stored.
 */
async function fetchFrontPage() {
  const startedAt = Date.now();
  const listUrl = `${HN_BASE}/topstories.json`;

  let ids;
  try {
    ids = await fetchJson(listUrl);
  } catch (err) {
    logError(`[hn] failed to fetch top stories list from ${listUrl}: ${describeError(err)}`);
    throw err;
  }

  const topIds = ids.slice(0, HN_FRONTPAGE_SIZE);
  log(`[hn] fetching ${topIds.length} story items (of ${ids.length} on the live front page)`);

  const failedIds = [];
  const items = await mapPool(topIds, HN_FETCH_CONCURRENCY, async (id) => {
    const itemUrl = `${HN_BASE}/item/${id}.json`;
    const itemStartedAt = Date.now();
    try {
      return await fetchJson(itemUrl);
    } catch (err) {
      failedIds.push(id);
      const elapsed = Date.now() - itemStartedAt;
      logError(`[hn] failed to fetch item ${id} after ${elapsed}ms (${itemUrl}): ${describeError(err)}`);
      return null;
    }
  });

  const withRank = items
    .map((item, idx) => (item && !item.deleted && !item.dead ? { ...item, rank: idx + 1 } : null))
    .filter(Boolean);

  const elapsedMs = Date.now() - startedAt;
  const failedNote = failedIds.length ? `, ${failedIds.length} item fetch(es) failed: ${failedIds.join(', ')}` : '';
  log(`[hn] stored ${withRank.length}/${topIds.length} stories in ${elapsedMs}ms${failedNote}`);

  db.upsertFrontPage(withRank);
  return withRank.length;
}

module.exports = { fetchFrontPage };
