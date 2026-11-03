import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { publicPages, origin, assertPublicHtml } from '../scripts/helpers/public-seo.mjs';
import { publicLocaleForPath } from '../web/src/i18n/locale.ts';

test('all ten public pages contain localized, crawlable HTML and reciprocal search metadata', async () => {
  const titles = new Set();
  for (const page of publicPages) {
    const file = page.path === '/' ? 'index.html' : page.path.slice(1) + '.html';
    const html = await readFile(new URL('../dist/' + file, import.meta.url), 'utf8');
    assertPublicHtml(html, page);
    titles.add(page.title);
  }
  assert.equal(titles.size, 10);
});

test('sitemap lists only the ten canonical public URLs with a content revision date', async () => {
  const xml = await readFile(new URL('../dist/sitemap.xml', import.meta.url), 'utf8');
  assert.deepEqual([...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map(item => item[1]), publicPages.map(item => origin + item.path));
  assert.equal((xml.match(/<lastmod>2026-11-03<\/lastmod>/g) || []).length, 10);
});

test('private app has its own non-indexable shell rather than duplicate marketing HTML', async () => {
  const html = await readFile(new URL('../dist/app.html', import.meta.url), 'utf8');
  assert.ok(html.includes('<div id="root"></div>'));
  assert.ok(html.includes('name="robots" content="noindex, follow"'));
  assert.ok(!html.includes('application/ld+json') && !html.includes('landing-title'));
});

test('public URL language is explicit and never overrides locale on private or unknown routes', () => {
  for (const page of publicPages) {
    assert.equal(publicLocaleForPath(page.path), page.locale);
    assert.equal(publicLocaleForPath(page.path + (page.path === '/' ? '' : '/')), page.locale);
  }
  for (const path of ['/app','/app/settings','/ja/unknown','/en','/EN','/ja/app','/unknown','/setup/other']) assert.equal(publicLocaleForPath(path), null, path);
});

test('social image is a real 1200 by 630 PNG and crawler policy separates search from training', async () => {
  const png = await readFile(new URL('../web/public/og/virelo.png', import.meta.url));
  assert.equal(png.subarray(1,4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
  const robots = await readFile(new URL('../web/public/robots.txt', import.meta.url), 'utf8');
  for (const agent of ['OAI-SearchBot','ChatGPT-User','Claude-SearchBot','Claude-User','PerplexityBot']) {
    assert.ok(robots.includes('User-agent: ' + agent));
  }
  const training = robots.slice(robots.indexOf('User-agent: GPTBot'));
  for (const agent of ['GPTBot','ClaudeBot','Google-Extended','CCBot']) assert.ok(training.includes('User-agent: ' + agent));
  assert.ok(training.includes('Disallow: /') && !training.includes('Allow: /'));
  assert.ok(robots.includes('Sitemap: ' + origin + '/sitemap.xml'));
  const full = await readFile(new URL('../web/public/llms-full.txt', import.meta.url), 'utf8');
  assert.equal(await readFile(new URL('../dist/product.md', import.meta.url), 'utf8'), full);
});
