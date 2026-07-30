'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const DEFAULT_DB_PATH = path.join(os.homedir(), '.config', 'hn', 'data', 'hn.sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stories (
  id              INTEGER PRIMARY KEY,
  rank            INTEGER,
  hn_type         TEXT,
  title           TEXT,
  url             TEXT,
  domain          TEXT,
  by              TEXT,
  score           INTEGER,
  descendants     INTEGER,
  time            INTEGER,
  text            TEXT,
  summary         TEXT,
  image_data      BLOB,
  image_type      TEXT,
  summary_status  TEXT NOT NULL DEFAULT 'pending',
  summary_error   TEXT,
  model_used      TEXT,
  summarized_at   INTEGER,
  fetched_at      INTEGER,
  first_seen_at   INTEGER NOT NULL,
  read_at         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_stories_rank ON stories(rank);
CREATE INDEX IF NOT EXISTS idx_stories_summary_status ON stories(summary_status);
CREATE INDEX IF NOT EXISTS idx_stories_first_seen_at ON stories(first_seen_at);
`;

let db = null;

/**
 * Migrate databases created before images were stored in-row: add the new
 * columns and drop the old URL column. No-op on a fresh database, since the
 * CREATE TABLE above already has the current shape.
 */
function migrateImageColumns(conn) {
  const cols = conn.prepare('PRAGMA table_info(stories)').all().map((c) => c.name);
  if (!cols.includes('image_data')) conn.exec('ALTER TABLE stories ADD COLUMN image_data BLOB');
  if (!cols.includes('image_type')) conn.exec('ALTER TABLE stories ADD COLUMN image_type TEXT');
  if (cols.includes('image_url')) conn.exec('ALTER TABLE stories DROP COLUMN image_url');
}

/**
 * Migrate databases created before read tracking existed. No-op on a fresh
 * database, since the CREATE TABLE above already has the current shape.
 */
function migrateReadColumn(conn) {
  const cols = conn.prepare('PRAGMA table_info(stories)').all().map((c) => c.name);
  if (!cols.includes('read_at')) conn.exec('ALTER TABLE stories ADD COLUMN read_at INTEGER');
}

function getDb() {
  if (db) return db;

  const dbPath = process.env.DB_PATH || DEFAULT_DB_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  migrateImageColumns(db);
  migrateReadColumn(db);

  return db;
}

/**
 * Replace the current front-page ranking. Clears rank on every row first so
 * stories that fell off the front page stop showing up, then upserts the
 * given items with rank = their position. Never touches summary columns on
 * existing rows.
 */
function upsertFrontPage(items) {
  const conn = getDb();
  const now = Math.floor(Date.now() / 1000);

  const clearRanks = conn.prepare('UPDATE stories SET rank = NULL');
  const upsert = conn.prepare(`
    INSERT INTO stories (id, rank, hn_type, title, url, domain, by, score, descendants, time, text, fetched_at, first_seen_at)
    VALUES (:id, :rank, :hn_type, :title, :url, :domain, :by, :score, :descendants, :time, :text, :fetched_at, :first_seen_at)
    ON CONFLICT(id) DO UPDATE SET
      rank = excluded.rank,
      title = excluded.title,
      url = excluded.url,
      domain = excluded.domain,
      by = excluded.by,
      score = excluded.score,
      descendants = excluded.descendants,
      text = excluded.text,
      fetched_at = excluded.fetched_at
  `);

  conn.exec('BEGIN');
  try {
    clearRanks.run();
    for (const item of items) {
      let domain = null;
      if (item.url) {
        try {
          domain = new URL(item.url).hostname.replace(/^www\./, '');
        } catch {
          domain = null;
        }
      }
      upsert.run({
        id: item.id,
        rank: item.rank,
        hn_type: item.type || null,
        title: item.title || null,
        url: item.url || null,
        domain,
        by: item.by || null,
        score: item.score ?? null,
        descendants: item.descendants ?? null,
        time: item.time ?? null,
        text: item.text || null,
        fetched_at: now,
        first_seen_at: now,
      });
    }
    conn.exec('COMMIT');
  } catch (err) {
    conn.exec('ROLLBACK');
    throw err;
  }
}

function getFrontPage(limit = 30) {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT id, rank, hn_type, title, url, domain, by, score, descendants, time, summary,
              (image_data IS NOT NULL) AS has_image,
              (read_at IS NOT NULL) AS is_read,
              summary_status, summary_error, model_used, summarized_at, fetched_at, first_seen_at
       FROM stories WHERE rank IS NOT NULL ORDER BY rank ASC LIMIT ?`
    )
    .all(limit);
}

