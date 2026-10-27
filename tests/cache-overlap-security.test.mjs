import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, open, readFile, writeFile, rm, stat, symlink, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { VireloDB } from '../dist/db.js';
import { mediaScheduler } from '../dist/media-work.js';

process.env.VIRELO_LOG_LEVEL = 'silent';
const dirLink = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
async function fingerprint(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const info = await stat(path); return { sha256: hash.digest('hex'), size: info.size, mtime: info.mtimeMs };
}
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'virelo-overlap-security-'));
  t.after(async () => {
    assert.ok(relative(resolve(tmpdir()), root).startsWith('virelo-overlap-security-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}
function authenticate(server) {
  const owner = server.accounts.save({ username: 'owner' }, 'fixture-only', undefined, true);
  const cookie = 'virelo_session=' + server.accounts.createSession(owner);
  return (url, method = 'GET', payload, headers = {}) => server.app.inject({ url, method, payload, headers: { host: 'localhost', cookie, 'x-virelo-request': '1', ...headers } });
}
function indexOriginal(db, library, path) {
  return db.upsertMedia({ library_id: library.id, path, filename: 'segment-0.ts', title: 'Original', sort_title: 'original',
    kind: 'video', folder: '', size: 1, mtime: 1, duration: 1, width: 160, height: 90, video_codec: 'h264', audio_codec: 'aac', container: 'mpegts',
    series_title: null, season: null, episode: null, year: null, thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null });
}

test('configured and persisted cache-contained media survive startup over budget; UI and direct ranges remain usable', async t => {
  for (const persisted of [false, true]) await t.test(persisted ? 'persisted library' : 'configured library', async t => {
    const root = await fixture(t), media = join(root, 'cache', 'hls', 'recordings');
    await mkdir(media, { recursive: true });
    const original = join(media, 'segment-0.ts'), file = await open(original, 'wx');
    try { await file.write('ORIGINAL transport stream'); await file.truncate(128 * 1024 * 1024 + 1); } finally { await file.close(); }
    const before = await fingerprint(original), setting = process.env.VIRELO_CACHE_MAX_MB;
    let server;
    try {
      process.env.VIRELO_CACHE_MAX_MB = '128';
      if (persisted) { const db = new VireloDB(root); db.addLibrary(media, 'Recordings'); db.close(); }
      server = await createVireloServer({ dataDir: root, mediaPaths: persisted ? [] : [media], host: '127.0.0.1', port: 0 });
      server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
      const call = authenticate(server), library = server.db.visibleLibraries()[0], item = indexOriginal(server.db, library, original);
      assert.equal((await call('/api/libraries')).statusCode, 200);
      const stream = await call(`/api/media/${item.id}/stream`, 'GET', undefined, { range: 'bytes=0-24' });
      assert.equal(stream.statusCode, 206); assert.equal(stream.body, 'ORIGINAL transport stream');
      for (const [url, method, payload] of [[`/hls/${item.id}/segment-0.ts`, 'GET'],
        [`/api/media/${item.id}/quality/start`, 'POST', {}], ['/api/data/cache', 'DELETE']]) {
        const response = await call(url, method, payload);
        assert.equal(response.statusCode, 409, response.body); assert.match(response.json().message ?? response.json().error, /overlaps a media library/);
      }
      assert.deepEqual(await fingerprint(original), before);
    } finally {
      if (server) await server.app.close();
      if (setting === undefined) delete process.env.VIRELO_CACHE_MAX_MB; else process.env.VIRELO_CACHE_MAX_MB = setting;
    }
  });
});

test('a home-like media root containing a hidden data folder opens; an archived broad root does not lock out the UI', async t => {
  for (const archived of [false, true]) await t.test(archived ? 'archived root' : 'configured home', async t => {
    const root = await fixture(t), dataDir = join(root, '.virelo'); await mkdir(dataDir);
    const source = join(root, 'source.mp4'); await writeFile(source, 'original home video');
    if (archived) { const db = new VireloDB(dataDir); db.addLibrary(root, 'Archived home', false); db.close(); }
    const server = await createVireloServer({ dataDir, mediaPaths: archived ? [] : [root], host: '127.0.0.1', port: 0 });
    try {
      server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
      const call = authenticate(server);
      assert.equal((await call('/api/auth/status')).statusCode, 200);
      assert.equal((await call('/api/libraries')).statusCode, 200);
      if (archived) assert.equal((await call('/api/accounts/previous-libraries')).json().length, 1);
      else {
        const item = indexOriginal(server.db, server.db.visibleLibraries()[0], source);
        assert.equal((await call(`/api/media/${item.id}/stream`)).body, 'original home video');
      }
      const clear = await call('/api/data/cache', 'DELETE'); assert.equal(clear.statusCode, 409, clear.body);
      assert.equal(await readFile(source, 'utf8'), 'original home video');
    } finally { await server.app.close(); }
  });
});

test('runtime library overlaps are refused by HTTP registration and by the retained deletion guard', async t => {
  const root = await fixture(t), dataDir = join(root, 'data');
  const server = await createVireloServer({ dataDir, mediaPaths: [], host: '127.0.0.1', port: 0 });
  try {
    server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
    const call = authenticate(server), media = join(dataDir, 'cache', 'hls'), original = join(media, 'segment-0.ts');
    await writeFile(original, 'keep original bytes'); const before = await fingerprint(original);
    assert.equal((await call('/api/libraries', 'POST', { path: media })).statusCode, 409);
    const library = server.db.addLibrary(media, 'Legacy overlapping library'); server.db.removeLibrary(library.id);
    assert.equal((await call('/api/data/cache', 'DELETE')).statusCode, 409);
    assert.deepEqual(await fingerprint(original), before);
    assert.equal(server.db.listLibraries().length, 1, 'unsafe libraries are not silently deleted');
  } finally { await server.app.close(); }
});

test('cache initialization failures close the database before rejecting startup', async t => {
  const root = await fixture(t), outside = join(root, 'outside'), dataDir = join(root, 'data');
  await mkdir(outside); await mkdir(join(dataDir, 'cache'), { recursive: true });
  await writeFile(join(outside, 'segment-0.ts'), 'external original');
  await dirLink(outside, join(dataDir, 'cache', 'hls'));
  const close = VireloDB.prototype.close; let closed = 0;
  VireloDB.prototype.close = function() { closed++; return close.call(this); };
  try {
    await assert.rejects(createVireloServer({ dataDir, mediaPaths: [], host: '127.0.0.1', port: 0 }), /filesystem link/);
    assert.equal(closed, 1);
    assert.equal(await readFile(join(outside, 'segment-0.ts'), 'utf8'), 'external original');
  } finally { VireloDB.prototype.close = close; }
});

test('scheduler opens and closes the same canonical scope when the configured data directory is an alias', async t => {
  const root = await fixture(t), actual = join(root, 'data'), alias = join(root, 'alias');
  await mkdir(actual); await dirLink(actual, alias);
  const openScope = mediaScheduler.openScope, closeScope = mediaScheduler.closeScope, opened = [], closed = [];
  mediaScheduler.openScope = function(scope) { opened.push(scope); return openScope.call(this, scope); };
  mediaScheduler.closeScope = function(scope) { closed.push(scope); return closeScope.call(this, scope); };
  try {
    const server = await createVireloServer({ dataDir: alias, mediaPaths: [], host: '127.0.0.1', port: 0 });
    await server.app.close(); const canonical = await realpath(actual);
    assert.deepEqual(opened, [canonical]); assert.deepEqual(closed, [canonical]);
  } finally { mediaScheduler.openScope = openScope; mediaScheduler.closeScope = closeScope; }
});
