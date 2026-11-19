import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';

test('queue resume is persistent, account-private, authorized and bounded', { timeout: 30000 }, async t => {
  process.env.VIRELO_LOG_LEVEL = 'silent';
  const root = await mkdtemp(join(tmpdir(), 'virelo-queue-sessions-'));
  let server = await createVireloServer({ dataDir: root, mediaPaths: [], host: '127.0.0.1', port: 0 });
  t.after(async () => { await server.app.close(); await rm(root, { recursive: true, force: true }); });
  server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
  const items = [];
  for (let i = 0; i < 3; i++) {
    const path = join(root, 'media-' + i); await mkdir(path);
    const library = server.db.addLibrary(path, 'Library ' + i);
    items.push(server.db.upsertMedia({ library_id: library.id, path: join(path, 'clip.mp4'), filename: 'clip.mp4',
      title: 'Private clip ' + i, sort_title: 'Clip ' + i, kind: 'video', folder: '', size: 1, mtime: 1,
      duration: 90, width: 160, height: 90, video_codec: 'h264', audio_codec: 'aac', container: 'mp4',
      series_title: null, season: null, episode: null, year: null, thumbnail_path: null, poster_path: null,
      backdrop_path: null, overview: null, genres: null, external_id: null }));
  }
  const call = (method, url, payload, cookie, headers = {}) => server.app.inject({ method, url, payload,
    remoteAddress: '127.0.0.1', headers: { 'x-virelo-request': '1', ...(cookie ? { cookie } : {}), ...headers } });
  const setup = await call('POST', '/api/auth/setup', { username: 'owner', password: '1' });
  assert.equal(setup.statusCode, 200, setup.body);
  const owner = setup.headers['set-cookie'].split(';')[0];
  const viewer = server.accounts.save({ username: 'viewer', allLibraries: true }, await hashPassword('1'));
  const viewerCookie = 'virelo_session=' + server.accounts.createSession(viewer);
  const ids = items.map(item => item.id);
  const session = key => ({ key, state: { ids: [ids[2], ids[0]], manualIds: [ids[0], ids[2]], sourceIds: ids,
    selectedId: ids[2], shuffled: true }, updatedAt: 1 });
  const endpoint = '/api/queue-sessions';
  assert.equal((await call('GET', endpoint)).statusCode, 401);
  assert.equal((await call('PUT', endpoint, session('queue-test'), owner, { origin: 'https://untrusted.example' })).statusCode, 403);
  assert.equal((await server.app.inject({ method: 'PUT', url: endpoint, payload: session('queue-test'), headers: { cookie: owner } })).statusCode, 403);
  for (const body of [null, {}, { ...session('queue-test'), state: { ...session('queue-test').state, selectedId: 99999 } }])
    assert.equal((await call('PUT', endpoint, body, viewerCookie)).statusCode, 400);
  assert.equal((await call('PUT', endpoint, session('queue-test'), viewerCookie)).statusCode, 200);
  assert.deepEqual((await call('GET', endpoint, undefined, owner)).json(), []);
  for (const method of ['GET', 'DELETE']) {
    const response = await call(method, endpoint + '/queue-test', undefined, owner);
    assert.equal(response.statusCode, method === 'GET' ? 404 : 200);
  }
  let detail = (await call('GET', endpoint + '/queue-test', undefined, viewerCookie)).json();
  assert.deepEqual(detail.state, session('queue-test').state);
  assert.deepEqual(detail.items.map(item => item.id), ids);
  server.db.setProgress(ids[2], 24, 90, viewer.id);
  const summary = await call('GET', endpoint, undefined, viewerCookie);
  assert.match(summary.headers['cache-control'], /no-store/);
  assert.equal(summary.json()[0].item.progress_position, 24);
  await server.app.close();
  server = await createVireloServer({ dataDir: root, mediaPaths: [], host: '127.0.0.1', port: 0 });
  assert.deepEqual((await call('GET', endpoint + '/queue-test', undefined, viewerCookie)).json().state, session('queue-test').state);
  await call('PUT', endpoint, { key: 'queue-middle', state: { ids, manualIds: ids, sourceIds: ids, selectedId: ids[1], shuffled: false } }, viewerCookie);
  const middleScope = server.accounts.save({ allLibraries: false, libraryIds: [items[0].library_id, items[2].library_id] }, undefined, viewer.id);
  const middleCookie = 'virelo_session=' + server.accounts.createSession(middleScope);
  assert.equal((await call('GET', endpoint, undefined, middleCookie)).json().find(row => row.key === 'queue-middle').item.id, ids[2]);
  assert.equal((await call('GET', endpoint + '/queue-middle', undefined, middleCookie)).json().state.selectedId, ids[2], 'card and resumed selection agree after access changes');
  await call('DELETE', endpoint + '/queue-middle', undefined, middleCookie);
  const restricted = server.accounts.save({ allLibraries: false, libraryIds: [items[0].library_id] }, undefined, viewer.id);
  const restrictedCookie = 'virelo_session=' + server.accounts.createSession(restricted);
  detail = (await call('GET', endpoint + '/queue-test', undefined, restrictedCookie)).json();
  assert.deepEqual(detail.state.ids, [ids[0]]); assert.deepEqual(detail.state.sourceIds, [ids[0]]);
  assert.equal(detail.state.selectedId, ids[0]);
  assert.deepEqual(detail.items.map(item => item.id), [ids[0]]);
  assert.ok(!JSON.stringify(detail).includes('Private clip 2'));
  const playlist = (await call('POST', '/api/playlists', { name: 'My playlist', mediaIds: [ids[0]] }, restrictedCookie)).json();
  const playlistSession = { ...session('playlist-' + playlist.id), playlistId: playlist.id };
  assert.equal((await call('PUT', endpoint, playlistSession, owner)).statusCode, 404, 'foreign playlist data is not persisted');
  assert.equal((await call('GET', endpoint + '/' + playlistSession.key, undefined, owner)).statusCode, 404);
  assert.equal((await call('PUT', endpoint, playlistSession, restrictedCookie)).statusCode, 200);
  assert.equal((await call('GET', endpoint, undefined, restrictedCookie)).json().find(row => row.playlistId).label, 'My playlist');
  await call('DELETE', '/api/playlists/' + playlist.id, { revision: playlist.revision }, restrictedCookie);
  assert.equal((await call('GET', endpoint + '/' + playlistSession.key, undefined, restrictedCookie)).statusCode, 404);
  for (let i = 0; i < 15; i++) await call('PUT', endpoint, session('queue-cap-' + i), restrictedCookie);
  assert.equal((await call('GET', endpoint, undefined, restrictedCookie)).json().length, 12);
  await call('DELETE', endpoint + '/queue-cap-14', undefined, restrictedCookie);
  assert.equal((await call('GET', endpoint + '/queue-cap-14', undefined, restrictedCookie)).statusCode, 404);
  assert.equal((await call('POST', '/api/settings', { queueResumePosition: false }, owner)).json().queueResumePosition, false);
  assert.equal((await call('POST', '/api/settings', { queueResumePosition: 'yes' }, owner)).statusCode, 400);
  assert.equal((await call('POST', '/api/settings', { queueResumePosition: true }, restrictedCookie)).statusCode, 403);
  await call('PUT', endpoint, session('queue-owner'), owner);
  assert.ok((await call('GET', `/api/accounts/${viewer.id}/data`, undefined, owner)).json().history > 0);
  assert.equal((await call('DELETE', `/api/accounts/${viewer.id}/data`, { category: 'history' }, owner)).statusCode, 200);
  assert.deepEqual((await call('GET', endpoint, undefined, restrictedCookie)).json(), []);
  assert.equal((await call('GET', endpoint, undefined, owner)).json().length, 1, 'history clear never touches another account');
});
