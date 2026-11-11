import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createVireloServer } from '../dist/server.js';
import { demandStatus } from '../dist/demand-playback.js';

process.env.VIRELO_LOG_LEVEL = 'silent';
const dirLink = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'virelo-route-security-'));
  const server = await createVireloServer({ dataDir: join(root, 'data'), mediaPaths: [], host: '127.0.0.1', port: 0 });
  t.after(async () => {
    await server.app.close();
    assert.ok(relative(resolve(tmpdir()), root).startsWith('virelo-route-security-'));
    await rm(root, { recursive: true, force: true });
  });
  const { app, db, accounts } = server;
  db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
  const items = [];
  for (const label of ['allowed', 'denied']) {
    const folder = join(root, label); await mkdir(folder);
    const library = db.addLibrary(folder, label), path = join(folder, 'source.mp4');
    await writeFile(path, label + ' video'); await writeFile(join(folder, 'thumb.jpg'), label + ' artwork');
    items.push(db.upsertMedia({ library_id: library.id, path, filename: 'source.mp4', title: label, sort_title: label,
      kind: 'video', folder: '', size: 12, mtime: 1, duration: 1, width: 160, height: 90, video_codec: 'h264', audio_codec: 'aac', container: 'mp4',
      series_title: null, season: null, episode: null, year: null, thumbnail_path: join(folder, 'thumb.jpg'), poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null }));
  }
  const owner = accounts.save({ username: 'owner' }, 'fixture-only', undefined, true);
  const viewer = accounts.save({ username: 'viewer', libraryIds: [items[0].library_id] }, 'fixture-only');
  const cookies = [owner, viewer].map(user => 'virelo_session=' + accounts.createSession(user));
  const call = (url, index = 1, method = 'GET', payload, headers = {}) => app.inject({ url, method, payload, headers: { host: 'localhost', cookie: cookies[index], 'x-virelo-request': '1', ...headers } });
  return { ...server, root, items, owner, viewer, call };
}

test('cached HLS/audio files retain normal range/HEAD support but reject cross-library junctions', async t => {
  const { root, items, call } = await fixture(t);
  for (const bucket of ['hls', 'audio']) {
    const name = bucket === 'hls' ? '0.vtt' : 'audio.m4a';
    const allowed = join(root, 'data', 'cache', bucket, String(items[0].id));
    const denied = join(root, 'data', 'cache', bucket, String(items[1].id));
    await mkdir(allowed, { recursive: true }); await mkdir(denied, { recursive: true });
    await writeFile(join(allowed, name), 'allowed cache'); await writeFile(join(denied, name), 'DENIED CACHE');
    const url = `/${bucket}/${items[0].id}/${name}`;
    assert.equal((await call(url)).body, 'allowed cache');
    const range = await call(url, 1, 'GET', undefined, { range: 'bytes=0-6' });
    assert.equal(range.statusCode, 206); assert.equal(range.body, 'allowed');
    assert.equal((await call(url, 1, 'HEAD')).statusCode, 200);
    assert.equal((await call(`/${bucket}/${items[1].id}/${name}`)).statusCode, 404);
    await dirLink(denied, join(allowed, 'alias'));
    for (const method of ['GET', 'HEAD']) {
      const response = await call(`/${bucket}/${items[0].id}/alias/${name}`, 1, method);
      assert.equal(response.statusCode, 404); assert.ok(!response.body.includes('DENIED'));
    }
    const original = await readFile(join(denied, name), 'utf8'); assert.equal(original, 'DENIED CACHE');
  }
});

