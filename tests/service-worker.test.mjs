import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../web/public/sw.js', import.meta.url), 'utf8');
const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const isWeb = metadata.name === 'virelo-web';
const cacheName = isWeb ? 'virelo-web-shell-transparent-1' : 'virelo-shell-transparent-1';
const origin = 'https://virelo.test';
const keyOf = (request) => new URL(typeof request === 'string' ? request : request.url, origin).href;
const response = (body = 'export const build = "old";', mime = 'text/javascript', status = 200, headers = {}) =>
  new Response(body, { status, headers: { 'Content-Type': mime, ...headers } });

function worker({ network = async () => response(), failure, putGate } = {}) {
  const listeners = new Map();
  const storage = new Map([[cacheName, new Map()]]);
  const calls = { fetch: [], put: [], deleted: [], claim: 0, skipWaiting: 0 };
  const cache = (name) => ({
    async match(request) {
      if (failure === 'match') throw new Error('Cache read failed');
      return storage.get(name)?.get(keyOf(request))?.clone();
    },
    async put(request, value) {
      if (putGate) await putGate;
      if (failure === 'put') throw new Error('Quota exceeded');
      assert.equal(value.status, 200);
      calls.put.push(keyOf(request));
      storage.get(name).set(keyOf(request), value.clone());
    }
  });
  runInNewContext(source, {
    URL, URLSearchParams, Request, Response,
    self: {
      location: { origin },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => { calls.skipWaiting++; },
      clients: { claim: async () => { calls.claim++; } }
    },
    caches: {
      async open(name) {
        if (failure === 'open') throw new Error('Storage blocked');
        if (!storage.has(name)) storage.set(name, new Map());
        return cache(name);
      },
      async keys() { return [...storage.keys()]; },
      async delete(name) { calls.deleted.push(name); return storage.delete(name); },
      async match(request) {
        for (const name of storage.keys()) {
          const match = await cache(name).match(request);
          if (match) return match;
        }
      }
    },
    fetch: async (request, options) => {
      calls.fetch.push(keyOf(request));
      return network(request, options);
    }
  }, { filename: 'sw.js' });

  function dispatch(name, properties = {}) {
    let responsePromise;
    let dispatching = true;
    const waits = [];
    listeners.get(name)({
      ...properties,
      respondWith(value) {
        assert.ok(dispatching, 'respondWith must be registered during dispatch');
        responsePromise = Promise.resolve(value);
      },
      waitUntil(value) {
        assert.ok(dispatching, 'waitUntil must be registered during dispatch');
        waits.push(Promise.resolve(value));
      }
    });
    dispatching = false;
    return { response: responsePromise, waits, done: Promise.all(waits) };
  }

  return {
    storage, calls,
    seed(path, value, name = cacheName) {
      if (!storage.has(name)) storage.set(name, new Map());
      storage.get(name).set(keyOf(path), value);
    },
    fetch(path, { destination = '', mode = 'cors', ...options } = {}) {
      const request = new Request(new URL(path, origin), options);
      Object.defineProperties(request, {
        destination: { value: destination },
        mode: { value: mode }
      });
      return dispatch('fetch', { request });
    },
    activate: () => dispatch('activate'),
    install: () => dispatch('install')
  };
}

test('valid shell assets return immediately while waitUntil owns the cache write', async () => {
  let release;
  const putGate = new Promise((resolve) => { release = resolve; });
  const sw = worker({ putGate });
  const event = sw.fetch('/assets/route-old.js', { destination: 'script' });
  assert.equal(event.waits.length, 1);
  assert.equal(await (await event.response).text(), 'export const build = "old";');
  assert.equal(sw.calls.put.length, 0);
  let finished = false;
  event.done.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false);
  release();
  await event.done;
  assert.deepEqual(sw.calls.put, [origin + '/assets/route-old.js']);
});

test('the standalone startup recovery script remains available offline',async()=>{
  const sw=worker(),stored=sw.fetch('/startup.js',{destination:'script'});
  assert.equal((await stored.response).status,200);await stored.done;
  assert.deepEqual(sw.calls.put,[origin+'/startup.js']);
  const offline=worker({network:async()=>{throw Error('offline');}});
  offline.seed('/startup.js',response('// standalone recovery'));
  const cached=offline.fetch('/startup.js',{destination:'script'});
  assert.equal(await (await cached.response).text(),'// standalone recovery');await cached.done;
});

