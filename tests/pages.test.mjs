import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';

const source = new URL('../web/public/', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const redirects = (await readFile(new URL('_redirects', source), 'utf8')).split('\n')
  .map(line => line.trim()).filter(line => line && !line.startsWith('#')).map(line => line.split(/\s+/));
const matches = (pattern, path) => new RegExp('^' + pattern.replaceAll('.', '\\.').replaceAll('*', '.*') + '$').test(path);
const rules = [];
for (const line of (await readFile(new URL('_headers', source), 'utf8')).split('\n')) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: {} });
  else {
    const [, name, value] = line.match(/^\s+([^:]+):\s*(.+)$/);
    rules.at(-1).headers[name.toLowerCase()] = value.trim();
  }
}
const headers = path => Object.assign({}, ...rules.filter(rule => matches(rule.path, path)).map(rule => rule.headers));

test('Pages receives its host rules and custom 404 in the production build', async () => {
  for (const file of ['_headers', '_redirects', '404.html']) {
    assert.equal(await readFile(new URL(file, dist), 'utf8'), await readFile(new URL(file, source), 'utf8'), file);
  }
  assert.equal((await readFile(new URL('../.node-version', import.meta.url), 'utf8')).trim(), '22.23.4');
});

test('Pages rewrites application and legacy routes, never missing assets', () => {
  const shell = path => redirects.some(([pattern, target, status]) => matches(pattern, path) && target === '/app' && status === '200');
  for (const path of ['/app/library', '/app/favorites', '/favorites', '/app/settings', '/app/shorts', '/app/watch/123', '/app/title/123', '/library', '/settings', '/shorts', '/watch/123', '/title/123']) {
    assert.ok(shell(path), path);
  }
  for (const path of ['/', '/setup', '/setup/', '/ja', '/ja/setup', '/assets', '/assets/', '/assets/missing.js', '/assets/missing.css', '/assets/nested/missing.wasm', '/sw.js', '/landing/shorts-demo.mp4', '/missing.png', '/unknown']) {
    assert.equal(shell(path), false, path);
  }
  assert.ok(!redirects.some(([pattern, target]) => pattern === '/app' || target.endsWith('.html')), 'Clean HTML handling serves /app directly; rewritten .html targets cause a redirect loop on Workers');
});

test('Pages keeps HTML and PWA entry points fresh, but caches hashed assets', () => {
  for (const path of ['/', '/index.html', '/setup', '/setup/', '/app', '/app/watch/123', '/sw.js', '/manifest.webmanifest']) {
    assert.equal(headers(path)['cache-control'], 'no-cache', path);
  }
  assert.equal(headers('/assets/player-abc.js')['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(headers('/app')['x-content-type-options'], 'nosniff');
  assert.equal(headers('/app')['cross-origin-opener-policy'], 'same-origin');
});

test('Pages CSP permits LP media, blob media/workers and WASM without JavaScript eval', () => {
  const csp = headers('/app')['content-security-policy'];
  for (const directive of ["media-src 'self' blob:", "worker-src 'self' blob:", "connect-src 'self' blob:", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.equal(csp.includes("'unsafe-eval'"), false);
  assert.equal(csp.includes('https:'), false);
});

test('production files fit Cloudflare Pages static upload limits', async () => {
  let count = 0;
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await check(url);
      else { assert.ok((await stat(url)).size <= 25 * 1024 * 1024, entry.name); count++; }
    }
  }
  await check(dist);
  assert.ok(count <= 20000, 'Pages Free plan file count');
});
