'use strict';

const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const { describeError } = require('./lib/errors');
const { logError } = require('./lib/log');

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS) || 10000;
const PLAYWRIGHT_TIMEOUT_MS = Number(process.env.PLAYWRIGHT_TIMEOUT_MS) || 20000;
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS) || 10000;
const MAX_CONTENT_CHARS = 6000;
const MIN_TEXT_LENGTH = 200;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function resolveUrl(candidate, base) {
  if (!candidate) return null;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

function extractFromHtml(html, url) {
  const dom = new JSDOM(html, { url });
  const doc = dom.window.document;

  const metaImage =
    doc.querySelector('meta[property="og:image"]')?.getAttribute('content') ||
    doc.querySelector('meta[name="twitter:image"]')?.getAttribute('content') ||
    null;

  let text = null;
  let readerImage = null;
  try {
    const article = new Readability(new JSDOM(html, { url }).window.document).parse();
    if (article?.textContent) {
      text = article.textContent.replace(/\s+/g, ' ').trim();
    }
    if (article?.content) {
      const img = new JSDOM(article.content).window.document.querySelector('img');
      readerImage = img?.getAttribute('src') || null;
    }
  } catch {
    // Readability can throw on unusual markup; fall back to raw body text below.
  }

  if (!text) {
    text = doc.body?.textContent?.replace(/\s+/g, ' ').trim() || '';
  }

  const imageUrl = resolveUrl(metaImage, url) || resolveUrl(readerImage, url);

  return { text: text.slice(0, MAX_CONTENT_CHARS), imageUrl };
}

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      throw new Error(`unsupported content-type '${contentType || 'unknown'}' for ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`timed out after ${FETCH_TIMEOUT_MS}ms fetching ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function extractWithPlaywright(url) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ userAgent: USER_AGENT });
    await page.goto(url, { timeout: PLAYWRIGHT_TIMEOUT_MS, waitUntil: 'domcontentloaded' });
    const html = await page.content();
    return extractFromHtml(html, url);
  } finally {
    await browser.close();
  }
}

/**
 * Download a representative image so it can be stored in-row and served
 * without depending on the source site staying reachable. Returns null
 * (rather than throwing) for anything that isn't a reasonably-sized image,
 * since the image is a nice-to-have alongside the summary, not required.
 */
async function downloadImage(url) {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': USER_AGENT, Accept: 'image/*' },
    });
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) return null;

    const contentLength = Number(res.headers.get('content-length') || 0);
    if (contentLength > MAX_IMAGE_BYTES) return null;

    const data = Buffer.from(await res.arrayBuffer());
    if (data.length === 0 || data.length > MAX_IMAGE_BYTES) return null;

    return { data, contentType };
  } catch (err) {
    logError(`[extract] failed to download image ${url}: ${describeError(err)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract main article text + a representative image from a URL. Tries a
 * plain fetch first; falls back to a headless-browser render (Playwright)
 * when the fetch fails or yields suspiciously little text (JS-rendered or
 * blocked pages).
 */
async function extractArticle(url) {
  const fetchStartedAt = Date.now();
  try {
    const html = await fetchHtml(url);
    const result = extractFromHtml(html, url);
    if (result.text.length >= MIN_TEXT_LENGTH) {
      return { ...result, source: 'fetch' };
    }
    logError(
      `[extract] fetch for ${url} returned only ${result.text.length} chars (need ${MIN_TEXT_LENGTH}) ` +
        `after ${Date.now() - fetchStartedAt}ms — falling back to Playwright`
    );
  } catch (err) {
    logError(
      `[extract] plain fetch failed for ${url} after ${Date.now() - fetchStartedAt}ms: ${describeError(err)} ` +
        `— falling back to Playwright`
    );
  }

  const playwrightStartedAt = Date.now();
  try {
    const result = await extractWithPlaywright(url);
    return { ...result, source: 'playwright' };
  } catch (err) {
    logError(
      `[extract] playwright fallback also failed for ${url} after ${Date.now() - playwrightStartedAt}ms: ${describeError(err)}`
    );
    throw err;
  }
}

module.exports = { extractArticle, downloadImage, MAX_CONTENT_CHARS };
