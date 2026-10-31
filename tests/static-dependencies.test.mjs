import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';

test('the published CLI bundles its patched static dependency tree', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
  assert.ok(pkg.bundleDependencies.includes('@fastify/static'));
  assert.equal(existsSync(new URL('../npm-shrinkwrap.json', import.meta.url)), false);
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies);
  const matches = Object.entries(lock.packages).filter(([path]) => path.endsWith('/minimatch'));
  assert.ok(matches.length);
  for (const [path, entry] of matches) {
    const [major, minor, patch] = entry.version.split('.').map(Number);
    assert.ok(major > 11 || (major === 11 && (minor > 0 || patch >= 1)), path + ' must exclude GHSA-g3hv-75wg-m249');
  }
});

test('updated static dependencies preserve glob routes, filenames, ranges and caching', async t => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-static-compat-'));
  const app = Fastify();
  t.after(async () => {
    await app.close();
    const target = relative(resolve(tmpdir()), root);
    assert.ok(target.startsWith('virelo-static-compat-') && !target.includes('..'));
    await rm(root, { recursive: true, force: true });
  });
  const files = ['nested/hello world.txt', '日本語/字幕.vtt'];
  for (const directory of ['nested', '日本語', 'ignored']) await mkdir(join(root, directory));
  for (const file of [...files, '.hidden.txt', 'ignored/internal.txt']) await writeFile(join(root, file), 'hello ' + file);
  await app.register(fastifyStatic, { root, prefix: '/assets/', wildcard: false, globIgnore: ['**/ignored/**'] });
  for (const file of files) {
    const url = '/assets/' + file.split('/').map(encodeURIComponent).join('/');
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
    assert.equal(response.body, 'hello ' + file);
  }
  for (const url of ['/assets/.hidden.txt', '/assets/ignored/internal.txt', '/assets/missing.txt', '/assets/..%2Fsecret'])
    assert.equal((await app.inject(url)).statusCode, 404, url);
  const url = '/assets/nested/hello%20world.txt';
  const response = await app.inject(url);
  assert.ok(response.headers.etag);
  assert.equal((await app.inject({ url, headers: { 'if-none-match': response.headers.etag } })).statusCode, 304);
  const range = await app.inject({ url, headers: { range: 'bytes=0-4' } });
  assert.equal(range.statusCode, 206);
  assert.equal(range.body, 'hello');
});