test('network errors, HTTP failures and incorrect MIME fall back to the exact cached module', async () => {
  for (const network of [
    async () => { throw new Error('offline'); },
    ...[404, 500, 503].map((status) => async () => response('Unavailable', 'text/html', status)),
    ...['text/html', 'text/css', 'application/json', 'application/octet-stream', ''].map((mime) =>
      async () => response('<html>new deployment</html>', mime))
  ]) {
    const sw = worker({ network });
    sw.seed('/assets/route-old.js', response());
    const event = sw.fetch('/assets/route-old.js', { destination: 'script' });
    assert.equal(await (await event.response).text(), 'export const build = "old";');
    await event.done;
    assert.equal(sw.calls.put.length, 0);
  }
});

test('retry keys remove only virelo-retry and keep the network URL and other query bytes', async () => {
  const path = '/assets/route-old.js?note=a%20b&lang=ja%2Fjp';
  const sw = worker({ network: async () => response('Missing', 'text/html', 404) });
  sw.seed(path, response());
  for (const retry of [1, 2]) {
    const retryPath = path + '&virelo-retry=' + retry;
    const event = sw.fetch(retryPath, { destination: 'script' });
    assert.equal(await (await event.response).text(), 'export const build = "old";');
    await event.done;
    assert.equal(sw.calls.fetch.at(-1), origin + retryPath);
  }
  const online = worker();
  for (const retry of [1, 2]) {
    const event = online.fetch(path + '&virelo-retry=' + retry, { destination: 'script' });
    await event.response;
    await event.done;
  }
  assert.deepEqual([...online.storage.get(cacheName).keys()], [origin + path]);
  const different = sw.fetch('/assets/route-old.js?note=other&virelo-retry=1');
  assert.equal((await different.response).status, 404);
  await different.done;
});

test('CSS retries share the original asset cache without changing other query parameters', async () => {
  const sw = worker({ network: async () => response('body {}', 'text/css') });
  const event = sw.fetch('/assets/theme.css?theme=dark&virelo-retry=1', { destination: 'style' });
  await event.response;
  await event.done;
  assert.deepEqual(sw.calls.put, [origin + '/assets/theme.css?theme=dark']);
});

test('fallback never substitutes a different hash or uses an unrelated cache', async () => {
  const sw = worker({ network: async () => response('Missing', 'text/html', 404) });
  sw.seed('/assets/route-new.js', response('export const build = "new";'));
  sw.seed('/assets/route-old.js', response('export const build = "unrelated";'), 'other-app-cache');
  const event = sw.fetch('/assets/route-old.js');
  assert.equal((await event.response).status, 404);
  await event.done;
  assert.equal(sw.calls.put.length, 0);
});

test('HTML at a JS URL is neither cached nor served as a successful module, even from legacy cache', async () => {
  for (const network of [
    async () => response('<html>SPA fallback</html>', 'text/html'),
    async () => { throw new Error('offline'); }
  ]) {
    const sw = worker({ network });
    sw.seed('/assets/route-old.js', response('<html>poisoned old cache</html>', 'text/html'));
    const event = sw.fetch('/assets/route-old.js');
    const result = await event.response;
    assert.ok(result instanceof Response);
    assert.equal(result.type, 'error');
    await event.done;
    assert.equal(sw.calls.put.length, 0);
  }
});

test('API, media, audio, ranges, non-shell and cross-origin requests bypass the worker', async () => {
  const sw = worker();
  for (const [path, options] of [
    ['/api'], ['/api/health'], ['/api/icon.png'], ['/hls'], ['/hls/master.m3u8'],
    ['/audio'], ['/audio/track.m4a'], ['/playback/1/master.m3u8'], ['/media/1'],
    ['/landing/demo.mp4'], ['/assets/song.mp3'], ['/assets/movie.mp4', { mode: 'navigate' }],
    ['/assets/icon.png', { headers: { Range: 'bytes=0-10' } }],
    ['/assets/route.js', { destination: 'video' }], ['/assets/route.js', { destination: 'audio' }],
    ['/assets/route.js', { method: 'POST' }], ['/assets/route.js', { method: 'HEAD' }],
    ['/sw.js'], ['/assets', { mode: 'navigate' }], ['/anything.json'], ['/arbitrary-user-picture.png'],
    ['https://other.test/assets/route.js'], ['/api/health', { mode: 'navigate' }]
  ]) {
    const event = sw.fetch(path, options);
    assert.equal(event.response, undefined, path);
    assert.equal(event.waits.length, 0, path);
    await event.done;
  }
  assert.equal(sw.calls.fetch.length, 0);
  assert.equal(sw.calls.put.length, 0);
});

