import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { Accounts } from '../dist/accounts.js';
import { scanLibrary } from '../dist/scanner.js';
import { createVireloServer } from '../dist/server.js';
import { generatedFileInfo, prepareGeneratedFile } from '../dist/image-files.js';
import { resolveLibraryFile } from '../dist/media-files.js';

process.env.VIRELO_LOG_LEVEL = 'silent';
const dirLink = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'virelo-canonical-paths-'));
  const actual = join(root, 'actual'), alias = join(root, 'alias');
  for (const path of ['media/Show', 'data/thumbnails', 'data/artwork', 'data/cache']) await mkdir(join(actual, path), { recursive: true });
  await dirLink(actual, alias);
  const context = { root, actual: await realpath(actual), alias, db: undefined, server: undefined };
  t.after(async () => {
    if (context.server) await context.server.app.close(); else context.db?.close();
    assert.ok(relative(resolve(tmpdir()), root).startsWith('virelo-canonical-paths-'));
    await rm(root, { recursive: true, force: true });
  });
  return context;
}
function media(library, path) {
  return { library_id: library.id, path, filename: 'source.mp4', title: 'Original', sort_title: 'original', kind: 'video',
    series_title: null, season: null, episode: null, year: null, duration: 60, width: 160, height: 90, video_codec: 'h264', audio_codec: 'aac', container: 'mp4',
    folder: 'Show', size: 1, mtime: 1, thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null };
}
const scanStatus = () => ({ running: true, startedAt: null, finishedAt: null, total: 0, scanned: 0, added: 0, updated: 0, skipped: 0, errors: 0, message: '' });

test('alias-spelled media ingress, lookup, ownership and scan pruning share canonical identity', async t => {
  const context = await fixture(t), { actual, alias } = context;
  const db = context.db = new VireloDB(join(alias, 'data'));
  const library = db.addLibrary(join(alias, 'media'), 'Media');
  const path = join(alias, 'media', 'Show', 'source.mp4'); await writeFile(path, 'original video');
  const canonical = await realpath(path), item = db.upsertMedia(media(library, path));
  assert.equal(library.path, await realpath(join(alias, 'media')));
  assert.equal(item.path, canonical);
  assert.equal(db.getMediaByPath(path)?.id, item.id); assert.equal(db.getMediaByPath(canonical)?.id, item.id);
  assert.equal(db.libraryForPath(path)?.id, library.id);
  db.setLike(item.id, true); db.setProgress(item.id, 20, 60);
  assert.equal(db.upsertMedia(media(library, canonical)).id, item.id);
  const nested = db.addLibrary(join(alias, 'media', 'Show'), 'Show');
  assert.equal(db.getMedia(item.id).library_id, nested.id);
  db.deleteMissingForLibrary(nested.id, new Set([path]));
  assert.equal(db.getMedia(item.id).liked, 1); assert.equal(db.getMedia(item.id).progress_position, 20);
  assert.equal(db.listMedia().length, 1); assert.equal(await readFile(join(actual, 'media', 'Show', 'source.mp4'), 'utf8'), 'original video');
});

test('canonical scanner paths find legacy alias rows without replacing IDs or deleting personal state', async t => {
  const context = await fixture(t), { actual, alias } = context;
  const db = context.db = new VireloDB(join(alias, 'data')), library = db.addLibrary(join(alias, 'media'), 'Media');
  const path = join(alias, 'media', 'Show', 'source.mp4'); await writeFile(path, 'synthetic media fixture');
  const item = db.upsertMedia(media(library, path));
  db.db.prepare('UPDATE media SET path=? WHERE id=?').run(path, item.id);
  db.setLike(item.id, true); db.setProgress(item.id, 17, 60);
  assert.equal(db.getMediaByPath(await realpath(path))?.id, item.id);
  await scanLibrary(db, library, join(actual, 'data'), scanStatus());
  assert.equal(db.getMediaByPath(path)?.id, item.id);
  assert.equal(db.listMedia().length, 1); assert.equal(db.getMedia(item.id).liked, 1); assert.equal(db.getMedia(item.id).progress_position, 17);
  assert.equal(await readFile(path, 'utf8'), 'synthetic media fixture');
});

test('scanning through canonical roots remains discoverable through the caller alias', async t => {
  const context = await fixture(t), { actual, alias } = context;
  const db = context.db = new VireloDB(join(alias, 'data')), library = db.addLibrary(join(alias, 'media'), 'Media');
  const path = join(alias, 'media', 'Show', 'source.mp4'); await writeFile(path, 'synthetic media fixture');
  await scanLibrary(db, library, join(actual, 'data'), scanStatus());
  assert.equal(db.getMediaByPath(path)?.library_id, library.id);
  assert.equal(db.getMediaByPath(await realpath(path))?.id, db.getMediaByPath(path)?.id);
  assert.equal(db.listMedia().length, 1);
});

