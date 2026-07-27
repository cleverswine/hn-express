'use strict';

require('../lib/prefer-ipv4');

const { summarizeBatch } = require('../summarize');
const { log, logError } = require('../lib/log');

const BATCH_SIZE = Number(process.env.SUMMARY_BATCH_SIZE) || 5;

async function main() {
  let total = 0;
  while (true) {
    const n = await summarizeBatch(BATCH_SIZE);
    if (n === 0) break;
    total += n;
  }
  log(`[summarize:once] processed ${total} stories`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError('[summarize:once] failed:', err);
    process.exit(1);
  });
