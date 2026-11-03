import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {publicPages, assertPublicHtml, normalizeEntryChunks} from './helpers/public-seo.mjs';

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
assertPublicHtml(html, publicPages[0]);
const entry = html.match(/<script type="module"[^>]*src="([^"]+\.js)"/)?.[1];
assert.match(entry ?? '', /^\/assets\/landing-[\w-]+\.js$/, 'Production HTML must reference a hashed public entry');
const expectedHtml = await readFile(new URL('../dist/index.html',import.meta.url),'utf8');
const expectedEntry = expectedHtml.match(/<script type="module"[^>]*src="([^"]+\.js)"/)?.[1];
assert.ok(expectedEntry,'Build first before verifying production');
const bundle = await get(entry);
assert.equal(bundle.status,200);
const expectedCode = await readFile(new URL('../dist' + expectedEntry,import.meta.url),'utf8');
assert.equal(normalizeEntryChunks(await bundle.text()),normalizeEntryChunks(expectedCode),'Deployed public entry code matches the build across platforms');
for (const message of ['Your playlists. Your order.','A more comfortable volume.','Is Virelo free and open source?']) assert.ok(html.includes(message),'Current feature in crawlable HTML: '+message);
await Promise.all(publicPages.slice(1).map(async page=>{
  const response=await get(page.path);assert.equal(response.status,200,page.path);
  assertPublicHtml(await response.text(),page);
  console.log('Verified localized public page:',page.path);
}));
for(const path of ['/app','/app/settings','/app/watch/1']){
  const response=await get(path),document=await response.text();assert.equal(response.status,200,path);
  assert.ok(document.includes('name="robots" content="noindex, follow"')&&!document.includes('landing-title'),'Private shell: '+path);
}
const sitemap=await get('/sitemap.xml');assert.equal(sitemap.status,200);
assert.deepEqual([...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match=>match[1]),publicPages.map(page=>'https://virelo.riyo.me'+page.path));
const card=await get('/og/virelo.png');assert.equal(card.status,200);
assert.equal(digest(Buffer.from(await card.arrayBuffer())),digest(await readFile(new URL('../web/public/og/virelo.png',import.meta.url))),'Current social image');
const facts=await get('/product.md');assert.equal(facts.status,200);
assert.equal(await facts.text(),await readFile(new URL('../web/public/llms-full.txt',import.meta.url),'utf8'),'Current machine-readable facts');
const robots=await get('/robots.txt');assert.equal(robots.status,200);
const policy=await robots.text();
assert.ok(policy.includes('User-agent: OAI-SearchBot')&&policy.includes('User-agent: Claude-SearchBot'));
assert.ok(policy.includes('User-agent: GPTBot')&&policy.includes('Disallow: /'));

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
