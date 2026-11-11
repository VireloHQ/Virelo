import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('production player menus retain standard backdrop blur, not only the WebKit alias', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const dist = new URL(pkg.name === 'virelo' ? '../dist/web/' : '../dist/', import.meta.url);
  const html = await readFile(new URL('index.html', dist), 'utf8');
  const asset = html.match(/href="(\/assets\/index-[^"]+\.css)"/)?.[1];
  assert.ok(asset, 'production HTML must reference its stylesheet');
  const css = await readFile(new URL(asset.slice(1), dist), 'utf8');
  const menuRules = [...css.matchAll(/\.playback-settings-menu\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(menuRules.some(rule => /(?:^|;)backdrop-filter:blur\(18px\)(?:;|$)/.test(rule)),
    'CSS optimization must not strip the standard backdrop-filter declaration');
  const contextRules = [...css.matchAll(/\.context-popover\{([^}]+)\}/g)].map(match => match[1]);
  assert.ok(contextRules.some(rule => /(?:^|;)backdrop-filter:blur\(18px\)(?:;|$)/.test(rule)), 'context menus retain standard blur');
  assert.ok(contextRules.some(rule => /background:#18181c(?:;|$)/.test(rule)), 'context menus have an opaque fallback');
  assert.ok(menuRules.some(rule => /background:#18181c(?:;|$)/.test(rule)),
    'browsers without blur must have an opaque, readable fallback');
});