test('only complete responses with suitable shell MIME are cached', async () => {
  for (const [path, mime] of [
    ['/assets/route.js', 'Text/JavaScript; charset=utf-8'], ['/assets/worker.mjs', 'application/javascript'],
    ['/assets/theme.css', 'text/css'], ['/assets/font.woff2', 'font/woff2'],
    ['/assets/decoder.wasm', 'application/wasm'], ['/assets/logo.svg', 'image/svg+xml'],
    ['/manifest.webmanifest', 'application/manifest+json'], ['/favicon-32.png', 'image/png'],
    ['/virelo-icon-192.png', 'image/png']
  ]) {
    const sw = worker({ network: async () => response('asset', mime) });
    const event = sw.fetch(path);
    assert.equal((await event.response).status, 200, path);
    await event.done;
    assert.deepEqual(sw.calls.put, [origin + path], path);
  }
  for (const network of [
    async () => response('partial', 'text/javascript', 206),
    async () => response('partial', 'text/javascript', 200, { 'Content-Range': 'bytes 0-10/100' }),
    async () => response('<html>not CSS</html>', 'text/html')
  ]) {
    const sw = worker({ network });
    const event = sw.fetch('/assets/theme.css');
    await event.response;
    await event.done;
    assert.equal(sw.calls.put.length, 0);
  }
});

test('cache open, read and quota failures do not break valid network responses or offline misses', async () => {
  for (const failure of ['open', 'match', 'put']) {
    const sw = worker({ failure });
    const event = sw.fetch('/assets/route.js');
    assert.equal((await event.response).status, 200);
    await event.done;
    const offline = worker({ failure, network: async () => { throw new Error('offline'); } });
    const missing = offline.fetch('/assets/missing.js');
    assert.equal((await missing.response).type, 'error');
    await missing.done;
  }
});

test('navigation caches bounded canonical shells and has a graceful offline miss', async () => {
  const sw = worker({ network: async () => response('<html>shell</html>', 'text/html') });
  const paths = isWeb ? ['/app/watch/1?position=9', '/app/settings', '/privacy?from=footer'] : ['/watch/1?position=9', '/settings'];
  for (const path of paths) {
    const event = sw.fetch(path, { mode: 'navigate', destination: 'document' });
    await event.response;
    await event.done;
  }
  assert.deepEqual([...sw.storage.get(cacheName).keys()].sort(),
    (isWeb ? [origin + '/', origin + '/app'] : [origin + '/']).sort());
  const offline = worker({ network: async () => { throw new Error('offline'); } });
  offline.seed(isWeb ? '/app' : '/', response('<html>cached shell</html>', 'text/html'));
  const event = offline.fetch(isWeb ? '/app/watch/2' : '/watch/2', { mode: 'navigate' });
  assert.equal(await (await event.response).text(), '<html>cached shell</html>');
  await event.done;
  const missing = worker({ network: async () => { throw new Error('offline'); } }).fetch('/', { mode: 'navigate' });
  assert.equal((await missing.response).type, 'error');
  await missing.done;
});

test('activation preserves old hashed assets and unrelated caches without reloading clients', async () => {
  const sw = worker();
  sw.seed('/assets/old.js', response());
  sw.seed('/assets/old.js', response(), 'previous-build-cache');
  sw.seed('/other', response(), 'unrelated-cache');
  const names = [...sw.storage.keys()];
  await sw.activate().done;
  assert.deepEqual([...sw.storage.keys()], names);
  assert.equal(sw.storage.get(cacheName).has(origin + '/assets/old.js'), true);
  assert.deepEqual(sw.calls.deleted, []);
  assert.equal(sw.calls.claim, 1);
});

test('installation tolerates offline, HTTP failures and unavailable storage without replacing valid cached shell', async () => {
  for (const options of [
    { network: async () => { throw new Error('offline'); } },
    { network: async () => response('Missing', 'text/html', 404) },
    { failure: 'open', network: async () => response('<html>shell</html>', 'text/html') },
    { failure: 'put', network: async () => response('<html>shell</html>', 'text/html') }
  ]) {
    const sw = worker(options);
    sw.seed('/', response('<html>old shell</html>', 'text/html'));
    await sw.install().done;
    assert.equal(sw.calls.skipWaiting, 1);
    assert.equal(await sw.storage.get(cacheName).get(origin + '/').text(), '<html>old shell</html>');
    assert.equal(sw.calls.put.length, 0);
    assert.deepEqual(sw.calls.deleted, []);
  }
});

if (isWeb) test('web installation validates MIME of each precached shell asset', async () => {
  const sw = worker({ network: async () => response('<html>SPA fallback</html>', 'text/html') });
  await sw.install().done;
  assert.deepEqual([...sw.storage.get(cacheName).keys()].sort(), [origin + '/', origin + '/app'].sort());
});
