'use strict';

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';

/**
 * Config snapshot for the admin page. There's no runtime endpoint to ping
 * for a hosted API — just report what's configured. Never expose the key
 * value itself, only whether it's set.
 */
function getClaudeStatus() {
  return { model: CLAUDE_MODEL, apiKeySet: Boolean(process.env.ANTHROPIC_API_KEY) };
}

module.exports = { getClaudeStatus, CLAUDE_MODEL };
