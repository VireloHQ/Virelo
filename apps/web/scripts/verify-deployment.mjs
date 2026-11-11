import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const origin = new URL(process.argv[2] || 'https://app.virelo.dev');
assert.ok(['http:','https:'].includes(origin.protocol),'Expected an HTTP(S) origin');
const get = path => fetch(new URL(path,origin),{cache:'no-store',signal:AbortSignal.timeout(20000)});
for (const path of origin.hostname === 'app.virelo.dev' ? ['/','/settings','/library','/playlists','/playlists/1','/watch/1'] : ['/app','/app/settings','/app/library','/app/playlists']) {
  const response = await get(path);
  assert.equal(response.status,200,path);
  assert.ok(response.headers.get('content-security-policy')?.includes("script-src 'self' 'wasm-unsafe-eval'"),path+': CSP');
  const html = await response.text();
  assert.match(html,/name="robots" content="noindex, follow"/,path);
  assert.doesNotMatch(html,/landing-title|application\/ld\+json/,path);
  const entry = html.match(/<script type="module"[^>]*src="([^"]+\.js)"/)?.[1];
  assert.match(entry ?? '',/^\/assets\/[\w-]+\.js$/,path+': hashed player entry');
  const script = await get(entry);
  assert.equal(script.status,200,entry);
  assert.match(script.headers.get('content-type') ?? '',/javascript/,entry);
  console.log('Verified player route:',path);
}
const license = await get('/LICENSE.txt');
assert.equal(license.status,200);
assert.equal((await license.text()).replaceAll('\r',''),(await readFile(new URL('../LICENSE',import.meta.url),'utf8')).replaceAll('\r',''));
for(const path of ['/manifest.webmanifest','/sw.js']) assert.equal((await get(path)).status,200,path);
assert.equal((await get('/assets/virelo-missing-deployment-probe.js')).status,404);
console.log('Verified the independently deployed player at',origin.origin);
