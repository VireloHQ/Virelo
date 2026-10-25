export class PlaylistValueError extends Error { readonly statusCode = 400; }
export const MAX_PLAYLIST_ITEMS = 10_000;
export interface PlaylistSummary {
  id: number; name: string; revision: number; createdAt: number; updatedAt: number;
  itemCount: number; unavailableCount: number;
}
export interface PlaylistWrite { name?: string; mediaIds?: number[]; revision: number; append?: boolean }
export interface StoredPlaylist {
  id: number; name: string; revision: number; mediaIds: number[]; createdAt: number; updatedAt: number;
}
export function playlistName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || [...value.trim()].length > 100 || /[\p{Cc}]/u.test(value))
    throw new PlaylistValueError('Enter a playlist name with 1–100 characters.');
  return value.trim();
}
export function playlistIds(value: unknown): number[] {
  if (!Array.isArray(value) || value.length > MAX_PLAYLIST_ITEMS || value.some(id => !Number.isSafeInteger(id) || id <= 0))
    throw new PlaylistValueError('A playlist can contain up to 10,000 valid video IDs.');
  return [...new Set(value as number[])];
}
export function playlistRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new PlaylistValueError('A valid playlist revision is required.');
  return Number(value);
}
export function mergePlaylistIds(previous: number[], incoming: number[], available: Set<number>, append = false): number[] {
  let result: number[];
  if (append) result = [...new Set([...previous, ...incoming])];
  else {
    let index = 0;
    // Preserve inaccessible references without exposing their IDs or silently deleting them.
    result = previous.flatMap(id => available.has(id) ? index < incoming.length ? [incoming[index++]] : [] : [id]);
    result.push(...incoming.slice(index));
  }
  if (result.length > MAX_PLAYLIST_ITEMS) throw new PlaylistValueError('A playlist can contain up to 10,000 videos.');
  return result;
}
