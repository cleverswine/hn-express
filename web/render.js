'use strict';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function formatAge(unixSeconds) {
  if (!unixSeconds) return '';
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSeconds);
  const units = [
    [86400, 'day'],
    [3600, 'hour'],
    [60, 'minute'],
  ];
  for (const [secs, label] of units) {
    if (diffSec >= secs) {
      const n = Math.floor(diffSec / secs);
      return `${n} ${label}${n > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

function renderSummary(story) {
  switch (story.summary_status) {
    case 'done':
      return `<p class="summary">${escapeHtml(story.summary)}</p>`;
    case 'pending':
    case 'processing':
      return `<p class="summary summary-pending">Summarizing&hellip;</p>`;
    case 'failed':
      return `<p class="summary summary-failed">Summary unavailable.</p>`;
    default:
      return '';
  }
}

function renderStory(story) {
  const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const link = story.url || hnUrl;
  const image = story.has_image
    ? `<a class="story-media" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
         <img src="/image/${story.id}" alt="" loading="lazy">
       </a>`
    : `<div class="story-media story-media-placeholder" aria-hidden="true"></div>`;

  return `
    <article class="story${story.is_read ? ' read' : ''}">
      ${image}
      <div class="story-body">
        <h2 class="story-title">
          <a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">${escapeHtml(story.title)}</a>
        </h2>
        <div class="meta">
          ${story.domain ? `${escapeHtml(story.domain)} &middot; ` : ''}${story.score ?? 0} points by ${escapeHtml(story.by)}
          &middot; ${formatAge(story.time)} &middot; <a href="${hnUrl}">${story.descendants ?? 0} comments</a>
          <span class="meta-updated" title="${story.fetched_at ? escapeHtml(new Date(story.fetched_at * 1000).toLocaleString()) : ''}">(updated ${formatAge(story.fetched_at)})</span>
        </div>
      </div>
      ${renderSummary(story)}
    </article>`;
}

function renderLayout({ body, refreshTag = '', headerExtra = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refreshTag}
  <title>Hacker News Enhanced</title>
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <div class="header-row">
      <h1><a href="/">Hacker News Enhanced</a></h1>
      ${headerExtra}
    </div>
    <p class="tagline">The HN front page and archives, enhanced with AI generated summaries</p>
  </header>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

function renderMarkReadForm(action) {
  return `
    <form class="mark-read-form" method="POST" action="${action}">
      <button type="submit" class="mark-read-btn">Mark all as read</button>
    </form>`;
}

function renderNavLinks() {
  return `
    <div class="nav-links">
      <a class="nav-link" href="/archive">Archive</a>
      <a class="nav-link" href="/admin">Admin</a>
    </div>`;
}

function renderPage(stories) {
  const hasPending = stories.some((s) => s.summary_status === 'pending' || s.summary_status === 'processing');
  const refreshTag = hasPending ? '<meta http-equiv="refresh" content="20">' : '';
  const list = stories.length
    ? stories.map(renderStory).join('\n')
    : '<p class="empty">No stories yet — the worker hasn\'t run.</p>';
  const navLinks = renderNavLinks();
  const footer = `<div class="page-footer">${navLinks}${renderMarkReadForm('/read-all')}</div>`;

  return renderLayout({ body: `${list}\n${footer}`, refreshTag, headerExtra: navLinks });
}

function renderArchiveNav({ date, prevDate, nextDate }) {
  return `
    <nav class="archive-nav">
      <a href="/archive/${prevDate}">&larr; ${prevDate}</a>
      <span class="archive-date">${date}</span>
      ${nextDate ? `<a href="/archive/${nextDate}">${nextDate} &rarr;</a>` : '<span class="nav-disabled">&rarr;</span>'}
    </nav>`;
}

function renderArchivePage({ date, stories, prevDate, nextDate }) {
  const nav = renderArchiveNav({ date, prevDate, nextDate });
  const list = stories.length
    ? stories.map(renderStory).join('\n')
    : '<p class="empty">No stories for this day.</p>';
  const footer = `<div class="page-footer">${nav}${renderMarkReadForm(`/archive/${date}/read-all`)}</div>`;

  return renderLayout({ body: `${nav}\n${list}\n${footer}`, headerExtra: renderNavLinks() });
}

const SUMMARY_STATUS_LABELS = {
  pending: 'Pending',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
  skipped: 'Skipped',
  canceled: 'Canceled',
};

function renderSettingsSection({ section, items }) {
  const rows = items
    .map((i) => `<tr><td class="admin-key">${escapeHtml(i.key)}</td><td>${escapeHtml(i.value)}</td></tr>`)
    .join('\n');
  return `
    <div class="admin-card">
      <h3>${escapeHtml(section)}</h3>
      <table class="admin-table">${rows}</table>
    </div>`;
}

function renderUnreadByDay(days) {
  const rows = days
    .map(
      (d) => `<tr><td>${escapeHtml(d.date)}</td><td>${d.total}</td><td>${d.unread}</td></tr>`
    )
    .join('\n');
  return `
    <table class="admin-table">
      <thead><tr><th>Day</th><th>Stories seen</th><th>Unread</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderSummaryStats(stats) {
  const total = Object.values(stats).reduce((a, b) => a + b, 0);
  const cards = Object.entries(SUMMARY_STATUS_LABELS)
    .map(
      (
        [status, label]
      ) => `<div class="stat-tile"><div class="stat-value">${stats[status] ?? 0}</div><div class="stat-label">${escapeHtml(label)}</div></div>`
    )
    .join('\n');
  return `
    <div class="stat-grid">${cards}</div>
    <p class="admin-note">${total} stories tracked in total.</p>`;
}

function renderOllamaMetrics(ollama) {
  if (!ollama) {
    return '<p class="admin-note">Ollama metrics unavailable (couldn\'t reach the configured OLLAMA_HOST).</p>';
  }
  const version = ollama.version ? `<p class="admin-note">Ollama version ${escapeHtml(ollama.version)}</p>` : '';
  if (!ollama.models.length) {
    return `${version}<p class="admin-note">No models currently loaded.</p>`;
  }
  const rows = ollama.models
    .map((m) => {
      const sizeGb = m.size ? `${(m.size / 1e9).toFixed(2)} GB` : '—';
      const vramGb = m.size_vram ? `${(m.size_vram / 1e9).toFixed(2)} GB` : '—';
      const expires = m.expires_at ? new Date(m.expires_at).toLocaleString() : '—';
      return `<tr><td>${escapeHtml(m.name || m.model)}</td><td>${sizeGb}</td><td>${vramGb}</td><td>${escapeHtml(expires)}</td></tr>`;
    })
    .join('\n');
  return `
    ${version}
    <table class="admin-table">
      <thead><tr><th>Model</th><th>Size</th><th>VRAM</th><th>Expires</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function renderAdminPage({ settings, unreadByDay, summaryStats, ollama }) {
  const body = `
    <div class="admin-section">
      <h2>Settings</h2>
      <div class="admin-grid">${settings.map(renderSettingsSection).join('\n')}</div>
    </div>
    <div class="admin-section">
      <h2>Unread stories by day</h2>
      ${renderUnreadByDay(unreadByDay)}
    </div>
    <div class="admin-section">
      <h2>Summarization status</h2>
      ${renderSummaryStats(summaryStats)}
    </div>
    <div class="admin-section">
      <h2>Ollama</h2>
      ${renderOllamaMetrics(ollama)}
    </div>`;

  return renderLayout({ body, headerExtra: renderNavLinks() });
}

module.exports = { renderPage, renderArchivePage, renderAdminPage };