test('canonical library grants reject repointed roots for source, artwork, probes and cached playback', async t => {
  const { root, db, items, call } = await fixture(t);
  const alias = join(root, 'alias'); await dirLink(join(root, 'allowed'), alias);
  const library = db.addLibrary(alias, 'Alias'); assert.equal(library.id, items[0].library_id);
  assert.equal(library.path, await realpath(join(root, 'allowed')));
  const cache = join(root, 'data', 'cache', 'hls', String(items[0].id)); await mkdir(cache);
  await writeFile(join(cache, '0.vtt'), 'allowed cache');
  await rename(join(root, 'allowed'), join(root, 'allowed-old'));
  await dirLink(join(root, 'denied'), join(root, 'allowed'));
  for (const url of [`/api/media/${items[0].id}/stream`, `/api/media/${items[0].id}/artwork/thumbnail`,
    `/api/media/${items[0].id}/playback`, `/api/media/${items[0].id}/quality/status`,
    `/api/media/${items[0].id}/audio/status?audioStream=1`, `/hls/${items[0].id}/0.vtt`]) {
    const response = await call(url); assert.equal(response.statusCode, 404, url); assert.ok(!response.body.includes('denied video'));
  }
  assert.equal(await readFile(join(root, 'allowed-old', 'source.mp4'), 'utf8'), 'allowed video');
  assert.equal(await readFile(items[1].path, 'utf8'), 'denied video');
});

test('ordinary source replacement remains playable; generated artwork junctions are refused', async t => {
  const { root, db, items, call } = await fixture(t), item = items[0];
  await rename(item.path, item.path + '.old'); await writeFile(item.path, 'replacement video');
  assert.equal((await call(`/api/media/${item.id}/stream`)).body, 'replacement video');
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).body, 'allowed artwork');
  const thumbnails = join(root, 'data', 'thumbnails'), art = join(thumbnails, 'private.jpg');
  await writeFile(join(root, 'denied', 'private.jpg'), 'DENIED ARTWORK');
  db.updateTechnicalMetadata(item.id, { thumbnail_path: art });
  await rename(thumbnails, thumbnails + '-old'); await dirLink(join(root, 'denied'), thumbnails);
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).statusCode, 404);
  assert.equal(await readFile(join(root, 'denied', 'private.jpg'), 'utf8'), 'DENIED ARTWORK');
  assert.equal(await readFile(item.path + '.old', 'utf8'), 'allowed video');
});

test('safe generated artwork remains available offline, while library-local artwork still rejects repointed roots', async t => {
  const { root, db, items, call } = await fixture(t), item = items[0];
  const art = join(root, 'data', 'thumbnails', 'cached.jpg'); await writeFile(art, 'cached generated artwork');
  db.updateTechnicalMetadata(item.id, { thumbnail_path: art });
  await rename(item.path, item.path + '.offline');
  assert.equal((await call(`/api/media/${item.id}/stream`)).statusCode, 404);
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).body, 'cached generated artwork');
  await rename(join(root, 'allowed'), join(root, 'allowed-old')); await dirLink(join(root, 'denied'), join(root, 'allowed'));
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).body, 'cached generated artwork');
  db.updateTechnicalMetadata(item.id, { thumbnail_path: join(root, 'allowed', 'thumb.jpg') });
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).statusCode, 404);
  assert.equal(await readFile(join(root, 'allowed-old', 'source.mp4.offline'), 'utf8'), 'allowed video');
  assert.equal(await readFile(art, 'utf8'), 'cached generated artwork');
});

test('an in-root junction cannot bypass a denied nested library through an allowed media ID', async t => {
  const { root, db, items, call } = await fixture(t), folder = join(root, 'allowed', 'private');
  await mkdir(folder); const hidden = db.addLibrary(folder, 'Private nested library');
  await writeFile(join(folder, 'source.mp4'), 'NESTED PRIVATE VIDEO');
  const alias = join(root, 'allowed', 'alias'); await dirLink(folder, alias);
  const item = db.upsertMedia({ ...items[0], path: join(alias, 'source.mp4') });
  assert.equal(hidden.id, item.library_id, 'canonical source ownership belongs to the denied nested library');
  const response = await call(`/api/media/${item.id}/stream`);
  assert.equal(response.statusCode, 404); assert.ok(!response.body.includes('NESTED PRIVATE VIDEO'));
  assert.equal(await readFile(join(folder, 'source.mp4'), 'utf8'), 'NESTED PRIVATE VIDEO');
});

