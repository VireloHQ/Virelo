import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Accounts } from '../dist/accounts.js';
import { VireloDB } from '../dist/db.js';
const source = await readFile(new URL('../../../packages/core/src/utils/series-playback.ts', import.meta.url), 'utf8');
const { sortSeriesEpisodes } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const episode = (id, library_id, series_title, season, number, kind = 'series') =>
  ({ id, library_id, series_title, season, episode: number, kind, title: `Episode ${number}` });

test('series Play all uses natural season and episode order', () => {
  const items = [episode(10, 1, 'Northbound', 1, 10), episode(3, 1, 'Northbound', 2, 1),
    episode(2, 1, 'Northbound', 1, 2), episode(1, 1, 'Northbound', 1, 1)];
  assert.deepEqual(sortSeriesEpisodes(items, 'Northbound', 1).map(item => item.id), [1, 2, 10, 3]);
  assert.deepEqual(items.map(item => item.id), [10, 3, 2, 1]);
});

test('series Play all excludes titles containing the query and other libraries', () => {
  const items = [episode(1, 1, 'Northbound', 1, 1), episode(2, 1, 'Northbound Extended', 1, 2),
    episode(3, 2, 'Northbound', 1, 3), episode(4, 1, 'northbound ', 1, 4),
    episode(5, 1, 'Northbound', 1, 5, 'movie')];
  assert.deepEqual(sortSeriesEpisodes(items, ' Northbound ', 1).map(item => item.id), [1, 4]);
});

test('unnumbered episodes follow numbered episodes', () => {
  const items = [episode(4, 1, 'Show', null, null), episode(2, 1, 'Show', 1, 2),
    episode(3, 1, 'Show', 2, null), episode(1, 1, 'Show', 1, 1)];
  assert.deepEqual(sortSeriesEpisodes(items, 'Show', 1).map(item => item.id), [1, 2, 3, 4]);
});

test('detail, watch and route all accept the series queue in this edition', async () => {
  const detail = await readFile(new URL('../web/src/views/DetailView.tsx', import.meta.url), 'utf8');
  const watch = await readFile(new URL('../web/src/views/WatchView.tsx', import.meta.url), 'utf8');
  const router = await readFile(new URL('../web/src/router.tsx', import.meta.url), 'utf8');
  assert.match(detail, /Play all/);
  assert.match(detail, /seriesTitle:item\.series_title!/);
  assert.match(watch, /sortSeriesEpisodes\(source/);
  assert.match(router, /seriesTitle\?: string/);
});

test('server series selector matches Unicode case and whitespace before paging and respects library access', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-series-'));
  const db = new VireloDB(dir);
  try {
    new Accounts(db.db);
    const library = db.addLibrary(join(dir, 'visible'), 'Visible');
    const other = db.addLibrary(join(dir, 'other'), 'Other');
    const insert = db.db.prepare(`INSERT INTO media
      (library_id, path, filename, title, sort_title, kind, series_title, size, mtime, added_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 1, 1)`);
    const seed = (libraryId, name, title, kind = 'series') =>
      insert.run(libraryId, join(dir, name), name, name, name, kind, title).lastInsertRowid;
    seed(library.id, '0', 'Été Extended');
    const first = seed(library.id, '1', '\tÉTÉ ');
    const second = seed(library.id, '2', 'été');
    seed(library.id, '3', 'été', 'movie');
    seed(other.id, '4', 'été');
    const scope = { userId: 1, libraryIds: [library.id] };
    const query = { kind: 'series', seriesTitle: ' été ', libraryId: library.id, limit: 1 };
    assert.deepEqual(db.listMedia(query, scope).map(row => row.id), [first]);
    assert.deepEqual(db.listMedia({ ...query, offset: 1 }, scope).map(row => row.id), [second]);
    assert.deepEqual(db.listMedia({ ...query, offset: 2 }, scope), []);
    assert.deepEqual(db.listMedia({ ...query, libraryId: other.id }, scope), []);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
