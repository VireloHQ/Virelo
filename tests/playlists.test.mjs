import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';
import { playlistIds, playlistName, mergePlaylistIds } from '../dist/playlist-values.js';

test('playlist values validate boundaries, deduplicate and preserve unavailable references', () => {
  assert.equal(playlistName('  お気に入り  '), 'お気に入り');
  for (const value of [null, '', ' ', 'x'.repeat(101), 'line\nbreak']) assert.throws(() => playlistName(value));
  assert.deepEqual(playlistIds([3, 2, 3]), [3, 2]);
  for (const value of [null, {}, [0], [-1], [1.5], ['1'], [Number.MAX_SAFE_INTEGER + 1], Array(10001).fill(1)]) assert.throws(() => playlistIds(value));
  assert.deepEqual(mergePlaylistIds([1, 9, 2], [2, 3], new Set([1, 2, 3])), [2, 9, 3]);
  assert.deepEqual(mergePlaylistIds([1, 9, 2], [], new Set([1, 2])), [9]);
  assert.deepEqual(mergePlaylistIds([1, 2], [2, 3], new Set([1, 2, 3]), true), [1, 2, 3]);
});

test('named playlists are persistent, account-private, scoped and conflict-safe; originals are read-only', { timeout: 30000 }, async t => {
  process.env.VIRELO_LOG_LEVEL = 'silent';
  const root = await mkdtemp(join(tmpdir(), 'virelo-playlists-test-'));
  let server = await createVireloServer({ dataDir: root, mediaPaths: [], host: '127.0.0.1', port: 0 });
  t.after(async () => { await server.app.close(); await rm(root, { recursive: true, force: true }); });
  server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
  const files = [], items = [];
  for (let i = 0; i < 3; i++) {
    const folder = join(root, 'library-' + i); await mkdir(folder);
    const library = server.db.addLibrary(folder, 'Library ' + i), path = join(folder, 'source.mp4');
    await writeFile(path, 'Original source ' + i); files.push(path);
    items.push(server.db.upsertMedia({ library_id: library.id, path, filename: 'source.mp4', title: 'Clip ' + i, sort_title: 'Clip ' + i,
      kind: 'video', folder: '', size: 17, mtime: 1, duration: 60, width: 160, height: 90, video_codec: 'h264', audio_codec: 'aac', container: 'mp4',
      series_title: null, season: null, episode: null, year: null, thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null }));
  }
  const call = (method, url, payload, cookie, headers = {}) => server.app.inject({ method, url, payload, remoteAddress: '127.0.0.1', headers: { 'x-virelo-request': '1', ...(cookie ? { cookie } : {}), ...headers } });
  const setup = await call('POST', '/api/auth/setup', { username: 'owner', password: '1' });
  assert.equal(setup.statusCode, 200, setup.body);
  const owner = setup.headers['set-cookie'].split(';')[0];
  const viewer = server.accounts.save({ username: 'viewer', allLibraries: false, libraryIds: items.map(item => item.library_id) }, await hashPassword('1'));
  const viewerCookie = 'virelo_session=' + server.accounts.createSession(viewer);
  const ids = items.map(item => item.id);
  assert.equal((await call('GET', '/api/playlists')).statusCode, 401);
  assert.equal((await call('POST', '/api/playlists', { name: 'test', mediaIds: [] }, owner, { origin: 'https://untrusted.example' })).statusCode, 403);
  assert.equal((await server.app.inject({ method: 'POST', url: '/api/playlists', payload: { name: 'test' }, headers: { cookie: owner } })).statusCode, 403);
  for (const body of [[], { name: '' }, { name: 'Valid', mediaIds: ['1'] }, { name: 'Valid', mediaIds: [99999] }])
    assert.ok([400, 404].includes((await call('POST', '/api/playlists', body, owner)).statusCode));
  let saved = (await call('POST', '/api/playlists', { name: 'Evening', mediaIds: [...ids, ids[0]] }, viewerCookie)).json();
  assert.equal(saved.itemCount, 3); assert.equal(saved.revision, 1); assert.deepEqual(saved.items.map(item => item.id), ids);
  const url = '/api/playlists/' + saved.id;
  assert.equal((await call('PATCH', url, { revision: 1, name: '', mediaIds: [] }, viewerCookie)).statusCode, 400);
  assert.equal((await call('GET', url, undefined, viewerCookie)).json().itemCount, 3, 'failed updates roll back all entry edits');
  assert.deepEqual((await call('GET', '/api/playlists', undefined, owner)).json(), []);
  for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call(method, url, method === 'GET' ? undefined : { revision: 1, name: 'steal' }, owner)).statusCode, 404);
  assert.equal((await call('PATCH', url, { revision: 0, name: 'invalid' }, viewerCookie)).statusCode, 400);
  saved = (await call('PATCH', url, { revision: saved.revision, mediaIds: [ids[2], ids[0]], name: 'Night' }, viewerCookie)).json();
  assert.deepEqual(saved.items.map(item => item.id), [ids[2], ids[0]]); assert.equal(saved.name, 'Night');
  assert.equal((await call('PATCH', url, { revision: 1, mediaIds: [] }, viewerCookie)).statusCode, 409);
  assert.equal((await call('DELETE', url, { revision: 1 }, viewerCookie)).statusCode, 409);
  saved = (await call('PATCH', url, { revision: saved.revision, append: true, mediaIds: ids }, viewerCookie)).json();
  assert.deepEqual(saved.items.map(item => item.id), [ids[2], ids[0], ids[1]]);
  server.db.setLike(ids[0], true, viewer.id); server.db.setProgress(ids[0], 12, 60, viewer.id);
  const restricted = server.accounts.save({ libraryIds: [items[0].library_id] }, undefined, viewer.id);
  const restrictedCookie = 'virelo_session=' + server.accounts.createSession(restricted);
  const hidden = await call('GET', url, undefined, restrictedCookie);
  assert.equal(hidden.json().itemCount, 1); assert.equal(hidden.json().unavailableCount, 2);
  assert.ok(!hidden.body.includes('Clip 2') && !hidden.body.includes('library-2'));
  assert.equal((await call('PATCH', url, { revision: saved.revision, mediaIds: [ids[2]] }, restrictedCookie)).statusCode, 404);
  saved = (await call('PATCH', url, { revision: saved.revision, mediaIds: [], name: 'Restricted' }, restrictedCookie)).json();
  assert.equal(saved.itemCount, 0); assert.equal(saved.unavailableCount, 2);
  const restored = server.accounts.save({ allLibraries: true }, undefined, viewer.id);
  const restoredCookie = 'virelo_session=' + server.accounts.createSession(restored);
  assert.deepEqual((await call('GET', url, undefined, restoredCookie)).json().items.map(item => item.id), [ids[2], ids[1]]);
  await server.app.close();
  server = await createVireloServer({ dataDir: root, mediaPaths: [], host: '127.0.0.1', port: 0 });
  saved = (await call('GET', url, undefined, restoredCookie)).json();
  assert.equal(saved.name, 'Restricted'); assert.equal(saved.itemCount, 2);
  assert.equal((await call('DELETE', url, { revision: saved.revision }, restoredCookie)).statusCode, 200);
  assert.equal((await call('GET', url, undefined, restoredCookie)).statusCode, 404);
  const item = server.db.getMedia(ids[0], server.accounts.scope(server.accounts.get(viewer.id)));
  assert.equal(item.liked, 1); assert.equal(item.progress_position, 12);
  const bulk = Array.from({ length: 650 }, (_, index) => server.db.upsertMedia({ ...items[0],
    path: join(root, 'library-0', 'batch-' + index + '.mp4'), filename: 'batch-' + index + '.mp4' }));
  const large = (await call('POST', '/api/playlists', { name: 'More than 500', mediaIds: bulk.map(item => item.id) }, owner)).json();
  assert.equal(large.itemCount, 650); assert.equal(large.items.length, 650);
  const reversed = (await call('PATCH', '/api/playlists/' + large.id, { revision: large.revision, mediaIds: [...bulk].reverse().map(item => item.id) }, owner)).json();
  assert.deepEqual(reversed.items.map(item => item.id), [...bulk].reverse().map(item => item.id));
  for (let i = 0; i < files.length; i++) assert.equal(await readFile(files[i], 'utf8'), 'Original source ' + i);
});
