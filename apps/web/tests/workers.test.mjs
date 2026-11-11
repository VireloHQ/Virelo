import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const config = JSON.parse(await readFile(new URL('wrangler.jsonc', root), 'utf8'));

test('Workers previews inherit the top-level static build and compatibility settings', async () => {
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(config.name, pkg.name);
  assert.match(config.compatibility_date, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(config.previews, {}, 'wrangler preview requires an explicit previews block');
  assert.equal(config.assets.directory, './dist');
  assert.equal(config.main, undefined, 'the browser-only app needs no Worker script');
});

test('Workers retain route-specific SPA rewrites, security headers and real custom 404s', async () => {
  assert.equal(config.assets.not_found_handling, '404-page', 'do not rewrite missing assets to the SPA');
  assert.equal(config.assets.run_worker_first, undefined, 'static responses must retain _headers');
  const assets = new URL(config.assets.directory + '/', root);
  for (const file of ['_headers', '_redirects', '404.html']) {
    assert.equal(await readFile(new URL(file, assets), 'utf8'),
      await readFile(new URL('web/public/' + file, root), 'utf8'), file);
  }
});
