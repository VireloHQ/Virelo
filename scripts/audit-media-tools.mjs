import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const artifacts = await mkdtemp(join(tmpdir(), 'virelo-media-tools-'));
const server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
  { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, checks = 0;
try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output)), 20000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.stderr.on('data', chunk => { output += chunk; });
    server.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
  browser = await chromium.launch({ headless: true, ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}) });
  const states = [
    { name: 'available', body: { ffmpeg: true, ffprobe: true }, labels: ['Available', 'Available'], icons: 2 },
    { name: 'missing', body: { ffmpeg: false, ffprobe: false }, labels: ['Not found', 'Not found'], icons: 2 },
    { name: 'mixed', body: { ffmpeg: true, ffprobe: false }, labels: ['Available', 'Not found'], icons: 2 },
    { name: 'pending', labels: ['Checking…', 'Checking…'], icons: 0 },
    { name: 'error', labels: ['Could not check', 'Could not check'], icons: 0 }
  ];
  for (const width of [1440, 390, 320]) for (const state of states) {
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [], writes = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(path);
      if (path === '/api/health') {
        if (state.name === 'pending') return;
        return route.fulfill({ status: state.name === 'error' ? 503 : 200, json: state.body || { message: 'Unavailable' } });
      }
      const body = path === '/api/auth/status' ? { setupRequired: false, localAccess: true, monitoring: { enabled: false },
        user: { id: 1, username: 'admin', displayName: 'Admin', isAdmin: true, enabled: true, revision: 1, permissions: {} } }
        : path === '/api/settings' ? { queueBehavior: 'auto', externalMetadataEnabled: false }
        : path === '/api/notifications' ? { items: [], unread: 0 }
        : path === '/api/libraries' ? [] : { running: false };
      return route.fulfill({ json: body });
    });
    await page.goto(base + '/settings#tools');
    const tools = page.locator('.tool-status');
    await page.waitForFunction(expected => JSON.stringify([...document.querySelectorAll('.tool-status dd')].map(node => node.textContent.trim())) === JSON.stringify(expected), state.labels);
    await page.locator('.splash-screen').waitFor({ state: 'hidden' });
    assert.deepEqual(await tools.locator('dt').allTextContents(), ['FFmpeg', 'ffprobe']);
    assert.equal(await tools.locator('svg').count(), state.icons);
    assert.ok(await tools.evaluate(element => {
      const box = element.getBoundingClientRect(), style = getComputedStyle(element);
      return style.borderRadius === '10px' && style.borderTopWidth === '1px'
        && document.documentElement.scrollWidth <= innerWidth && box.width > 0
        && [...element.children].every(row => {
          const term = row.querySelector('dt').getBoundingClientRect(), value = row.querySelector('dd'), rect = value.getBoundingClientRect();
          const color = getComputedStyle(value).color.match(/\d+(?:\.\d+)?/g).slice(0, 3).map(Number);
          return rect.left >= term.right + 10 && rect.right <= box.right && Math.max(...color) - Math.min(...color) <= 15;
        });
    }), state.name + ' uses aligned neutral rows without overflow at ' + width + 'px');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []);
    await page.screenshot({ path: join(artifacts, state.name + '-' + width + '.png'), fullPage: true });
    checks++; console.log('PASS', state.name, width);
    await context.close();
  }
  console.log(JSON.stringify({ checks, artifacts, result: 'passed' }));
} finally {
  await browser?.close(); server.kill();
}
