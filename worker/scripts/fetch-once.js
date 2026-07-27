'use strict';

require('../lib/prefer-ipv4');

const { fetchFrontPage } = require('../hn');
const { log, logError } = require('../lib/log');

fetchFrontPage()
  .then((n) => {
    log(`[fetch:once] stored ${n} stories`);
    process.exit(0);
  })
  .catch((err) => {
    logError('[fetch:once] failed:', err);
    process.exit(1);
  });
