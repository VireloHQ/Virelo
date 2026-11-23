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
  if (!/^\s/.test(line)) rules.push({ path: line.trim(), headers: [] });
  else {
    const detach=line.match(/^\s+!\s+([^:]+)$/);
    if(detach){rules.at(-1).headers.push([detach[1].trim().toLowerCase(),null]);continue;}
    const [, name, value] = line.match(/^\s+([^:]+):\s*(.+)$/);
    rules.at(-1).headers.push([name.toLowerCase(),value.trim()]);
  }
}
const headers = path => {
  const result={};
  for(const rule of rules)if(matches(rule.path,path))for(const [name,value] of rule.headers){
    if(value===null)delete result[name];
    else result[name]=result[name]?`${result[name]}, ${value}`:value;
  }
  return result;
};

test('Workers Static Assets receives host rules and custom 404 in the production build', async () => {
  for (const file of ['_headers', '_redirects', '404.html']) {
    assert.equal(await readFile(new URL(file, dist), 'utf8'), await readFile(new URL(file, source), 'utf8'), file);
  }
  assert.equal((await readFile(new URL('../../../.node-version', import.meta.url), 'utf8')).trim(), '22.23.4');
});

test('Workers rewrites application and legacy routes, never missing assets', () => {
  const shell = path => redirects.some(([pattern, target, status]) => matches(pattern, path) && target === '/app' && status === '200');
  for (const path of ['/app/library', '/app/favorites', '/favorites', '/app/settings', '/app/shorts', '/app/watch/123', '/app/title/123', '/library', '/settings', '/shorts', '/watch/123', '/title/123', '/app/live-tv', '/live-tv']) {
    assert.ok(shell(path), path);
  }
  for (const path of ['/', '/setup', '/setup/', '/ja', '/ja/setup', '/assets', '/assets/', '/assets/missing.js', '/assets/missing.css', '/assets/nested/missing.wasm', '/sw.js', '/landing/shorts-demo.mp4', '/missing.png', '/unknown','/media/iptv/']) {
    assert.equal(shell(path), false, path);
  }
  assert.ok(!redirects.some(([pattern, target]) => pattern === '/app' || target.endsWith('.html')), 'Clean HTML handling serves /app directly; rewritten .html targets cause a redirect loop on Workers');
});

test('Workers keeps HTML and PWA entry points fresh, but caches hashed assets', () => {
  for (const path of ['/', '/index.html', '/setup', '/setup/', '/app', '/app/watch/123', '/sw.js', '/manifest.webmanifest']) {
    assert.equal(headers(path)['cache-control'], 'no-cache', path);
  }
  assert.equal(headers('/assets/player-abc.js')['cache-control'], 'public, max-age=31536000, immutable');
  assert.equal(headers('/app')['x-content-type-options'], 'nosniff');
  assert.equal(headers('/app')['cross-origin-opener-policy'], 'same-origin');
});

test('Workers CSP permits blob media/workers and WASM without JavaScript eval', () => {
  const csp = headers('/app')['content-security-policy'];
  for (const directive of ["media-src 'self' blob:", "worker-src 'self' blob:", "connect-src 'self' blob:", "script-src 'self' 'wasm-unsafe-eval'", "object-src 'none'", "frame-ancestors 'none'"]) {
    assert.ok(csp.includes(directive), directive);
  }
  assert.equal(csp.includes("'unsafe-eval'"), false);
  assert.equal(csp.includes('https:'), false);
});

test('Live TV keeps the shell CSP and only the same-origin playback frame can connect to providers',async()=>{
  const normal=headers('/app')['content-security-policy'];
  const live=headers('/media/iptv/');
  const policy=live['content-security-policy'];
  assert.equal(policy.match(/default-src/g).length,1,'replace the inherited CSP instead of joining policies');
  assert.match(policy,/media-src 'self' blob: https:;/);
  assert.match(policy,/connect-src 'self' blob: https:;/);
  assert.match(policy,/script-src 'self';/);
  assert.match(policy,/frame-src 'none'; frame-ancestors 'self';/);
  assert.equal(live['cache-control'],'no-store');
  assert.equal(live['referrer-policy'],'no-referrer');
  assert.equal(live['x-robots-tag'],'noindex');
  assert.equal(headers('/app/library')['content-security-policy'],normal);
  assert.equal(headers('/app/live-tv')['content-security-policy'],normal);
  assert.equal(headers('/live-tv')['content-security-policy'],normal);
  assert.equal(headers('/media/other')['content-security-policy'],normal);
  assert.match(await readFile(new URL('media/iptv/index.html',dist),'utf8'),/<title>Live TV \| Virelo<\/title>/);
});

test('production files fit Cloudflare Workers static upload limits', async () => {
  let count = 0;
  async function check(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
      if (entry.isDirectory()) await check(url);
      else { assert.ok((await stat(url)).size <= 25 * 1024 * 1024, entry.name); count++; }
    }
  }
  await check(dist);
  assert.ok(count <= 20000, 'Workers Free plan file count');
});
