'use strict';

const { JSDOM } = require('jsdom');
const db = require('db');
const { mapPool } = require('./lib/pool');
const { extractArticle, downloadImage } = require('./extract');
const { summarizeText, OLLAMA_MODEL } = require('./ollama');
const { describeError } = require('./lib/errors');
const { log, logError } = require('./lib/log');

const MIN_TEXT_LENGTH = 40;
const MAX_SELFPOST_CHARS = 6000;

function extractSelfPostText(html) {
  const dom = new JSDOM(`<div>${html}</div>`);
  return dom.window.document.body.textContent.replace(/\s+/g, ' ').trim();
}

async function summarizeOne(story) {
  db.markProcessing(story.id);
  const startedAt = Date.now();
  try {
    let text;
    let imageUrl = null;

    if (story.url) {
      const extracted = await extractArticle(story.url);
      text = extracted.text;
      imageUrl = extracted.imageUrl;
    } else if (story.text) {
      text = extractSelfPostText(story.text).slice(0, MAX_SELFPOST_CHARS);
    } else {
      db.markSkipped(story.id);
      return { id: story.id, status: 'skipped' };
    }

    if (!text || text.length < MIN_TEXT_LENGTH) {
      db.markSkipped(story.id);
      return { id: story.id, status: 'skipped' };
    }

    const summary = await summarizeText(story.title, text);
    const image = await downloadImage(imageUrl);
    db.saveSummary(story.id, {
      summary,
      imageData: image?.data,
      imageType: image?.contentType,
      model: OLLAMA_MODEL,
    });
    return { id: story.id, status: 'done' };
  } catch (err) {
    const message = describeError(err);
    logError(
      `[summarize] story ${story.id} (${story.url || 'self-post'}) failed after ${Date.now() - startedAt}ms: ${message}`
    );
    db.markFailed(story.id, message);
    return { id: story.id, status: 'failed', error: message };
  }
}

/**
 * Pull up to `limit` pending stories and summarize them (bounded concurrency).
 * Returns the number of stories that were picked up in this batch.
 */
async function summarizeBatch(limit) {
  const pending = db.getPending(limit);
  if (pending.length === 0) return 0;

  const startedAt = Date.now();
  const concurrency = Number(process.env.SUMMARY_CONCURRENCY) || 2;
  const results = await mapPool(pending, concurrency, summarizeOne);

  for (const r of results) {
    log(`[summarize] story ${r.id}: ${r.status}${r.error ? ` — ${r.error}` : ''}`);
  }

  const counts = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  const countsNote = Object.entries(counts)
    .map(([status, n]) => `${n} ${status}`)
    .join(', ');
  log(`[summarize] batch of ${pending.length} finished in ${Date.now() - startedAt}ms — ${countsNote}`);

  return pending.length;
}

module.exports = { summarizeBatch, summarizeOne };