/**
 * Stories first seen in [startSec, endSec) — falls off the front page never
 * removes a row, it just clears `rank`, so this is independent of rank and
 * reaches back through full history. Only fully-summarized stories are
 * included, matching what the front page shows. Stories currently on the
 * front page (rank IS NOT NULL) are excluded so the archive doesn't
 * duplicate what's already visible there.
 */
function getHistoryDay(startSec, endSec) {
  const conn = getDb();
  return conn
    .prepare(
      `SELECT id, hn_type, title, url, domain, by, score, descendants, time, summary,
              (image_data IS NOT NULL) AS has_image,
              (read_at IS NOT NULL) AS is_read,
              summary_status, summary_error, model_used, summarized_at, fetched_at, first_seen_at
       FROM stories
       WHERE first_seen_at >= ? AND first_seen_at < ? AND summary_status = 'done' AND rank IS NULL
       ORDER BY first_seen_at DESC`
    )
    .all(startSec, endSec);
}

/**
 * Mark the given story ids as read (idempotent — already-read stories keep
 * their original read_at). A story whose summarization hasn't started yet
 * (status still 'pending') has its summary canceled instead, since there's
 * no point summarizing something the reader already moved past.
 */
function markRead(ids) {
  if (!ids.length) return;
  const conn = getDb();
  const now = Math.floor(Date.now() / 1000);
  const placeholders = ids.map(() => '?').join(',');
  conn
    .prepare(
      `UPDATE stories SET
         read_at = ?,
         summary_status = CASE WHEN summary_status = 'pending' THEN 'canceled' ELSE summary_status END
       WHERE id IN (${placeholders}) AND read_at IS NULL`
    )
    .run(now, ...ids);
}

function getImage(id) {
  const conn = getDb();
  return conn.prepare('SELECT image_data, image_type FROM stories WHERE id = ?').get(id);
}

function getPending(limit = 5) {
  const conn = getDb();
  return conn
    .prepare(
      "SELECT * FROM stories WHERE summary_status = 'pending' ORDER BY rank IS NULL, rank ASC LIMIT ?"
    )
    .all(limit);
}

function markProcessing(id) {
  getDb()
    .prepare("UPDATE stories SET summary_status = 'processing' WHERE id = ?")
    .run(id);
}

function saveSummary(id, { summary, imageData, imageType, model }) {
  getDb()
    .prepare(
      `UPDATE stories SET
         summary_status = 'done',
         summary = :summary,
         image_data = :imageData,
         image_type = :imageType,
         model_used = :model,
         summary_error = NULL,
         summarized_at = :now
       WHERE id = :id`
    )
    .run({
      id,
      summary,
      imageData: imageData || null,
      imageType: imageType || null,
      model: model || null,
      now: Math.floor(Date.now() / 1000),
    });
}

function markFailed(id, error) {
  getDb()
    .prepare(
      `UPDATE stories SET summary_status = 'failed', summary_error = :error, summarized_at = :now WHERE id = :id`
    )
    .run({ id, error: String(error).slice(0, 500), now: Math.floor(Date.now() / 1000) });
}

function markSkipped(id) {
  getDb().prepare("UPDATE stories SET summary_status = 'skipped' WHERE id = ?").run(id);
}

/**
 * Reset every 'failed' story back to 'pending' so the next summarize pass
 * picks it up again. Returns the number of stories requeued.
 */
function requeueFailed() {
  const info = getDb()
    .prepare("UPDATE stories SET summary_status = 'pending', summary_error = NULL WHERE summary_status = 'failed'")
    .run();
  return info.changes;
}

module.exports = {
  getDb,
  upsertFrontPage,
  getFrontPage,
  getHistoryDay,
  markRead,
  getImage,
  getPending,
  markProcessing,
  saveSummary,
  markFailed,
  markSkipped,
  requeueFailed,
};
