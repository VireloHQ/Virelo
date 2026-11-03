import assert from 'node:assert/strict';
import seo from '../../web/src/i18n/public-seo.json' with { type: 'json' };

export const origin = 'https://virelo.riyo.me';
// Rollup's dependency chunk hashes can differ between Windows and Linux builds.
// Compare the entry code, not those generated filenames.
export const normalizeEntryChunks = code => code.replace(/-[\w-]{8}(?=\.(?:js|css)\b)/g, '-BUILD');
export const publicPages = Object.entries(seo).flatMap(([locale, copy]) => {
  const prefix = locale === 'en' ? '' : '/' + locale;
  return [
    { locale, path: prefix || '/', title: copy.landing, description: copy.description, page: 'landing' },
    { locale, path: prefix + '/setup', title: copy.setup, description: copy.guide, page: 'setup' }
  ];
});
const escape = value => value.replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function assertPublicHtml(html, expected) {
  const {path, locale, title, description, page} = expected;
  assert.ok(html.includes('<html lang="' + locale + '"'), path + ': HTML language');
  assert.ok(html.includes('<title>' + escape(title) + '</title>'), path + ': localized title');
  assert.ok(html.includes('name="description" content="' + escape(description) + '"'), path + ': description');
  assert.equal((html.match(/rel="canonical"/g) || []).length, 1, path + ': single canonical');
  assert.ok(html.includes('rel="canonical" href="' + origin + path + '"'), path + ': self canonical');
  assert.equal((html.match(/<h1\b/g) || []).length, 1, path + ': one rendered H1');
  assert.ok(html.includes('id="' + (page === 'landing' ? 'landing-title' : 'setup-title') + '"'), path + ': actual page');
  assert.ok(!html.includes('<div id="root"></div>'), path + ': rendered without JavaScript');
  assert.ok(html.includes('max-image-preview:large'), path + ': image preview allowed');
  assert.ok(!html.includes('content="noindex'), path + ': indexable public page');
  const alternates = publicPages.filter(item => item.page === page);
  for (const item of [...alternates,{locale:'x-default',path:page === 'landing' ? '/' : '/setup'}]) {
    assert.ok(html.includes('hreflang="' + item.locale + '" href="' + origin + item.path + '"'), path + ': alternate ' + item.locale);
  }
  assert.equal((html.match(/hreflang="/g) || []).length, 6, path + ': complete reciprocal hreflang');
  assert.ok(html.includes('property="og:url" content="' + origin + path + '"'), path + ': matching Open Graph URL');
  assert.ok(html.includes('name="twitter:card" content="summary_large_image"'), path + ': large social card');
  assert.ok(html.includes('property="og:image" content="' + origin + '/og/virelo.png"'), path + ': local social image');
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1])['@graph'];
  const webPage = graph.find(item => item['@type'] === 'WebPage');
  assert.equal(webPage.url, origin + path);
  assert.equal(webPage.inLanguage, locale);
  const application = graph.find(item => item['@type'] === 'SoftwareApplication');
  assert.equal(application.offers.price, '0');
  assert.equal(application.license, 'https://www.gnu.org/licenses/agpl-3.0.html');
  assert.equal(application.softwareHelp.url, origin + publicPages.find(item => item.locale === locale && item.page === 'setup').path);
  assert.ok(!application.aggregateRating && !application.review && !application.downloadUrl, 'No invented ratings, reviews or downloads');
  const faq = graph.find(item => item['@type'] === 'FAQPage');
  if (page === 'landing') {
    assert.equal(faq.mainEntity.length, 6, path + ': six visible FAQs');
    assert.equal((html.match(/<details>/g) || []).length, faq.mainEntity.length);
  } else assert.equal(faq, undefined, 'Guide must not reuse landing FAQ');
  return graph;
}
