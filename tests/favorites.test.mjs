import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../web/src/utils/favorites.ts', import.meta.url), 'utf8');
const { patchFavoriteData, updateHomeFavorites, nextFavoritesPage, loadFavoriteQueue } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const item = (id, liked = 0) => ({ id, title: 'Video ' + id, liked, progress_position: 42 });

test('Play all loads every favorite beyond the display and 500-item queue limits', async () => {
  const all = Array.from({length:1205}, (_, id) => item(id, 1)), offsets = [];
  const queue = await loadFavoriteQueue(async (offset, limit) => {
    offsets.push(offset); return all.slice(offset, offset + limit);
  });
  assert.deepEqual(queue, all);
  assert.equal(offsets.at(-1), 1200);
  assert.deepEqual(await loadFavoriteQueue(async () => []), []);
  await assert.rejects(loadFavoriteQueue(async () => all.slice(0,100)), /changed while loading/);
  await assert.rejects(loadFavoriteQueue(async () => {throw new Error('Offline');}), /Offline/);
});

test('favorites updates patch every shelf and virtualized Shorts page without moving items', () => {
  const data = { pages: [{ items: [item(1), item(2)], total: 2 }], pageParams: [0] };
  const patched = patchFavoriteData(data, 1, true);
  assert.equal(patched.pages[0].items[0].liked, 1);
  assert.equal(patched.pages[0].items[0].progress_position, 42);
  assert.deepEqual(patched.pages[0].items.map(value => value.id), [1, 2]);
  assert.deepEqual(patched.pageParams, [0]);
  assert.equal(data.pages[0].items[0].liked, 0);
  assert.deepEqual(patchFavoriteData(patched, 1, false), data);
  assert.equal(patchFavoriteData(item(1), 1, true).liked, 1);
  assert.equal(patchFavoriteData(undefined, 1, true), undefined);
});

test('Home saves exact episodes and Shorts once, and removes only the selected favorite', () => {
  const home = { favorites: [item(1, 1), item(2, 1)], genres: [{ name: 'Drama', items: [item(1)] }] };
  const saved = updateHomeFavorites(home, item(3), true);
  assert.deepEqual(saved.favorites.map(value => value.id), [3, 1, 2]);
  assert.equal(saved.favorites[0].liked, 1);
  assert.deepEqual(updateHomeFavorites(saved, item(3), true), saved);
  assert.deepEqual(updateHomeFavorites(saved, item(1), false).favorites.map(value => value.id), [3, 2]);
  assert.equal(home.favorites.length, 2);
  assert.equal(patchFavoriteData(home, 1, true).genres[0].items[0].liked, 1);
});

test('Favorites pagination keeps going past the Home preview and server page limits', () => {
  const page = Array.from({ length: 100 }, (_, id) => item(id));
  assert.equal(nextFavoritesPage([page]), 100);
  assert.equal(nextFavoritesPage(Array(6).fill(page)), 600);
  assert.equal(nextFavoritesPage([page, [item(101)]]), undefined);
  assert.equal(nextFavoritesPage([page, []]), undefined);
  assert.equal(nextFavoritesPage([]), undefined);
  assert.equal(updateHomeFavorites({ favorites: page }, item(101), true).favorites.length, 24);
});
