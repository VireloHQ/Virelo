import type { HomeData, MediaItem } from '../types';

// Patch existing items only: Shorts order, pagination offsets and playback data stay intact.
export function patchFavoriteData(data: unknown, id: number, liked: boolean): unknown {
  if (Array.isArray(data)) return data.map(value => patchFavoriteData(value, id, liked));
  if (!data || typeof data !== 'object') return data;
  const record = data as Record<string, unknown>;
  if (record.id === id && typeof record.title === 'string') return { ...record, liked: Number(liked) };
  return Object.fromEntries(Object.entries(record).map(([key, value]) =>
    [key, Array.isArray(value) ? patchFavoriteData(value, id, liked) : value]));
}

export function updateHomeFavorites(home: HomeData, item: MediaItem, liked: boolean): HomeData {
  const favorites = home.favorites.filter(value => value.id !== item.id);
  if (liked) favorites.unshift({ ...item, liked: 1 });
  return { ...home, favorites: favorites.slice(0, 24) };
}

export const FAVORITES_PAGE_SIZE = 100;
export async function loadFavoriteQueue(fetchPage: (offset: number, limit: number) => Promise<MediaItem[]>): Promise<MediaItem[]> {
  const items: MediaItem[] = [], seen = new Set<number>();
  for (let offset = 0; ; offset += FAVORITES_PAGE_SIZE) {
    const page = await fetchPage(offset, FAVORITES_PAGE_SIZE);
    const fresh = page.filter(item => !seen.has(item.id));
    for (const item of fresh) { seen.add(item.id); items.push(item); }
    if (page.length < FAVORITES_PAGE_SIZE) return items;
    if (!fresh.length) throw new Error('The favorites list changed while loading. Please try again.');
  }
}

export function nextFavoritesPage(pages: MediaItem[][]): number | undefined {
  return pages.at(-1)?.length === FAVORITES_PAGE_SIZE
    ? pages.reduce((count, page) => count + page.length, 0) : undefined;
}
