import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';

function seed(db, libraryId, title, { added_at, year, duration } = {}) {
  const lower = title.toLowerCase();
  const item = db.upsertMedia({
    library_id: libraryId,
    path: `/yt/${title}.mp4`, filename: `${title}.mp4`, title, sort_title: lower, kind: 'movie',
    series_title: null, season: null, episode: null, year: null, duration: null, width: 720, height: 1280,
    video_codec: 'h264', audio_codec: 'aac', container: 'mp4', folder: '', size: 1, mtime: 1,
    thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null
  });
  db.db.prepare('UPDATE media SET added_at=COALESCE(?,added_at), year=COALESCE(?,year), duration=COALESCE(?,duration) WHERE id=?')
    .run(added_at ?? null, year ?? null, duration ?? null, item.id);
  return item;
}

async function withDb(run) {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-sort-'));
  try {
    await Promise.all(['thumbnails', 'artwork', 'cache'].map((name) => mkdir(join(dir, name), { recursive: true })));
    const db = new VireloDB(dir);
    try { run(db); }
    finally { db.close(); }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('listMedia sorts by title (default), newest, and oldest', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/yt', 'YouTube');
    seed(db, library.id, 'Zeta', { added_at: 3, year: 2010, duration: 300 });
    seed(db, library.id, 'Alpha', { added_at: 1, year: 2020, duration: 100 });
    seed(db, library.id, 'beta', { added_at: 2, year: 2015, duration: 200 });

    const titles = (rows) => rows.map((r) => r.title);
    assert.deepEqual(titles(db.listMedia({ sort: 'title' })), ['Alpha', 'beta', 'Zeta']);
    assert.deepEqual(titles(db.listMedia({ sort: 'newest' })), ['Zeta', 'beta', 'Alpha']);
    assert.deepEqual(titles(db.listMedia({ sort: 'oldest' })), ['Alpha', 'beta', 'Zeta']);
  });
});

test('sortKey year and duration put NULLs last in desc order', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/yt', 'YouTube');
    seed(db, library.id, 'A', { year: 2010, duration: 100 });
    seed(db, library.id, 'B', { year: null, duration: 500 });
    seed(db, library.id, 'C', { year: 2022, duration: null });

    const titles = (rows) => rows.map((r) => r.title);
    assert.deepEqual(titles(db.listMedia({ sort: 'year' })), ['C', 'A', 'B']);
    assert.deepEqual(titles(db.listMedia({ sort: 'duration' })), ['B', 'A', 'C']);
  });
});

test('sortKey random returns the same set', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/yt', 'YouTube');
    const inserted = ['A', 'B', 'C', 'D', 'E'].map((t) => seed(db, library.id, t));
    const ids = new Set(inserted.map((i) => i.id));
    for (let run = 0; run < 3; run++) {
      const result = db.listMedia({ sort: 'random' });
      assert.equal(result.length, 5);
      assert.deepEqual(new Set(result.map((r) => r.id)), ids);
    }
  });
});

test('queueBehavior setting persists through updateSettings', async () => {
  await withDb((db) => {
    assert.equal(db.getSettings().queueBehavior, 'auto');
    db.updateSettings({ queueBehavior: 'loop' });
    assert.equal(db.getSettings().queueBehavior, 'loop');
    db.updateSettings({ queueBehavior: 'manual' });
    assert.equal(db.getSettings().queueBehavior, 'manual');
  });
});
