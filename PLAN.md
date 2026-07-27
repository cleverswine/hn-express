# HN Express — design doc

## Context

Shows the Hacker News front page (via the official HN API, in HN's own rank order) and enriches each story with an AI-generated summary of the linked article plus a representative image — generated in the background by a locally-running Ollama model, never on the request path. The UI only reads from SQLite; it does no fetching or summarizing itself.

Three npm workspaces, one shared SQLite file:

```
db/      shared SQLite schema + query helpers (used by both worker and web)
worker/  background process: poll HN API → upsert stories; drain pending stories →
         fetch article → extract text/image → summarize via Ollama → save
web/     Express server, server-rendered HTML only, reads from the same sqlite file
```

Single file at `db/data/hn.sqlite3`, opened in **WAL mode** so the worker (writer) and web server (reader) can safely run as separate processes concurrently.

## `db` package

- `db/index.js` — `getDb()` singleton opening the file with `node:sqlite`'s `DatabaseSync` (built into Node 22.5+/26, no native module to build), enabling WAL and creating the schema (`CREATE TABLE IF NOT EXISTS`) on first use.
- Table `stories`: `id` (HN item id, PK), `rank`, `hn_type`, `title`, `url`, `domain`, `by`, `score`, `descendants`, `time`, `text` (self-post body when there's no url), `summary`, `image_url`, `summary_status` (`pending|processing|done|failed|skipped`), `summary_error`, `model_used`, `summarized_at`, `fetched_at`, `first_seen_at`.
- Exports: `upsertFrontPage(items)` — in one transaction, clears `rank` on every row, then upserts the current batch with `rank = 1..N` (`ON CONFLICT DO UPDATE` touches only HN metadata columns, never summary/image/status, so re-fetching never clobbers work already done); `getFrontPage(limit)` (rows with `rank IS NOT NULL ORDER BY rank`); `getPending(limit)`; `markProcessing(id)`; `saveSummary(id, {summary, imageUrl, model})`; `markFailed(id, error)`; `markSkipped(id)`.

## `worker` package

- `hn.js` — fetches `topstories.json`, takes the first `HN_FRONTPAGE_SIZE` ids (default 30), fetches each `item/{id}.json` with bounded concurrency (10) via `lib/pool.js`, calls `db.upsertFrontPage(...)`.
- `extract.js` — given a URL: plain `fetch()` with a browser-like User-Agent and a timeout, parsed with `jsdom` + `@mozilla/readability` for main text, pulling `og:image` / `twitter:image` (falling back to the first `<img>` in the extracted content). If the fetch fails, isn't `text/html`, or yields under ~200 chars of text (JS-rendered or blocked page), falls back to Playwright (headless Chromium): load the page, grab `page.content()`, run the same extraction on the rendered HTML. Text is capped at 6000 chars before it goes to the model.
- `ollama.js` — `POST {OLLAMA_HOST}/api/generate` (non-streaming) with a short summarization prompt; returns the 2–3 sentence response text.
- `summarize.js` — `summarizeBatch(limit)` pulls up to `limit` pending stories and processes them with concurrency `SUMMARY_CONCURRENCY` (default 2): `url` present → `extract.js` → `ollama.js`; no `url` but has `text` (Ask HN/Show HN/job) → summarize the HN self-post body directly, no fetch/extraction; neither → `markSkipped`. Failures are caught per-story (`markFailed`, with the error message) so one bad story never takes down the batch.
- `index.js` — two independent loops in one process: `fetchLoop` (re-runs `hn.js` every `FETCH_INTERVAL_MS`, default 15 min) and `summarizeLoop` (continuously drains pending stories, sleeping `SUMMARY_IDLE_SLEEP_MS` when the queue is empty).
- `scripts/fetch-once.js` / `scripts/summarize-once.js` — single-pass entry points for manual runs/testing (`npm run fetch:once` / `summarize:once`); `summarize-once` drains the entire pending queue, not just one batch.
- Deps added: `jsdom`, `@mozilla/readability`, `playwright` (+ `npx playwright install chromium`).

**Note on failures:** `getPending()` only selects `status = 'pending'`, so a story marked `failed` is not retried automatically (avoids hammering a broken Ollama endpoint indefinitely). If Ollama isn't up yet when the worker first runs, stories will pile up as `failed` and need to be manually reset to `pending` (or re-run `summarize:once` after fixing the underlying issue) — there's no auto-retry/backoff built in yet.

## `web` package

- Express, minimal: one route + `express.static` for the CSS file. No templating engine — plain JS template literals in `render.js`, with all interpolated content run through `escapeHtml`.
- `GET /` — renders stories in rank order: title (linking to the article, or the HN discussion if there's no url), domain, score/by/age/comment-count, and: summary + image if `summary_status = 'done'`, a "Summarizing…" placeholder if `pending`/`processing`, nothing extra if `failed`/`skipped`. If anything is still pending/processing, the page includes `<meta http-equiv="refresh" content="20">` so it updates itself with zero client-side JS.
- `public/style.css` — small, plain, supports light/dark via `prefers-color-scheme`.

## Config

`.env` (loaded via Node's built-in `--env-file-if-exists`, no `dotenv` dependency), see `.env.example` for the full list: `PORT`, `DB_PATH` (advanced override only — defaults to an absolute path resolved from the `db` package, don't set it to a relative path), `HN_FRONTPAGE_SIZE`, `FETCH_INTERVAL_MS`, `FETCH_TIMEOUT_MS`, `PLAYWRIGHT_TIMEOUT_MS`, `SUMMARY_BATCH_SIZE`, `SUMMARY_CONCURRENCY`, `SUMMARY_IDLE_SLEEP_MS`, `OLLAMA_HOST` (default `http://localhost:11434`), `OLLAMA_MODEL` (default `llama3.2`), `OLLAMA_TIMEOUT_MS`.

Root `package.json` adds `concurrently` (dev-only) and an `npm run dev` script that runs `web` + `worker` together.

## Status: implemented and verified

All of the above is built. Verified so far:
- `npm run fetch:once` — pulled the real, current HN front page (30 stories) into SQLite.
- `extract.js` — tested directly against live front-page URLs; plain-fetch path and `og:image` detection both work; Playwright launches fine and was exercised on a real page.
- `web` — server renders the front page correctly (ranks, scores, ages, comment counts, escaping, pending placeholders, conditional auto-refresh), checked via raw HTML output.
- Failure handling — ran a full `summarize:once` pass with no Ollama available; every story was caught and marked `failed` with a clear error rather than crashing the batch, then reset to `pending` since the failure was purely environmental.

**Not yet verified**: an actual Ollama-generated summary end-to-end, since Ollama isn't installed/running in this environment. Install Ollama, `ollama pull llama3.2` (or set `OLLAMA_MODEL` to whatever's pulled), then `npm run summarize:once` to complete that check.

## Possible follow-ups (not built)
- Retry/backoff for `failed` stories (currently a manual DB reset).
- Pruning stories that have been off the front page for a long time (currently they just stay in the table with `rank = NULL`, invisible to the UI but never deleted).

## Docker

`web/Dockerfile` and `worker/Dockerfile` each build from the repo root (needed for the sibling `db/` package): copy all three workspace `package.json`s + lockfile, `npm ci` (with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` so only the worker image pays for the Chromium download), copy in `db/` plus that service's own source, and (worker only) `npx playwright install --with-deps chromium`. `docker-compose.yml` runs both against a shared named volume (`hn-data:/app/db/data`, matching `db/index.js`'s default path so no `DB_PATH` override is needed) and wires `host.docker.internal` for the worker to reach a host-run Ollama.

**Not verified** — no Docker available in the dev sandbox this was built in, so the images have been reviewed carefully but never actually built/run. `docker compose up --build` should be the first thing to try after cloning this into an environment with Docker.
