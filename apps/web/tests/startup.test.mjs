import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');

test('the React root is empty before JavaScript starts', () => {
  assert.match(html, /<div id="root">\s*<\/div>/);
});

test('the private app has a JavaScript notice, not a duplicate marketing page', () => {
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(fallback);
  assert.match(fallback, /Enable JavaScript/);
  assert.match(fallback, /About Virelo/);
  assert.doesNotMatch(html, /class="static-shell"|Your collection\./);
  assert.match(html, /name="robots" content="noindex, follow"/);
});

test('critical startup styling provides a dark background without an external stylesheet', () => {
  assert.match(html, /html,body\{margin:0;background:var\(--page,#090909\);color:var\(--text,#f5f5f5\)\}/);
});
