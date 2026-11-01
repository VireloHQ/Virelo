import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const origin = new URL(process.argv[2] || 'https://virelo.riyo.me');
assert.ok(['http:','https:'].includes(origin.protocol), 'Expected an HTTP(S) site URL');
async function get(path) {
  const url = new URL(path, origin);
  url.searchParams.set('virelo-verify', String(Date.now()));
  return fetch(url, {cache:'no-store',signal:AbortSignal.timeout(20000)});
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const response = await get('/');
assert.equal(response.status,200);
const html = await response.text();
const entry = html.match(/src="([^"]*\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(entry,'Production HTML must reference a hashed app entry');
const bundle = await get(entry);
assert.equal(bundle.status,200);
const landing = (await bundle.text()).match(/LandingView-[\w-]+\.js/)?.[0];
assert.ok(landing,'Production app must include the landing route');
const route = await get('/assets/'+landing);
assert.equal(route.status,200);
const code = await route.text();
for (const name of ['hero-coast.webp','shorts-blender-demo.mp4','library-credits.txt']) assert.ok(code.includes(name),'Landing route uses '+name);
for (const message of ['Your playlists. Your order.','A more comfortable volume.','Movie and series info, posters and backdrops, matched automatically.']) {
  assert.ok(code.includes(message),'Deployed landing includes current feature: '+message);
}

await Promise.all(['hero-coast.webp','library-desktop.webp','library-mobile.webp','player-desktop.webp','player-mobile.webp','library-credits.txt','shorts-blender-demo.mp4','shorts-blender-demo.webp','shorts-blender-credits.txt'].map(async name=>{
  const deployed = await get('/landing/'+name);
  assert.equal(deployed.status,200,name);
  const actual = Buffer.from(await deployed.arrayBuffer());
  const expected = await readFile(new URL('../web/public/landing/'+name,import.meta.url));
  assert.equal(digest(actual),digest(expected),'Deployed bytes match the repository: '+name);
  console.log('Verified:',name);
}));
const missing = await get('/assets/virelo-missing-deployment-probe.js');
assert.equal(missing.status,404,'Missing scripts must not return an HTML app shell');
console.log('Verified live landing assets and missing-module handling at',origin.origin);
