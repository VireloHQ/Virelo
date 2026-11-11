import { hydrateMediaIds, openDatabase } from './local-library';
import { mergePlaylistIds, playlistIds, playlistName, playlistRevision, type PlaylistSummary, type PlaylistWrite, type StoredPlaylist } from './utils/playlist-values';
import type { MediaItem, PlaylistDetail } from './types';

async function snapshot(id?: number) {
  const db = await openDatabase();
  return new Promise<{ rows: StoredPlaylist[]; available: Set<number> }>((resolve, reject) => {
    const tx = db.transaction(id === undefined ? ['playlists', 'media'] : ['playlists'], 'readonly');
    const rows = id === undefined ? tx.objectStore('playlists').getAll() : tx.objectStore('playlists').get(id);
    const keys = id === undefined ? tx.objectStore('media').getAllKeys() : null;
    tx.oncomplete = () => resolve({ rows: id === undefined ? rows.result : rows.result ? [rows.result] : [], available: new Set((keys?.result ?? []) as number[]) });
    tx.onabort = () => reject(tx.error ?? new Error('Could not read playlists.'));
  }).finally(() => db.close());
}
const cover=(item?:MediaItem)=>item?{mediaId:item.id,url:item.thumbnail_path}:null;
function summary(row: StoredPlaylist, available: Set<number>, image:PlaylistSummary['cover']=null): PlaylistSummary {
  const count = row.mediaIds.filter(id => available.has(id)).length;
  return { id: row.id, name: row.name, revision: row.revision, createdAt: row.createdAt, updatedAt: row.updatedAt,
    itemCount: count, unavailableCount: row.mediaIds.length - count, cover:image };
}
export async function listLocalPlaylists(): Promise<PlaylistSummary[]> {
  const { rows, available } = await snapshot();
  const firstIds=rows.map(row=>row.mediaIds.find(id=>available.has(id)));
  const images=new Map((await hydrateMediaIds([...new Set(firstIds.filter((id):id is number=>id!==undefined))])).map(item=>[item.id,cover(item)]));
  return rows.sort((a, b) => b.updatedAt - a.updatedAt || b.id - a.id).map(row => summary(row, available,images.get(row.mediaIds.find(id=>available.has(id))!)??null));
}
export async function getLocalPlaylist(id: number): Promise<PlaylistDetail> {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Playlist not found.');
  const { rows: [row] } = await snapshot(id);
  if (!row) throw new Error('Playlist not found.');
  const items = await hydrateMediaIds(row.mediaIds);
  return { ...summary(row, new Set(items.map(item => item.id)),cover(items[0])), items };
}

async function mutate(id: number | undefined, body: { name?: string; mediaIds?: number[]; revision?: number; append?: boolean }, remove = false) {
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) throw new Error('Playlist not found.');
  const name = body.name === undefined && id !== undefined ? undefined : playlistName(body.name);
  const incoming = body.mediaIds === undefined ? undefined : playlistIds(body.mediaIds);
  if (id !== undefined) playlistRevision(body.revision);
  if (body.append !== undefined && typeof body.append !== 'boolean') throw new Error('Append must be a boolean.');
  const db = await openDatabase();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(['playlists', 'media'], 'readwrite'), store = tx.objectStore('playlists');
    const keys = tx.objectStore('media').getAllKeys(), current = id === undefined ? store.count() : store.get(id);
    let available: Set<number> | undefined, ready = false, failure: unknown, resultId = id;
    const save = () => {
      if (!ready || !available) return;
      try {
        if (incoming?.some(value => !available!.has(value))) throw new Error('One or more videos are unavailable.');
        if (id === undefined) {
          if (Number(current.result) >= 1000) throw new Error('You can save up to 1,000 playlists.');
          const now = Date.now();
          const request = store.add({ name, mediaIds: incoming ?? [], revision: 1, createdAt: now, updatedAt: now });
          request.onsuccess = () => { resultId = Number(request.result); };
        } else {
          const row = current.result as StoredPlaylist | undefined;
          if (!row) throw new Error('Playlist not found.');
          if (row.revision !== body.revision) throw new Error('This playlist changed elsewhere. Reload it before saving again.');
          if (remove) store.delete(id);
          else store.put({ ...row, name: name ?? row.name, revision: row.revision + 1, updatedAt: Date.now(),
            mediaIds: incoming ? mergePlaylistIds(row.mediaIds, incoming, available, body.append === true) : row.mediaIds });
        }
      } catch (error) { failure = error; tx.abort(); }
    };
    keys.onsuccess = () => { available = new Set(keys.result as number[]); save(); };
    current.onsuccess = () => { ready = true; save(); };
    tx.oncomplete = () => resolve(resultId!);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('Could not save the playlist.'));
  }).finally(() => db.close());
}
export async function createLocalPlaylist(body: { name: string; mediaIds: number[] }) {
  return getLocalPlaylist(await mutate(undefined, body));
}
export async function updateLocalPlaylist(id: number, body: PlaylistWrite) {
  return getLocalPlaylist(await mutate(id, body));
}
export async function deleteLocalPlaylist(id: number, revision: number) {
  await mutate(id, { revision }, true); return { ok: true };
}
