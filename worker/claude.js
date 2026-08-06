'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const { log } = require('./lib/log');

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'claude-haiku-4-5';
const CLAUDE_TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS) || 60000;
const MAX_SUMMARY_TOKENS = 300;

const client = new Anthropic({ timeout: CLAUDE_TIMEOUT_MS });

function buildPrompt(title, text) {
  return [
    'Summarize the following article in 2-3 concise, neutral sentences for a Hacker News reader.',
    'Reply with only the summary itself — no preamble like "This article is about".',
    '',
    `Title: ${title || '(untitled)'}`,
    '',
    'Content:',
    text,
    '',
    'Summary:',
  ].join('\n');
}

async function summarizeText(title, text) {
  log(`[claude] requesting summary from Claude (model ${CLAUDE_MODEL})`);
  try {
    const res = await client.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: MAX_SUMMARY_TOKENS,
      messages: [{ role: 'user', content: buildPrompt(title, text) }],
    });
    if (res.stop_reason === 'refusal') {
      throw new Error('Claude refused to summarize this article (stop_reason: refusal)');
    }
    const textBlock = res.content.find((b) => b.type === 'text');
    const summary = (textBlock?.text || '').trim();
    if (!summary) throw new Error('Claude returned an empty summary');
    return summary;
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      throw new Error(`Claude request failed (${err.status ?? 'network'}): ${err.message}`, { cause: err });
    }
    throw err;
  }
}

module.exports = { summarizeText, CLAUDE_MODEL };
