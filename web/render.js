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

function renderPage(stories) {
  const hasPending = stories.some((s) => s.summary_status === 'pending' || s.summary_status === 'processing');
  const refreshTag = hasPending ? '<meta http-equiv="refresh" content="20">' : '';
  const list = stories.length
    ? stories.map(renderStory).join('\n')
    : '<p class="empty">No stories yet — the worker hasn\'t run.</p>';
  const archiveLink = '<a class="archive-link" href="/archive">Archive</a>';
  const footer = `<div class="page-footer">${archiveLink}${renderMarkReadForm('/read-all')}</div>`;

  return renderLayout({ body: `${list}\n${footer}`, refreshTag, headerExtra: archiveLink });
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

  return renderLayout({ body: `${nav}\n${list}\n${footer}` });
}

module.exports = { renderPage, renderArchivePage };
