'use strict';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
const STATUS_TIMEOUT_MS = 2000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STATUS_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort snapshot of Ollama's own runtime state (currently loaded
 * models + version) for the admin page. Ollama isn't guaranteed to be
 * reachable from the web process (e.g. different host/container than the
 * worker), so any failure here just means the section renders as
 * unavailable rather than breaking the page.
 */
async function getOllamaStatus() {
  const [ps, version] = await Promise.all([
    fetchJson(`${OLLAMA_HOST}/api/ps`),
    fetchJson(`${OLLAMA_HOST}/api/version`),
  ]);
  if (!ps && !version) return null;
  return { models: ps?.models || [], version: version?.version || null };
}

module.exports = { getOllamaStatus, OLLAMA_HOST };
