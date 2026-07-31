'use strict';

const db = require('db');

const POLL_INTERVAL_MS = 2000;

function fingerprint(story) {
  return `${story.summary_status}|${story.summary?.length ?? 0}|${story.has_image}`;
}

function attachLiveUpdates(wss, { frontPageSize }) {
  let snapshot = new Map();
  let timer = null;

  function broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.send(payload);
    }
  }

  function poll() {
    const stories = db.getFrontPage(frontPageSize);
    const changed = [];
    const nextSnapshot = new Map();

    for (const s of stories) {
      const fp = fingerprint(s);
      nextSnapshot.set(s.id, fp);
      if (snapshot.get(s.id) !== fp) {
        changed.push({
          id: s.id,
          summary_status: s.summary_status,
          summary: s.summary,
          has_image: !!s.has_image,
        });
      }
    }

    snapshot = nextSnapshot;

    if (changed.length) broadcast({ type: 'story-update', stories: changed });

    const stillPending = stories.some(
      (s) => s.summary_status === 'pending' || s.summary_status === 'processing'
    );
    if (!stillPending || wss.clients.size === 0) stop();
  }

  function start() {
    if (timer) return;
    timer = setInterval(poll, POLL_INTERVAL_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  wss.on('connection', (ws) => {
    snapshot = new Map(db.getFrontPage(frontPageSize).map((s) => [s.id, fingerprint(s)]));
    start();
    ws.on('close', () => {
      if (wss.clients.size === 0) stop();
    });
  });
}

module.exports = { attachLiveUpdates };
