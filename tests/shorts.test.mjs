import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';

function seed(db, library, path, title, width, height) {
  return db.upsertMedia({
    library_id: library.id,
    path, filename: path.split('/').pop(), title, sort_title: title.toLowerCase(), kind: 'movie',
    series_title: null, season: null, episode: null, year: null, duration: 30, width, height,
    video_codec: 'h264', audio_codec: 'aac', container: 'mp4', folder: '', size: 1, mtime: 1,
    thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null
  });
}

async function withDb(run) {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-shorts-'));
  try {
    await Promise.all(['thumbnails', 'artwork', 'cache'].map((name) => mkdir(join(dir, name), { recursive: true })));
    const db = new VireloDB(dir);
    try { await run(db, dir); }
    finally { db.close(); }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('shorts feed defaults to portrait videos and paginates', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/tmp/media', 'Media');
    const portrait = seed(db, library, '/tmp/media/vertical.mp4', 'Vertical Clip', 720, 1280);
    seed(db, library, '/tmp/media/wide.mp4', 'Wide Movie', 1920, 1080);
    seed(db, library, '/tmp/media/unknown.mp4', 'Unknown Dimensions', null, null);

    const defaultFeed = db.getShorts({});
    assert.equal(defaultFeed.total, 1);
    assert.equal(defaultFeed.items[0].id, portrait.id);

    const landscapeFeed = db.getShorts({ includeLandscapes: true });
    assert.equal(landscapeFeed.total, 2);

    const firstPage = db.getShorts({ limit: 1, offset: 0, includeLandscapes: true });
    const secondPage = db.getShorts({ limit: 1, offset: 1, includeLandscapes: true });
    assert.equal(firstPage.items.length, 1);
    assert.equal(secondPage.items.length, 1);
    assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);
  });
});

test('likes persist and join into the shorts feed', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/tmp/media', 'Media');
    const clip = seed(db, library, '/clip.mp4', 'Clip', 720, 1280);

    const before = db.getShorts({});
    assert.equal(before.items[0].liked, 0);

    db.setLike(clip.id, true);
    const liked = db.getShorts({});
    assert.equal(liked.items[0].liked, 1);

    db.setLike(clip.id, false);
    const unliked = db.getShorts({});
    assert.equal(unliked.items[0].liked, 0);
  });
});

test('shorts feed reports watch progress', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/tmp/media', 'Media');
    const clip = seed(db, library, '/clip.mp4', 'Clip', 720, 1280);
    db.setProgress(clip.id, 12, 30);
    const feed = db.getShorts({});
    assert.equal(feed.items[0].progress_position, 12);
    assert.equal(feed.items[0].progress_completed, 0);
  });
});

test('a seeded Shorts session is shuffled, stable across pages and unaffected by progress', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/tmp/shorts-shuffle', 'Shorts');
    for (let i = 0; i < 95; i++) seed(db, library, '/tmp/shorts-shuffle/'+i+'.mp4', 'Clip '+i, 720, 1280);
    const order = (seed) => [0, 40, 80].flatMap((offset) => db.getShorts({ seed, offset, limit: 40 }).items.map((item) => item.id));
    const first = order(12345);
    assert.equal(first.length, 95);
    assert.equal(new Set(first).size, 95);
    assert.deepEqual(order(12345), first);
    assert.notDeepEqual(order(98765), first);
    db.setProgress(first[0], 10, 30);
    db.setLike(first[0], true);
    assert.deepEqual(order(12345), first);
  });
});

test('an explicit Short starts first even beyond page one, without duplicating or losing clips', async () => {
  await withDb((db) => {
    const library = db.addLibrary('/tmp/shorts-selected', 'Shorts');
    for (let i = 0; i < 95; i++) seed(db, library, '/tmp/shorts-selected/'+i+'.mp4', 'Clip '+i, 720, 1280);
    const order = (seed, startId) => [0, 40, 80].flatMap(offset => db.getShorts({seed,startId,offset,limit:40}).items.map(item => item.id));
    const random = order(12345);
    const startId = random[85];
    const selected = order(12345, startId);
    assert.equal(selected[0], startId);
    assert.equal(new Set(selected).size, 95);
    assert.deepEqual(selected.slice(1), random.filter(id => id !== startId));
    assert.deepEqual(order(12345, startId), selected);
    assert.equal(order(98765, startId)[0], startId);
    assert.notDeepEqual(order(98765, startId).slice(1), selected.slice(1));
    db.setProgress(startId, 12, 30);
    db.setLike(startId, true);
    const first = db.getShorts({seed:12345,startId,limit:40});
    assert.equal(first.total, 95);
    assert.equal(first.items[0].liked, 1);
    assert.equal(first.items[0].progress_position, 12);
    assert.deepEqual(order(12345, startId), selected);
    assert.deepEqual(order(12345), random);
    for(const invalid of [0,-1,NaN,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]) assert.deepEqual(order(12345,invalid),random);
  });
});

test('pinning cannot bypass library visibility or the Shorts eligibility setting', async () => {
  await withDb((db, dir) => {
    const library = db.addLibrary('/tmp/shorts-visible', 'Visible',false);
    const other = db.addLibrary('/tmp/shorts-hidden', 'Hidden',false);
    const visible = seed(db, library, '/tmp/shorts-visible/clip.mp4', 'Visible', 720, 1280);
    const hidden = seed(db, other, '/tmp/shorts-hidden/clip.mp4', 'Hidden', 720, 1280);
    const wide = seed(db, library, '/tmp/shorts-visible/wide.mp4', 'Wide', 1280, 720);
    const reopened = new VireloDB(dir);
    try {
      reopened.addLibrary(library.path, library.label);
      const feed = reopened.getShorts({startId:hidden.id});
      assert.equal(feed.total, 1);
      assert.equal(feed.items[0].id, visible.id);
      assert.equal(reopened.getShorts({startId:wide.id}).items[0].id, visible.id);
      assert.equal(reopened.getShorts({startId:wide.id,includeLandscapes:true}).items[0].id, wide.id);
      assert.equal(reopened.getShorts({startId:999999}).total, 1);
    } finally { reopened.close(); }
  });
});
