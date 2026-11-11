import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../web/src/utils/route-loading.ts', import.meta.url), 'utf8');
const { createRouteLoader, RouteLoadError, isImportFailure, retryModuleUrl, retryStylesheetUrl } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const unavailable = () => new TypeError('Failed to fetch dynamically imported module: https://virelo.test/assets/LibraryView-abc.js');

test('transient route failures recover without abandoning the request', async () => {
  let calls = 0;
  const waits = [];
  const expected = { LibraryView: 'library' };
  const loader = createRouteLoader(async () => { if (++calls < 3) throw unavailable(); return expected; }, { wait: async ms => { waits.push(ms); } });
  assert.equal(await loader.load(), expected);
  assert.deepEqual(waits, [300, 900]);
  assert.equal(loader.read(), expected);
  await loader.load();
  assert.equal(calls, 3);
});

test('concurrent preloads and navigation share the same request', async () => {
  let calls = 0, resolve;
  const importer = new Promise(done => { resolve = done; });
  const loader = createRouteLoader(() => { calls++; return importer; });
  const first = loader.load();
  assert.equal(loader.load(), first);
  let suspended;
  try { loader.read(); } catch (value) { suspended = value; }
  assert.equal(suspended, first);
  resolve({ value: 42 });
  await first;
  assert.equal(calls, 1);
  assert.deepEqual(loader.read(), { value: 42 });
});

test('permanent download failures are bounded and can later be retried', async () => {
  let online = false, calls = 0;
  const loader = createRouteLoader(async () => { calls++; if (!online) throw unavailable(); return { ready: true }; }, { wait: async () => {} });
  let failure;
  try { await loader.load(); } catch (error) { failure = error; }
  assert.ok(failure instanceof RouteLoadError);
  assert.ok(failure.cause instanceof TypeError);
  assert.equal(calls, 3);
  assert.throws(() => loader.read(), RouteLoadError);
  online = true;
  await failure.retry();
  assert.deepEqual(loader.read(), { ready: true });
  assert.equal(calls, 4);
});

test('code exceptions are not disguised as connection errors or retried endlessly', async () => {
  const bug = new ReferenceError('renderThing is not defined');
  let calls = 0;
  const loader = createRouteLoader(async () => { calls++; throw bug; }, { wait: async () => assert.fail('must not wait') });
  await assert.rejects(loader.load(), error => error === bug);
  assert.throws(() => loader.read(), error => error === bug);
  assert.equal(calls, 1);
});

test('cache-busting retry remains on the same origin and same build', () => {
  assert.equal(retryModuleUrl(unavailable(), 'https://virelo.test', 1), 'https://virelo.test/assets/LibraryView-abc.js?virelo-retry=1');
  assert.equal(retryModuleUrl(new Error('Failed to fetch dynamically imported module: https://virelo.test/assets/LibraryView-abc.js?x=1&virelo-retry=1'), 'https://virelo.test', 2), 'https://virelo.test/assets/LibraryView-abc.js?x=1&virelo-retry=2');
  assert.equal(retryModuleUrl(unavailable(), 'https://elsewhere.test', 1), null);
  assert.equal(retryModuleUrl(new Error('Failed to fetch dynamically imported module: https://virelo.test/api/evil.js'), 'https://virelo.test', 1), null);
  assert.equal(retryModuleUrl(new Error('Cannot render https://virelo.test/assets/test.js'), 'https://virelo.test', 1), null);
});

test('the retry transport can bypass a remembered failed browser module URL', async () => {
  let first = 0, retries = 0;
  const loader = createRouteLoader(async () => { first++; throw unavailable(); }, {
    wait: async () => {},
    retryImport: async (error, attempt) => { assert.ok(isImportFailure(error)); assert.equal(attempt, 1); retries++; return { ready: true }; }
  });
  assert.deepEqual(await loader.load(), { ready: true });
  assert.equal(first, 1);
  assert.equal(retries, 1);
});

test('recognizes Chrome, Firefox, Safari and stylesheet transport errors only', () => {
  for (const message of ['Failed to fetch dynamically imported module: /x', 'error loading dynamically imported module', 'Importing a module script failed.', 'Unable to preload CSS for /assets/test.css', 'Loading chunk 12 failed.', 'Failed to load module script: disallowed MIME type']) assert.ok(isImportFailure(new Error(message)), message);
  assert.equal(isImportFailure(new Error('Cannot read properties of undefined')), false);
});

test('a CSS retry cannot load another origin or a non-stylesheet resource', () => {
  assert.equal(retryStylesheetUrl(new Error('Unable to preload CSS for /assets/LibraryView-abc.css'), 'https://virelo.test', 1), 'https://virelo.test/assets/LibraryView-abc.css?virelo-retry=1');
  assert.equal(retryStylesheetUrl(new Error('Unable to preload CSS for https://elsewhere.test/assets/test.css'), 'https://virelo.test', 1), null);
  assert.equal(retryStylesheetUrl(new Error('Unable to preload CSS for /api/test.css'), 'https://virelo.test', 1), null);
});

test('incorrect modules are rejected before they can replace the current screen', async () => {
  const loader = createRouteLoader(async () => ({ OtherView: true }), { validate: module => {
    if (!module.LibraryView) throw new Error('Incomplete module');
  } });
  await assert.rejects(loader.load(), /Incomplete module/);
  assert.throws(() => loader.read(), /Incomplete module/);
});
