import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authenticatedInjector } from './auth-helper.mjs';

// Exercise the edited server source without rebuilding or modifying dist.
// Its existing compiled dependencies and web files are the usual test fixtures.
const serverUrl = new URL('../dist/server.js', import.meta.url);
const hook = registerHooks({
  load(url, context, nextLoad) {
    if (url === serverUrl.href) {
      return {
        format: 'module', shortCircuit: true,
        source: stripTypeScriptTypes(readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8'))
      };
    }
    return nextLoad(url, context);
  }
});
let createVireloServer;
try {
  ({ createVireloServer } = await import(serverUrl.href));
} finally {
  hook.deregister();
}

test('static serving keeps deployment shell fresh and missing resources out of SPA fallback', async (t) => {
  const dataDir = await mkdtemp(join(tmpdir(), 'virelo-static-serving-'));
  let app;
  t.after(async () => {
    if (app) await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
  ({ app } = await createVireloServer({ dataDir, mediaPaths: [], host: '127.0.0.1', port: 0 }));
  const inject = await authenticatedInjector(app);

  await t.test('HTML and service worker use no-cache including query strings and nested routes', async () => {
    for (const url of ['/', '/index.html', '/index.html?version=2', '/watch/123', '/settings?tab=playback', '/sw.js', '/sw.js?version=2','/startup.js']) {
      const result = await inject({ method: 'GET', url });
      assert.equal(result.statusCode, 200, url);
      assert.equal(result.headers['cache-control'], 'no-cache', url);
      assert.match(result.headers['content-type'], /\/(?:sw|startup)\.js/.test(url) ? /javascript/ : /text\/html/, url);
    }
  });

  await t.test('HEAD navigation retains shell no-cache headers', async () => {
    const result = await inject({ method: 'HEAD', url: '/watch/123' });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['cache-control'], 'no-cache');
    assert.equal(result.body, '');
  });

  await t.test('conditional HTML and worker responses retain no-cache headers', async () => {
    for (const url of ['/index.html', '/watch/123', '/sw.js']) {
      const original = await inject({ method: 'GET', url });
      assert.ok(original.headers.etag, url);
      const result = await inject({ method: 'GET', url, headers: { 'If-None-Match': original.headers.etag } });
      assert.equal(result.statusCode, 304, url);
      assert.equal(result.headers['cache-control'], 'no-cache', url);
    }
  });

  await t.test('absent assets are real non-cacheable 404s including retry URLs', async () => {
    for (const url of ['/assets', '/assets/', '/assets/absent.js', '/assets/absent.js?virelo-retry=1', '/assets/absent.css', '/assets/absent.woff2']) {
      for (const method of ['GET', 'HEAD']) {
        const result = await inject({ method, url });
        assert.equal(result.statusCode, 404, method + ' ' + url);
        assert.equal(result.headers['cache-control'], 'no-store', url);
        assert.doesNotMatch(result.headers['content-type'], /text\/html/, url);
      }
    }
  });

  await t.test('missing API, audio, HLS and playback files never return SPA HTML', async () => {
    for (const url of ['/api', '/api/absent', '/hls/absent.m3u8', '/audio/absent.m4a', '/playback/absent', '/missing.js', '/missing.png']) {
      const result = await inject({ method: 'GET', url });
      assert.equal(result.statusCode, 404, url);
      assert.doesNotMatch(result.headers['content-type'], /text\/html/, url);
    }
  });

  await t.test('non-navigation methods do not receive SPA fallback', async () => {
    const result = await inject({ method: 'POST', url: '/missing-route' });
    assert.equal(result.statusCode, 404);
    assert.doesNotMatch(result.headers['content-type'], /text\/html/);
  });

  await t.test('existing hashed JS still serves JavaScript with retry queries', async () => {
    const assets = await readdir(new URL('../dist/web/assets/', import.meta.url));
    const asset = assets.find((name) => name.endsWith('.js'));
    assert.ok(asset, 'existing built JS fixture is required');
    for (const suffix of ['', '?virelo-retry=1']) {
      const result = await inject({ method: 'GET', url: '/assets/' + asset + suffix });
      assert.equal(result.statusCode, 200);
      assert.match(result.headers['content-type'], /javascript/);
      assert.doesNotMatch(result.body.slice(0, 100), /<!doctype html/i);
    }
  });

  await t.test('new build files are served even when created after server startup',async()=>{
    const name='static-serving-audit-'+randomUUID()+'.js',file=new URL('../dist/web/assets/'+name,import.meta.url);
    try{
      await writeFile(file,'export const afterStartup = true;');
      for(const suffix of ['', '?virelo-retry=1']){
        const response=await inject({method:'GET',url:'/assets/'+name+suffix});
        assert.equal(response.statusCode,200);assert.match(response.headers['content-type'],/javascript/);assert.match(response.body,/afterStartup/);
      }
    }finally{await rm(file,{force:true});}
  });
});
