'use strict';

// Node's fetch collapses network-level failures (DNS, connection refused,
// etc.) into a generic "TypeError: fetch failed" and tucks the actual reason
// away in `.cause` — surface that, since the bare message alone is useless.
function describeError(err) {
  const cause = err.cause ? (err.cause.code || err.cause.message || String(err.cause)) : null;
  return cause ? `${err.message} (cause: ${cause})` : err.message;
}

module.exports = { describeError };
