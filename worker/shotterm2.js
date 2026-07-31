const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, colorScheme: 'dark' });
  const terminalFrames = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => {
      try {
        const msg = JSON.parse(String(f.payload));
        if (msg.type === 'story-update') {
          for (const s of msg.stories) {
            if (['done', 'failed', 'skipped'].includes(s.summary_status)) terminalFrames.push(s);
          }
        }
      } catch {}
    });
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__navMarker = 'no-reload-proof'; });

  const start = Date.now();
  while (terminalFrames.length === 0 && Date.now() - start < 480000) {
    await page.waitForTimeout(1000);
  }

  if (terminalFrames.length === 0) {
    console.log('TIMEOUT: no terminal-status frame received');
    await browser.close();
    return;
  }

  const story = terminalFrames[0];
  console.log('terminal frame received for story', story.id, '-> status:', story.summary_status);

  const marker = await page.evaluate(() => window.__navMarker);
  console.log('no full reload occurred:', marker === 'no-reload-proof');

  const slotHtml = await page.locator(`[data-story-id="${story.id}"] .summary-slot`).innerHTML();
  console.log('patched DOM content:', slotHtml.slice(0, 200));

  const matchesExpectation =
    (story.summary_status === 'done' && slotHtml.includes(String(story.summary || '').slice(0, 20))) ||
    (story.summary_status === 'failed' && slotHtml.includes('Summary unavailable')) ||
    (story.summary_status === 'skipped' && slotHtml.trim() === '');
  console.log('DOM content matches expected status:', matchesExpectation);

  const badgeHidden = await page.locator('#live-badge').evaluate(el => el.classList.contains('is-hidden'));
  console.log('badge hidden after patch (true only if nothing else pending):', badgeHidden);

  await browser.close();
})();
