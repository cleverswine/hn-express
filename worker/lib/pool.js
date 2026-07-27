'use strict';

/**
 * Run fn over items with at most `limit` in flight at once.
 * Results are returned in the same order as items.
 */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function runWorker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, runWorker);
  await Promise.all(workers);
  return results;
}

module.exports = { mapPool };
