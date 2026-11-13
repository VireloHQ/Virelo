import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
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
  const items = [episode(1, 1, 'ÉTÉ', 1, 1), episode(2, 1, 'Été Extended', 1, 2),
    episode(3, 2, 'Été', 1, 3), episode(4, 1, '\tété ', 1, 4),
    episode(5, 1, 'Été', 1, 5, 'movie')];
  assert.deepEqual(sortSeriesEpisodes(items, ' Été ', 1).map(item => item.id), [1, 4]);
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
