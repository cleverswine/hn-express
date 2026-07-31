'use strict';

const ICONS = {
  archive: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="14" rx="2"></rect><path d="M3 7l2-4h14l2 4"></path><path d="M9 12h6"></path></svg>',
  admin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M18 6h2"></path><circle cx="16" cy="6" r="2"></circle><path d="M4 12h2M10 12h10"></path><circle cx="8" cy="12" r="2"></circle><path d="M4 18h10M18 18h2"></path><circle cx="16" cy="18" r="2"></circle></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"></path></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path><circle cx="12" cy="12" r="3"></circle></svg>',
  eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9.9 4.24A10.94 10.94 0 0112 4c7 0 11 7 11 7a17.4 17.4 0 01-3.13 4.03M6.6 6.6C3.9 8.3 2 12 2 12s4 7 10 7a10 10 0 004.9-1.3"></path><path d="M14.12 14.12a3 3 0 11-4.24-4.24"></path><path d="M1 1l22 22"></path></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"></path></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"></path></svg>',
};

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

function renderStory(story, isLcpCandidate = false) {
  const hnUrl = `https://news.ycombinator.com/item?id=${story.id}`;
  const link = story.url || hnUrl;
  const imgAttrs = isLcpCandidate ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"';
  const image = story.has_image
    ? `<a class="story-media" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
         <img src="/image/${story.id}" alt="" ${imgAttrs}>
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

function renderLayout({ body, refreshTag = '', headerExtra = '', liveBadge = false }) {
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
  <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <div class="header-inner">
      <div class="header-row">
        <div class="brand">
          <h1><a href="/">Hacker News Enhanced</a></h1>
          ${liveBadge ? '<span class="live-badge"><span class="live-dot"></span>Updating</span>' : ''}
        </div>
        ${headerExtra}
      </div>
      <p class="tagline">The HN front page and archives, enhanced with AI generated summaries</p>
    </div>
  </header>
  <main>
    ${body}
  </main>
</body>
</html>`;
}

function renderMarkReadForm(action) {
  return `
    <form class="btn-form" method="POST" action="${action}">
      <button type="submit" class="btn btn-primary">${ICONS.check}<span>Mark all as read</span></button>
    </form>`;
}

function renderHideReadToggle(currentPath, hideRead) {
  return `
    <form class="btn-form" method="POST" action="/toggle-hide-read">
      <input type="hidden" name="returnTo" value="${escapeHtml(currentPath)}">
      <button type="submit" class="btn btn-ghost">${hideRead ? ICONS.eye : ICONS.eyeOff}<span>${hideRead ? 'Show read stories' : 'Hide read stories'}</span></button>
    </form>`;
}

function renderHiddenNote(hideRead, hiddenCount) {
  if (!hideRead || !hiddenCount) return '';
  return `<p class="hidden-note">${hiddenCount} read stor${hiddenCount === 1 ? 'y' : 'ies'} hidden</p>`;
}

function renderNavLinks(active = null) {
  return `
    <nav class="nav-links" aria-label="Sections">
      <a class="nav-pill" href="/archive"${active === 'archive' ? ' aria-current="page"' : ''}>${ICONS.archive}<span>Archive</span></a>
      <a class="nav-pill" href="/admin"${active === 'admin' ? ' aria-current="page"' : ''}>${ICONS.admin}<span>Admin</span></a>
    </nav>`;
}

function renderPage(stories, { hideRead = false, hiddenCount = 0 } = {}) {
  const hasPending = stories.some((s) => s.summary_status === 'pending' || s.summary_status === 'processing');
  const refreshTag = hasPending ? '<meta http-equiv="refresh" content="20">' : '';
  const list = stories.length
    ? stories.map((s, i) => renderStory(s, i === 0)).join('\n')
    : hideRead && hiddenCount
      ? '<p class="empty">All caught up — read stories are hidden.</p>'
      : '<p class="empty">No stories yet — the worker hasn\'t run.</p>';
  const navLinks = renderNavLinks();
  const headerActions = `<div class="header-actions">${renderHideReadToggle('/', hideRead)}${navLinks}</div>`;
  const footer = `
    <div class="page-footer">
      <div class="footer-actions">${renderMarkReadForm('/read-all')}</div>
      ${renderHiddenNote(hideRead, hiddenCount)}
    </div>`;

  return renderLayout({ body: `${list}\n${footer}`, refreshTag, headerExtra: headerActions, liveBadge: hasPending });
}

function renderArchiveNav({ date, prevDate, nextDate }) {
  return `
    <nav class="archive-nav" aria-label="Archive navigation">
      <a class="archive-nav-btn" href="/archive/${prevDate}">${ICONS.chevronLeft}<span>${prevDate}</span></a>
      <span class="archive-date">${date}</span>
      ${
        nextDate
          ? `<a class="archive-nav-btn" href="/archive/${nextDate}"><span>${nextDate}</span>${ICONS.chevronRight}</a>`
          : `<span class="archive-nav-btn is-disabled"><span>Today</span>${ICONS.chevronRight}</span>`
      }
    </nav>`;
}

function renderArchivePage({ date, stories, prevDate, nextDate, hideRead = false, hiddenCount = 0 }) {
  const nav = renderArchiveNav({ date, prevDate, nextDate });
  const list = stories.length
    ? stories.map((s, i) => renderStory(s, i === 0)).join('\n')
    : hideRead && hiddenCount
      ? '<p class="empty">All caught up — read stories are hidden.</p>'
      : '<p class="empty">No stories for this day.</p>';
  const navLinks = renderNavLinks('archive');
  const headerActions = `<div class="header-actions">${renderHideReadToggle(`/archive/${date}`, hideRead)}${navLinks}</div>`;
  const footer = `
    <div class="page-footer">
      ${nav}
      <div class="footer-actions">${renderMarkReadForm(`/archive/${date}/read-all`)}</div>
      ${renderHiddenNote(hideRead, hiddenCount)}
    </div>`;

  return renderLayout({ body: `${nav}\n${list}\n${footer}`, headerExtra: headerActions });
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

  return renderLayout({ body, headerExtra: `<div class="header-actions">${renderNavLinks('admin')}</div>` });
}

module.exports = { renderPage, renderArchivePage, renderAdminPage };
