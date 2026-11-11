import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';

function seed(db, libraryId, path, title, folder) {
  return db.upsertMedia({
    library_id: libraryId,
    path, filename: path.split('/').pop(), title, sort_title: title.toLowerCase(), kind: 'movie',
    series_title: null, season: null, episode: null, year: null, duration: 30, width: 720, height: 1280,
    video_codec: 'h264', audio_codec: 'aac', container: 'mp4', folder, size: 1, mtime: 1,
    thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null
  });
}

async function withDb(run) {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-folders-'));
  try {
    await Promise.all(['thumbnails', 'artwork', 'cache'].map((name) => mkdir(join(dir, name), { recursive: true })));
    const db = new VireloDB(dir);
    try { run(db); }
    finally { db.close(); }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('media stores its relative folder and root files use empty string', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/yt', 'YouTube');
    const inChannel = seed(db, library.id, '/yt/Channels/ブライアン/a.mp4', 'A', 'Channels/ブライアン');
    const nested = seed(db, library.id, '/yt/Channels/ブライアン/Clips/b.mp4', 'B', 'Channels/ブライアン/Clips');
    const rootFile = seed(db, library.id, '/yt/root.mp4', 'Root', '');

    assert.equal(db.getMedia(inChannel.id).folder, 'Channels/ブライアン');
    assert.equal(db.getMedia(nested.id).folder, 'Channels/ブライアン/Clips');
    assert.equal(db.getMedia(rootFile.id).folder, '');
  });
});

test('getFolders returns counted folder entries per library', async () => {
  await withDb((db) => {
    const yt = db.addLibrary('/yt', 'YouTube');
    const tt = db.addLibrary('/tt', 'TikTok');
    seed(db, yt.id, '/yt/Channels/a.mp4', 'A1', 'Channels');
    seed(db, yt.id, '/yt/Channels/b.mp4', 'A2', 'Channels');
    seed(db, yt.id, '/yt/root.mp4', 'R', '');
    seed(db, tt.id, '/tt/my.mp4', 'T', 'My Videos');

    const folders = db.getFolders().map((f) => ({ library_id: f.library_id, folder: f.folder, count: f.count }));
    assert.deepEqual(folders.sort((x, y) => x.folder.localeCompare(y.folder) || x.library_id - y.library_id), [
      { library_id: yt.id, folder: '', count: 1 },
      { library_id: yt.id, folder: 'Channels', count: 2 },
      { library_id: tt.id, folder: 'My Videos', count: 1 }
    ]);
  });
});

test('listMedia filters by folder including the root', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/yt', 'YouTube');
    seed(db, library.id, '/yt/Channels/a.mp4', 'A', 'Channels');
    seed(db, library.id, '/yt/root.mp4', 'R', '');

    const channels = db.listMedia({ folder: 'Channels' });
    assert.equal(channels.length, 1);
    assert.equal(channels[0].title, 'A');

    const rootOnly = db.listMedia({ folder: '' });
    assert.equal(rootOnly.length, 1);
    assert.equal(rootOnly[0].title, 'R');

    assert.equal(db.listMedia({}).length, 2);
  });
});
