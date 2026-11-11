import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { HomeData, MediaItem } from '../types';
import { patchFavoriteData, updateHomeFavorites } from '../utils/favorites';

interface FavoriteState { liked: boolean; pending: boolean; error: string }
const mediaKeys = new Set(['home', 'media', 'shorts', 'related', 'watch-queue', 'queue', 'favorites', 'playlist']);

export function useFavorite(item: MediaItem) {
  const client = useQueryClient();
  const key = ['favorite-state', item.id] as const;
  const fallback: FavoriteState = { liked: Boolean(item.liked), pending: false, error: '' };
  // Shared UI state, not another network request for every card or Short.
  const { data = fallback } = useQuery<FavoriteState>({
    queryKey: key, queryFn: () => fallback, enabled: false, placeholderData: fallback
  });
  const matching = { predicate: (query: { queryKey: readonly unknown[] }) => mediaKeys.has(String(query.queryKey[0])) };
  const patch = (liked: boolean) => client.setQueriesData(matching, old => patchFavoriteData(old, item.id, liked));
  const toggle = async () => {
    const previous = client.getQueryData<FavoriteState>(key) ?? fallback;
    if (previous.pending) return;
    const next = !previous.liked;
    client.setQueryData<FavoriteState>(key, { liked: next, pending: true, error: '' });
    await client.cancelQueries(matching);
    patch(next);
    try {
      const result = await api.setLike(item.id, next);
      patch(result.liked);
      client.setQueryData<FavoriteState>(key, { liked: result.liked, pending: false, error: '' });
      client.setQueriesData<HomeData>({ queryKey: ['home'] }, home =>
        home ? updateHomeFavorites(home, item, result.liked) : home);
      // Refresh the saved collection, but never reshuffle an active Shorts feed.
      void client.invalidateQueries({ queryKey: ['favorites'] });
      void client.invalidateQueries({ ...matching, refetchType: 'none' });
    } catch {
      patch(previous.liked);
      client.setQueryData<FavoriteState>(key, {
        liked: previous.liked, pending: false, error: 'Could not update favorites. Try again.'
      });
    }
  };
  return { favorite: data.liked, pending: data.pending, error: data.error, toggle };
}
