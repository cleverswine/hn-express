'use strict';

require('../lib/prefer-ipv4');

const db = require('db');
const { log, logError } = require('../lib/log');

const CLEANUP_MAX_AGE_DAYS = Number(process.env.CLEANUP_MAX_AGE_DAYS) || 14;

async function main() {
  const cutoff = Math.floor(Date.now() / 1000) - CLEANUP_MAX_AGE_DAYS * 24 * 60 * 60;
  const deleted = db.deleteOldStories(cutoff);
  log(`[cleanup:once] deleted ${deleted} stor${deleted === 1 ? 'y' : 'ies'} older than ${CLEANUP_MAX_AGE_DAYS} days`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logError('[cleanup:once] failed:', err);
    process.exit(1);
  });
