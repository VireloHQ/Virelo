// Run against `npx wrangler pages dev dist`; isolated browser storage, no uploads.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.VIRELO_TEST_PAGES_URL || 'http://127.0.0.1:8788';
const browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=no-user-gesture-required'],
  ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}) });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS', label); };
try {
  const context = await browser.newContext();
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__cspViolations.push(event.violatedDirective + ': ' + event.blockedURI));
  });
  for (const path of ['/', '/app', '/app/settings', '/app/favorites', '/favorites', '/app/watch/123', '/library', '/settings', '/shorts']) {
    const response = await context.request.get(base + path);
    check(response.status() === 200 && response.headers()['content-type'].includes('text/html'), 'SPA navigation ' + path);
    check(response.headers()['cache-control'].includes('no-cache'), 'fresh HTML ' + path);
  }
  for (const path of ['/assets/missing.js', '/assets/nested/missing.css', '/assets/missing.wasm', '/unknown']) {
    const response = await context.request.get(base + path);
    check(response.status() === 404, 'real missing-file status ' + path);
  }
  const html = await (await context.request.get(base)).text();
  const script = html.match(/src="(\/assets\/app-[^"]+\.js)"/)[1];
  const asset = await context.request.get(base + script);
  check(asset.status() === 200 && /javascript/.test(asset.headers()['content-type']), 'hashed JS is not rewritten to HTML');
  check(asset.headers()['cache-control'].includes('immutable'), 'hashed assets cached');
  const worker = await context.request.get(base + '/sw.js');
  check(worker.headers()['cache-control'].includes('no-cache'), 'service worker refreshed');
  await page.goto(base);
  await page.locator('.app-shell').waitFor();
  check((await page.evaluate(() => window.__cspViolations)).length === 0, 'player has no CSP violations');
  await page.goto(base + '/app/settings'); await page.locator('.settings-heading').waitFor();
  check(await page.evaluate(async () => {
    const module = await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0]));
    const url = URL.createObjectURL(new Blob(['local media']));
    try { return module instanceof WebAssembly.Module && await (await fetch(url)).text() === 'local media'; }
    finally { URL.revokeObjectURL(url); }
  }), 'WASM compilation and local blob reads permitted');
  check(await page.evaluate(async () => {
    const url = URL.createObjectURL(new Blob(['onmessage=event=>postMessage(event.data)'], { type: 'text/javascript' }));
    const worker = new Worker(url);
    try { return await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Blob worker timeout')), 5000);
      worker.onmessage = event => { clearTimeout(timer); resolve(event.data === 'ready'); };
      worker.onerror = event => { clearTimeout(timer); reject(new Error(event.message)); };
      worker.postMessage('ready');
    }); } finally { worker.terminate(); URL.revokeObjectURL(url); }
  }), 'local blob worker permitted');
  check((await page.evaluate(() => window.__cspViolations)).length === 0, 'app has no CSP violations');
  check(await page.evaluate(() => navigator.serviceWorker.ready.then(registration => registration.active.scriptURL.endsWith('/sw.js'))), 'PWA service worker registers');
  check(errors.length === 0, 'no runtime errors: ' + errors.join('|'));
  await context.close();
  console.log(JSON.stringify({ checks, result: 'passed' }));
} finally { await browser.close(); }
