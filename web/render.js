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
  const image =
    story.summary_status === 'done' && story.image_url
      ? `<a class="story-media" href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">
           <img src="${escapeHtml(story.image_url)}" alt="" loading="lazy">
         </a>`
      : `<div class="story-media story-media-placeholder" aria-hidden="true"></div>`;

  return `
    <article class="story">
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

function renderPage(stories) {
  const hasPending = stories.some((s) => s.summary_status === 'pending' || s.summary_status === 'processing');
  const refreshTag = hasPending ? '<meta http-equiv="refresh" content="20">' : '';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  ${refreshTag}
  <title>HN Express</title>
  <link rel="stylesheet" href="/style.css">
</head>
<body>
  <header>
    <h1><a href="/">HN Express</a></h1>
    <p class="tagline">The HN front page, with AI summaries generated locally.</p>
  </header>
  <main>
    ${stories.length ? stories.map(renderStory).join('\n') : '<p class="empty">No stories yet — the worker hasn\'t run.</p>'}
  </main>
</body>
</html>`;
}

module.exports = { renderPage };