function mediaProcesses(t, block) {
  const spawn = childProcess.spawn;
  let started, finish;
  const barrier = new Promise(resolve => { started = resolve; });
  const probe = { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 160, height: 90 },
    { index: 1, codec_type: 'audio', codec_name: 'aac' }, { index: 2, codec_type: 'subtitle', codec_name: 'subrip' }
  ], format: { duration: '1' } };
  childProcess.spawn = (_command, args) => {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
    const complete = async () => {
      if (args.includes('-show_streams')) child.stdout.write(JSON.stringify(probe));
      if (args.includes('webvtt')) await writeFile(args.at(-1), 'WEBVTT\n\nPRIVATE SUBTITLE');
      child.emit('close', 0);
    };
    if (args.includes(block)) { finish = complete; started(); } else queueMicrotask(() => { void complete(); });
    return child;
  };
  syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = spawn; syncBuiltinESMExports(); });
  return { started: barrier, finish: () => finish() };
}
const mutations = {
  session: ({ accounts, viewer }) => { accounts.revoke(viewer.id); return 401; },
  library: ({ db, viewer }) => { db.db.prepare('DELETE FROM account_libraries WHERE user_id=?').run(viewer.id); return 404; },
  permission: ({ db, viewer }) => { db.db.prepare('UPDATE accounts SET permissions=? WHERE id=?').run(JSON.stringify({ ...viewer.permissions, play: false }), viewer.id); return 403; }
};

test('every awaited playback probe rechecks the current session, library scope and permissions before returning or starting work', async t => {
  for (const [name, mutate] of Object.entries(mutations)) for (const [method, endpoint, payload] of [
    ['GET', 'playback'], ['POST', 'transcode/start', {}], ['POST', 'quality/start', {}],
    ['POST', 'audio/start', { audioStream: 1 }], ['GET', 'subtitles/2']
  ]) await t.test(name + ' ' + endpoint, async t => {
    const context = await fixture(t), { root, items, call } = context;
    const process = mediaProcesses(t, '-show_streams');
    const result = Promise.resolve(call(`/api/media/${items[0].id}/${endpoint}`, 1, method, payload));
    await Promise.race([process.started, result.then(response => { throw Error('Probe did not start: ' + response.body); })]);
    const expected = mutate(context); await process.finish();
    const response = await result; assert.equal(response.statusCode, expected, response.body);
    for (const mode of ['compatible', 'adaptive', 'audio']) assert.equal(demandStatus(join(root, 'data'), items[0].id, mode, mode === 'audio' ? 1 : undefined).status, 'idle');
    assert.equal(await readFile(items[0].path, 'utf8'), 'allowed video');
  });
});

test('pending subtitle conversion rechecks revocation, fresh library scope and play permission before sending text', async t => {
  for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
    const context = await fixture(t), { items, call } = context;
    const process = mediaProcesses(t, 'webvtt');
    const result = Promise.resolve(call(`/api/media/${items[0].id}/subtitles/2`));
    await Promise.race([process.started, result.then(response => { throw Error('Conversion did not start: ' + response.body); })]);
    const expected = mutate(context); await process.finish();
    const response = await result; assert.equal(response.statusCode, expected, response.body);
    assert.ok(!response.body.includes('PRIVATE SUBTITLE'));
    assert.equal(await readFile(items[0].path, 'utf8'), 'allowed video');
  });
});

test('transcode, quality and audio starts recheck transcode permission independently of play permission', async t => {
  for (const [endpoint, payload] of [['transcode/start', {}], ['quality/start', {}], ['audio/start', { audioStream: 1 }]]) await t.test(endpoint, async t => {
    const context = await fixture(t), { db, viewer, items, call } = context;
    const process = mediaProcesses(t, '-show_streams');
    const result = Promise.resolve(call(`/api/media/${items[0].id}/${endpoint}`, 1, 'POST', payload));
    await Promise.race([process.started, result.then(response => { throw Error('Probe did not start: ' + response.body); })]);
    db.db.prepare('UPDATE accounts SET permissions=? WHERE id=?').run(JSON.stringify({ ...viewer.permissions, transcode: false }), viewer.id);
    await process.finish(); const response = await result; assert.equal(response.statusCode, 403, response.body);
    assert.equal(await readFile(items[0].path, 'utf8'), 'allowed video');
  });
});
