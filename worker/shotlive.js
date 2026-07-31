const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, colorScheme: 'dark' });
  const wsFrames = [];
  page.on('websocket', (ws) => {
    ws.on('framereceived', (f) => wsFrames.push(String(f.payload)));
  });
  page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

  await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
  await page.evaluate(() => { window.__navMarker = 'no-reload-proof'; });

  const before = await page.locator('.summary-pending').count();
  console.log('pending before:', before);

  // Wait up to 60s for at least one WS frame to arrive (triggered externally)
  const start = Date.now();
  while (wsFrames.length === 0 && Date.now() - start < 60000) {
    await page.waitForTimeout(500);
  }

  console.log('frames received:', wsFrames.length);
  if (wsFrames.length) console.log('first frame:', wsFrames[0].slice(0, 300));

  const markerStillSet = await page.evaluate(() => window.__navMarker);
  console.log('marker survived (proves no full reload):', markerStillSet);

  const after = await page.locator('.summary-pending').count();
  console.log('pending after:', after);

  const badgeHiddenAfter = await page.locator('#live-badge').evaluate(el => el.classList.contains('is-hidden'));
  console.log('badge hidden after:', badgeHiddenAfter);

  await browser.close();
})();