test('re-adding a legacy ancestor-aliased root preserves library ID, media IDs, grants and personal state', async t => {
  const context = await fixture(t), { actual, alias } = context;
  const db = context.db = new VireloDB(join(actual, 'data')), library = db.addLibrary(join(alias, 'media'), 'Media');
  const path = join(alias, 'media', 'Show', 'source.mp4'); await writeFile(path, 'original video');
  const item = db.upsertMedia(media(library, path)), accounts = new Accounts(db.db);
  const user = accounts.save({ username: 'viewer', libraryIds: [library.id] }, 'fixture-only');
  db.setLike(item.id, true, user.id); db.setProgress(item.id, 21, 60, user.id);
  db.db.prepare('UPDATE libraries SET path=? WHERE id=?').run(join(alias, 'media'), library.id);
  db.db.prepare('UPDATE media SET path=? WHERE id=?').run(path, item.id);
  assert.equal(resolveLibraryFile(path, join(alias, 'media')), null);
  const repaired = db.addLibrary(join(actual, 'media'), 'Repaired');
  assert.equal(repaired.id, library.id); assert.equal(repaired.path, join(actual, 'media'));
  assert.deepEqual(accounts.get(user.id).libraryIds, [library.id]);
  assert.equal(db.getMediaByPath(path).id, item.id); assert.equal(db.getMediaByPath(await realpath(path)).id, item.id);
  const personal = db.getMedia(item.id, accounts.scope(accounts.get(user.id)));
  assert.equal(personal.liked, 1); assert.equal(personal.progress_position, 21);
  await scanLibrary(db, repaired, join(actual, 'data'), scanStatus());
  assert.equal(db.listMedia().length, 1); assert.equal(db.getMediaByPath(path).id, item.id);
  assert.ok(resolveLibraryFile(path, repaired.path)); assert.equal(await readFile(path, 'utf8'), 'original video');
});

test('re-adding a repointed legacy root junction neither transfers grants nor adopts old media/history', async t => {
  const context = await fixture(t), { actual } = context;
  const db = context.db = new VireloDB(join(actual, 'data')), oldRoot = join(actual, 'old-root');
  const sourceA = join(actual, 'media', 'Show', 'source.mp4'); await writeFile(sourceA, 'ORIGINAL A');
  await dirLink(join(actual, 'media'), oldRoot);
  const library = db.addLibrary(join(actual, 'media'), 'Old A'), item = db.upsertMedia(media(library, sourceA));
  const accounts = new Accounts(db.db), user = accounts.save({ username: 'viewer', libraryIds: [library.id] }, 'fixture-only');
  db.setLike(item.id, true, user.id); db.setProgress(item.id, 23, 60, user.id);
  db.db.prepare('UPDATE libraries SET path=? WHERE id=?').run(oldRoot, library.id);
  db.db.prepare('UPDATE media SET path=? WHERE id=?').run(join(oldRoot, 'Show', 'source.mp4'), item.id);
  const targetB = join(actual, 'target-b'); await mkdir(join(targetB, 'Show'), { recursive: true });
  await writeFile(join(targetB, 'Show', 'source.mp4'), 'DIFFERENT B');
  await rm(oldRoot, { recursive: true, force: true }); await dirLink(targetB, oldRoot);
  const canonical = db.addLibrary(targetB, 'Approved B');
  assert.notEqual(canonical.id, library.id); assert.equal(canonical.path, targetB);
  assert.equal(db.listLibraries().find(row => row.id === library.id).path, oldRoot);
  assert.deepEqual(accounts.get(user.id).libraryIds, [library.id]);
  assert.equal(db.getMedia(item.id).library_id, library.id);
  assert.equal(db.getMediaByPath(join(targetB, 'Show', 'source.mp4')), undefined);
  await scanLibrary(db, canonical, join(actual, 'data'), scanStatus());
  const newItem = db.getMediaByPath(join(targetB, 'Show', 'source.mp4'));
  assert.ok(newItem); assert.notEqual(newItem.id, item.id); assert.equal(newItem.library_id, canonical.id);
  assert.equal(db.getMedia(newItem.id, accounts.scope(accounts.get(user.id))), undefined);
  assert.equal(db.getMedia(item.id, accounts.scope(accounts.get(user.id))).progress_position, 23);
  assert.equal(resolveLibraryFile(join(oldRoot, 'Show', 'source.mp4'), oldRoot), null);
  db.deleteMissingForLibrary(library.id, new Set()); assert.ok(db.getMedia(item.id), 'unverifiable old roots cannot erase personal identity during pruning');
  assert.equal(await readFile(sourceA, 'utf8'), 'ORIGINAL A'); assert.equal(await readFile(join(targetB, 'Show', 'source.mp4'), 'utf8'), 'DIFFERENT B');
});

