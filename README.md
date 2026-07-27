# HN Express

Shows the Hacker News front page (via the official HN API, in HN's own rank order), with an AI-generated summary and representative image for each linked article. Summaries are generated in the background by a locally-running [Ollama](https://ollama.com) model — never on the request path. The web UI is plain server-rendered HTML that only reads from a local SQLite database.

Three npm workspaces sharing one SQLite file:

- `db/` — SQLite schema + query helpers.
- `worker/` — background process: polls the HN API into the database, then summarizes articles (fetch → extract text/image, falling back to a headless browser when needed → Ollama).
- `web/` — Express server that renders the front page from the database.

See [`PLAN.md`](./PLAN.md) for the full design.

## Prerequisites

- Node.js 22.5+ (uses the built-in `node:sqlite`; developed on Node 26).
- [Ollama](https://ollama.com) installed and running locally, with a model pulled:
  ```
  ollama pull llama3.2
  ```
  (or set `OLLAMA_MODEL` to whatever model you've pulled — see Configuration below).

## Setup

```
npm install
npx playwright install chromium
```

Optionally copy `.env.example` to `.env` and adjust values (all settings have working defaults):

```
cp .env.example .env
```

## Running everything together

```
npm run dev
```

Runs the web server and worker side by side (via `concurrently`). Then open `http://localhost:3000`.

The first load will be empty until the worker's first HN fetch completes; summaries fill in gradually as the worker processes them, and the page auto-refreshes every 20s while any are still pending.

## Running the worker standalone

From the repo root:

```
npm start -w worker
```

Or from inside `worker/`:

```
cd worker
npm start
```

This runs both worker loops continuously: refetching the HN front page every `FETCH_INTERVAL_MS` (default 15 min), and continuously draining any stories that don't have a summary yet.

For a one-off manual run instead of the continuous loop:

```
npm run fetch:once -w worker       # fetch the current HN front page once
npm run summarize:once -w worker   # summarize all currently-pending stories once, then exit
```

### Retrying failed summaries

Stories whose summary failed (extraction or Ollama error) are marked `failed` and are **not** retried automatically — this avoids hammering a broken endpoint indefinitely. Once whatever caused the failures is fixed (e.g. Ollama wasn't reachable yet), requeue and reprocess them:

```
npm run retry-failed -w worker
```

This resets every `failed` story back to `pending` and immediately drains the whole pending queue (same as `summarize:once`).

If you're running the continuous worker instead, pass `--retry-failed` (or set `RETRY_FAILED=true`) to requeue everything once at startup, then continue as normal:

```
npm start -w worker -- --retry-failed
```

## Running the web server standalone

From the repo root:

```
npm start -w web
```

Or from inside `web/`:

```
cd web
npm start
```

Serves the UI at `http://localhost:3000` (or `$PORT`) purely from whatever is already in the SQLite database — it never fetches from HN or calls Ollama itself, so run the worker (at least once) separately to populate data.

## Running with Docker

Each workspace has its own `Dockerfile` (`web/Dockerfile`, `worker/Dockerfile`); both are built from the **repo root** as the build context, since they need the sibling `db/` package. `docker-compose.yml` runs both together, bind-mounting `$HOME/.config/hn/data` from the host into both containers so they share the same SQLite database — the same path the app uses by default outside Docker (see [Data](#data)).

Ollama itself is expected to keep running on the host, not in a container — the worker reaches it at `http://host.docker.internal:11434` by default (wired up via `extra_hosts` in the compose file, works on Docker 20.10+ on Linux/Mac/Windows).

### Both together (compose)

```
docker compose up --build
```

Then open `http://localhost:3000`. Optionally copy `.env.example` to `.env` first — compose reads it automatically for the defaults shown in `docker-compose.yml` (`HN_FRONTPAGE_SIZE`, `OLLAMA_MODEL`, `PORT`, etc.); everything works without one.

### Worker standalone (Docker)

```
docker build -f worker/Dockerfile -t hn-express-worker .
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e OLLAMA_MODEL=llama3.2 \
  -v "$HOME/.config/hn/data:/root/.config/hn/data" \
  hn-express-worker
```

### Web standalone (Docker)

```
docker build -f web/Dockerfile -t hn-express-web .
docker run --rm -p 3000:3000 -v "$HOME/.config/hn/data:/root/.config/hn/data" hn-express-web
```

Uses the same host bind mount as the worker above so both containers see the same database.

## Configuration

All configuration is via environment variables (see `.env.example` for the full list and defaults), including `PORT`, `HN_FRONTPAGE_SIZE`, `FETCH_INTERVAL_MS`, `SUMMARY_CONCURRENCY`, `OLLAMA_HOST`, and `OLLAMA_MODEL`.

## Data

The SQLite database lives at `$HOME/.config/hn/data/hn.sqlite3` (created automatically on first run, including under Docker via a bind mount to the same host path — see [Running with Docker](#running-with-docker)). Delete it to start fresh. Override the location with `DB_PATH` (see `.env.example`).
