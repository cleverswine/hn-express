(function () {
  'use strict';

  const RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 8000];
  let attempt = 0;

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${proto}//${location.host}/ws`);

    socket.addEventListener('open', () => {
      attempt = 0;
    });
    socket.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === 'story-update') msg.stories.forEach(patchStory);
    });
    socket.addEventListener('close', scheduleReconnect);
    socket.addEventListener('error', () => socket.close());
  }

  function scheduleReconnect() {
    const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
    attempt++;
    setTimeout(connect, delay);
  }

  function patchStory(story) {
    const article = document.querySelector(`[data-story-id="${story.id}"]`);
    if (!article) return;

    const slot = article.querySelector('.summary-slot');
    if (slot) slot.innerHTML = renderSummaryHtml(story);

    updateLiveBadge();
  }

  function renderSummaryHtml(story) {
    switch (story.summary_status) {
      case 'done':
        return `<p class="summary">${escapeHtml(story.summary)}</p>`;
      case 'failed':
        return '<p class="summary summary-failed">Summary unavailable.</p>';
      case 'pending':
      case 'processing':
        return '<p class="summary summary-pending">Summarizing&hellip;</p>';
      default:
        return '';
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
  }

  function updateLiveBadge() {
    const badge = document.getElementById('live-badge');
    if (!badge) return;
    const stillPending = document.querySelectorAll('.summary-pending').length > 0;
    badge.classList.toggle('is-hidden', !stillPending);
  }

  connect();
})();