test('an exact canonical SQLite path conflict cannot adopt identity from a legacy root junction', async t => {
  const context = await fixture(t), { actual } = context;
  const db = context.db = new VireloDB(join(actual, 'data')), root = join(actual, 'media'), legacy = join(actual, 'legacy-root');
  const path = join(root, 'Show', 'source.mp4'); await writeFile(path, 'retained original');
  const library = db.addLibrary(root, 'Original'), item = db.upsertMedia(media(library, path));
  const accounts = new Accounts(db.db), user = accounts.save({ username: 'viewer', libraryIds: [library.id] }, 'fixture-only');
  db.setLike(item.id, true, user.id); db.setProgress(item.id, 31, 60, user.id);
  await dirLink(root, legacy); db.db.prepare('UPDATE libraries SET path=? WHERE id=?').run(legacy, library.id);
  const approved = db.addLibrary(root, 'Approved canonical root');
  assert.notEqual(approved.id, library.id); assert.deepEqual(accounts.get(user.id).libraryIds, [library.id]);
  for (const spelling of [path, ...(process.platform === 'win32' ? [path.toUpperCase()] : [])]) {
    let failure;
    try { db.upsertMedia(media(approved, spelling)); } catch (error) { failure = error; }
    assert.equal(db.getMedia(item.id).library_id, library.id, 'ON CONFLICT must not move the retained media ID into the new library');
    assert.match(failure?.message ?? '', /Media file not found/);
  }
  const status = scanStatus(); await scanLibrary(db, approved, join(actual, 'data'), status);
  assert.equal(status.errors, 1, 'the conflicting file is skipped instead of transferring personal identity');
  const personal = db.getMedia(item.id, accounts.scope(accounts.get(user.id)));
  assert.equal(personal.liked, 1); assert.equal(personal.progress_position, 31);
  assert.equal(db.getMedia(item.id, { userId: user.id, libraryIds: [approved.id] }), undefined);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS n FROM media').get().n, 1);
  assert.equal(await readFile(path, 'utf8'), 'retained original');
});

test('generated file checks permit ancestor aliases but reject links at or below the approved root', async t => {
  const { actual, alias } = await fixture(t), root = join(actual, 'data', 'thumbnails');
  const image = join(alias, 'data', 'thumbnails', 'image.jpg'); await writeFile(image, 'cached artwork');
  assert.equal(generatedFileInfo(image, root).size, 14);
  assert.equal(generatedFileInfo(join(root, 'image.jpg'), join(alias, 'data', 'thumbnails')).size, 14);
  const pending = join(alias, 'data', 'thumbnails', 'new', 'image.jpg');
  await prepareGeneratedFile(pending, root); await writeFile(pending, 'new artwork');
  assert.equal(generatedFileInfo(pending, root).size, 11);
  const linked = join(root, 'linked'); await dirLink(join(root, 'new'), linked);
  assert.throws(() => generatedFileInfo(join(alias, 'data', 'thumbnails', 'linked', 'image.jpg'), root), /filesystem links/);
  await assert.rejects(prepareGeneratedFile(join(alias, 'data', 'thumbnails', 'linked', 'another.jpg'), root), /filesystem links/);
  await rename(root, root + '-old'); await dirLink(root + '-old', root);
  assert.throws(() => generatedFileInfo(join(root, 'image.jpg'), root), /filesystem links/);
});

test('alias-configured servers serve original streams and offline generated artwork without changing root grants', async t => {
  const context = await fixture(t), { actual, alias } = context;
  const server = context.server = await createVireloServer({ dataDir: join(alias, 'data'), mediaPaths: [join(alias, 'media')], host: '127.0.0.1', port: 0 });
  server.db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
  const path = join(alias, 'media', 'Show', 'source.mp4'); await writeFile(path, 'original video');
  const item = server.db.upsertMedia(media(server.db.visibleLibraries()[0], path));
  const owner = server.accounts.save({ username: 'owner' }, 'fixture-only', undefined, true), cookie = 'virelo_session=' + server.accounts.createSession(owner);
  const call = url => server.app.inject({ url, headers: { host: 'localhost', cookie } });
  assert.equal((await call(`/api/media/${item.id}/stream`)).body, 'original video');
  const artwork = join(alias, 'data', 'thumbnails', 'offline.jpg'); await writeFile(artwork, 'cached generated artwork');
  server.db.updateTechnicalMetadata(item.id, { thumbnail_path: artwork }); await rename(path, path + '.offline');
  assert.equal((await call(`/api/media/${item.id}/artwork/thumbnail`)).body, 'cached generated artwork');
  assert.equal((await call('/api/data')).json().dataDir, join(actual, 'data'));
  const root = server.db.visibleLibraries()[0].path;
  await writeFile(join(actual, 'media', 'Show', 'source.mp4'), 'replacement video');
  assert.ok(resolveLibraryFile(path, root));
  await rename(root, root + '-old'); const denied = join(actual, 'denied'); await mkdir(denied); await mkdir(join(denied, 'Show'));
  await writeFile(join(denied, 'Show', 'source.mp4'), 'DENIED VIDEO'); await dirLink(denied, root);
  assert.equal(resolveLibraryFile(path, root), null);
  assert.equal((await call(`/api/media/${item.id}/stream`)).statusCode, 404);
  assert.equal(await readFile(join(denied, 'Show', 'source.mp4'), 'utf8'), 'DENIED VIDEO');
});
