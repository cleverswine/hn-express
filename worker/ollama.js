'use strict';

const { log } = require('./lib/log');

// Use the literal loopback IP, not the 'localhost' hostname — resolving
// 'localhost' can land on the IPv6 loopback (::1) on machines where that
// route is broken/unavailable, even though Ollama only listens on IPv4.
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3.2';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 120000;
const GENERATE_URL = `${OLLAMA_HOST}/api/generate`;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  log(`[ollama] requesting summary from ${GENERATE_URL} (model ${OLLAMA_MODEL})`);
  try {
    const res = await fetch(GENERATE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        stream: false,
        prompt: buildPrompt(title, text),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Ollama HTTP ${res.status} from ${GENERATE_URL}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const summary = (data.response || '').trim();
    if (!summary) throw new Error(`Ollama returned an empty response from ${GENERATE_URL}`);
    return summary;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`Ollama request to ${GENERATE_URL} timed out after ${OLLAMA_TIMEOUT_MS}ms`);
    }
    if (err.message.includes(GENERATE_URL)) throw err;
    throw new Error(`Ollama request to ${GENERATE_URL} failed: ${err.message}`, { cause: err.cause || err });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { summarizeText, OLLAMA_MODEL };
