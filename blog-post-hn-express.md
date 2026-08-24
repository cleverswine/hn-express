---
title: "Building HN Express: A Self-Hosted Hacker News Reader with Local AI Summaries"
date: 2026-08-24
description: "How HN Express pairs the Hacker News API with a locally-running Ollama model to summarize the front page — and the architecture that keeps AI generation off the request path."
tags: [nodejs, sqlite, ollama, hacker-news, self-hosted]
---

I read Hacker News the same way most people do: scan the front page, open a few tabs, skim the ones that hold my attention, and lose the rest to tab rot. **HN Express** is a small project built to fix that — it shows the HN front page in HN's own rank order, but with an AI-generated summary and a representative image next to every story, so I can decide what's worth a click before I click it.

## The constraint that shaped everything

The one rule I set early was: **summarization never happens on the request path.** Nobody should sit on a loading spinner waiting for an LLM to finish reading an article. That single constraint pushed the whole design toward a producer/consumer split:

- A **worker** process polls the HN API, fetches article content, and asks a local [Ollama](https://ollama.com) model to summarize it — entirely in the background.
- A **web** process only ever reads from a SQLite database and renders HTML. It never touches the network for HN, never calls Ollama, and stays fast no matter what the worker is doing.

Both share one SQLite file (via Node's built-in `node:sqlite`, no extra driver needed), split across three npm workspaces:

```
db/      SQLite schema + query helpers, shared by both processes
worker/  polls HN, extracts article text/images, summarizes via Ollama
web/     Express server that renders straight from the database
```

Because the two processes never call each other directly, the web server can restart, crash, or scale independently of the worker — the database is the only contract between them.

## Turning a URL into a summary

The worker's summarization pipeline is a small waterfall of fallbacks, because "fetch a URL and get clean article text" is deceptively hard in practice:

1. **Plain fetch.** Most article pages are static enough that a bare `fetch()` plus [Readability](https://github.com/mozilla/readability) (the library behind Firefox's reader mode) extracts usable text.
2. **Headless browser fallback.** If the fetch fails outright, or returns suspiciously little text (under 200 characters — usually a sign the page is JS-rendered or blocking bots), the worker retries the same URL with Playwright and a real Chromium instance, then runs the same extraction on the rendered HTML.
3. **Self-posts.** For text-only HN submissions, there's no URL to fetch — the worker just cleans up the HTML already embedded in the story.

Whatever text comes out gets capped at 6,000 characters and handed to Ollama with a short, direct prompt: *summarize this in 2-3 neutral sentences, no preamble.* A representative image (pulled from Open Graph or Twitter Card meta tags, or the first image in the extracted article) is downloaded and stored **as a BLOB directly in the row** — not linked by URL. That was a deliberate later change: linking to remote images meant broken thumbnails the moment a source site changed or went down. Storing the bytes means the page renders correctly forever, independent of the source site's uptime.

Failures are recorded, not retried automatically — a story that fails once (bad extraction, Ollama unreachable) is marked `failed` and left alone, so a broken Ollama endpoint doesn't turn into a hammering retry loop. There's a separate `retry-failed` command for requeuing everything once whatever was broken gets fixed.

## Watching summaries arrive without polling the page

Early on, the front page just used a meta-refresh tag to reload every 20 seconds until every story had a summary. It worked, but it was crude — a full page reload for what's really a handful of rows changing status.

That was later replaced with a lightweight WebSocket layer: the web server keeps a snapshot of each visible story's `(status, summary length, has_image)` fingerprint, polls the database every two seconds *only while a socket is connected and stories are still pending*, and pushes just the rows that changed. The moment nothing is pending or no one is watching, the poll loop shuts itself off — no background work for an idle tab.

## A few design choices worth calling out

- **Rank tracking without losing history.** Each front-page refresh clears every row's `rank` and re-assigns it for whatever's currently listed, but never deletes a row. That's what makes the date-based archive possible — a story that falls off the front page still exists with a `first_seen_at` timestamp, just with `rank = NULL`.
- **Read state cancels pending work.** Marking a story read while its summary is still `pending` cancels it instead of leaving it queued — there's no point spending an LLM call on something the reader already moved past.
- **Automatic cleanup.** Stories that fall off the front page are purged after two weeks by default, so the database doesn't grow forever from a project meant to run continuously on a home server.
- **An admin view for the machinery itself.** A `/admin` page shows summarization status counts, unread stories by day, and when each story's comment count was last refreshed — useful once the worker is a background daemon you mostly forget about.

## Running it

The whole thing is designed to run comfortably on a single machine: `npm run dev` starts both processes side by side, or each can run standalone. The only external dependency is Ollama running on the host — `ollama pull llama3.2` and it just works, no API keys, no cloud bill, no rate limits.

For anything beyond local development, Docker Compose is the easiest path in — it's genuinely a one-liner:

```
docker compose up --build
```

That single command builds and starts *both* the web and worker containers, wires them to the same host-mounted SQLite database (`$HOME/.config/hn/data`, the same path the app uses outside Docker), and points the worker at Ollama running on the host via `host.docker.internal` — no manual networking setup required. Open `http://localhost:3000` and the front page starts filling in as soon as the worker's first fetch completes.

There's no database to provision, no separate cache or queue to stand up, and no environment file required to get started — every setting in `.env.example` already has a working default, so `docker compose up --build` is enough to go from a fresh clone to a running app. Each workspace also has its own standalone `Dockerfile` (built from the repo root, since both need the sibling `db/` package) for cases where the web and worker need to be deployed or scaled independently.

That's really the point of HN Express: a genuinely useful daily tool, built on infrastructure you already control.
