// Verify the real first frame with JavaScript held back, using isolated browser storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    const withinRoot = relative(root, path);
    if (withinRoot === '..' || withinRoot.startsWith('..' + sep)) {
      response.writeHead(403).end();
      return;
    }
    let data, extension = extname(path);
    try { data = await readFile(path); }
    catch {
      if (extension || url.pathname.startsWith('/assets/')) {
        response.writeHead(404).end();
        return;
      }
      const publicFile = url.pathname === '/' ? 'index.html' : url.pathname.slice(1) + '.html';
      data = await readFile(resolve(root, url.pathname.startsWith('/app') ? 'app.html' : publicFile));
      extension = '.html';
    }
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json' }[extension] || 'application/octet-stream',
    });
    response.end(data);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const base = 'http://127.0.0.1:' + server.address().port;
let browser, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label); };
try {
  browser = await chromium.launch({ headless: true, ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}) });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const pathname of ['/', '/app', '/app/library']) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport });
      const page = await context.newPage();
      let releaseScripts;
      const gate = new Promise(resolve => { releaseScripts = resolve; });
      await page.route('**/*.js', async route => { await gate; await route.continue().catch(() => {}); });
      try {
        await page.goto(base + pathname, { waitUntil: 'commit' });
        await page.locator('#root').waitFor({ state: 'attached' });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        check(await page.locator('.static-shell').count() === 0, `${pathname} ${viewport.width}: no fallback landing page before JavaScript`);
        check(await page.locator('#root').innerHTML() === '', pathname + ' ' + viewport.width + ': no marketing content in the first app frame');
      } finally { releaseScripts(); await context.close(); }
    }
  }

  // Even with the bundled CSS unavailable, the browser must never paint a white boot screen.
  const unstyled = await browser.newContext({ serviceWorkers: 'block' });
  const unstyledPage = await unstyled.newPage();
  await unstyledPage.route(/\.(js|css)(\?|$)/, route => route.abort());
  await unstyledPage.goto(base + '/app');
  const background = await unstyledPage.evaluate(() => ({
    html: getComputedStyle(document.documentElement).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
    margin: getComputedStyle(document.body).margin,
  }));
  check(background.html === 'rgb(9, 9, 9)' && background.body === 'rgb(9, 9, 9)' && background.margin === '0px', 'dark, margin-free first frame without bundled CSS or JavaScript');
  await unstyled.close();

  const context = await browser.newContext({ serviceWorkers: 'block' });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__fallbackFlash = false;
    window.__splashSeen = false;
    const observeFrame = () => {
      window.__fallbackFlash ||= !!document.querySelector('.static-shell');
      window.__splashSeen ||= !!document.querySelector('.splash-screen');
      requestAnimationFrame(observeFrame);
    };
    requestAnimationFrame(observeFrame);
  });
  await page.goto(base + '/app');
  await page.waitForFunction(() => window.__splashSeen);
  await page.locator('.splash-screen').waitFor({ state: 'hidden' });
  await page.locator('.app-shell .topbar').waitFor();
  check(await page.evaluate(() => !window.__fallbackFlash), 'no fallback flash across the full app startup');
  check(await page.evaluate(() => window.__splashSeen), 'the Virelo splash still appears and finishes normally');
  await page.goto(base);
  await page.locator('.app-shell').waitFor();
  check(await page.locator('.page-shell').isVisible(), 'the standalone root opens the player');
  check(errors.length === 0, 'no startup runtime errors: ' + errors.join(' | '));
  await context.close();

  const nojs = await browser.newContext({ javaScriptEnabled: false, serviceWorkers: 'block' });
  const nojsPage = await nojs.newPage();
  await nojsPage.goto(base);
  check(await nojsPage.locator('noscript p').isVisible() && (await nojsPage.locator('noscript p').textContent()).includes('Enable JavaScript to open local videos in Virelo.'), 'JavaScript-disabled visitors get actionable guidance');
  check(await nojsPage.locator('a[href="https://virelo.riyo.me/setup"]').isVisible(), 'self-hosted no-JavaScript help links to the independently maintained guide');
  await nojs.close();
  console.log(JSON.stringify({ checks }));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(done => server.close(done));
}
