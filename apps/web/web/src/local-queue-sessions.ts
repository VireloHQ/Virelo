import { openDatabase, hydrateMediaIds } from './local-library';
import { getLocalPlaylist } from './local-playlists';
import { parseQueueSession, restrictQueueSession, type QueueSession } from '@virelo/core/queue-session';

const storageKey = 'queue-sessions';
async function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, resolve: (value: T) => void) => void) {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction('settings', mode);
    let result: T;
    operation(tx.objectStore('settings'), value => { result = value; });
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new Error('Could not save queue.'));
  }).finally(() => db.close());
}
function read(value: unknown): QueueSession[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => { try { return [{ ...parseQueueSession(entry), updatedAt: Number(entry.updatedAt) || 0 }]; } catch { return []; } }).slice(0, 12);
}
const all = () => transaction<QueueSession[]>('readonly', (store, resolve) => { const request = store.get(storageKey); request.onsuccess = () => resolve(read(request.result)); });
export async function localQueueSession(key: string) {
  const session = (await all()).find(entry => entry.key === key);
  if (!session) throw new Error('Saved queue not found.');
  const playlist = session.playlistId ? await getLocalPlaylist(session.playlistId) : undefined;
  const items = playlist?.items ?? await hydrateMediaIds(session.state.sourceIds);
  const safe = restrictQueueSession(session, items.map(item => item.id));
  if (!safe) throw new Error('Saved queue not found.');
  return { ...safe, items, label: playlist?.name };
}
export async function localQueueSessions() {
  const result = [];
  for (const entry of await all()) {
    try {
      const playlist = entry.playlistId ? await getLocalPlaylist(entry.playlistId) : undefined;
      let item = playlist ? playlist.items.find(item => item.id === entry.state.selectedId) : (await hydrateMediaIds([entry.state.selectedId]))[0];
      if (!item) {
        const available = playlist?.items ?? await hydrateMediaIds(entry.state.ids);
        const safe = restrictQueueSession(entry, available.map(item => item.id));
        item = available.find(item => item.id === safe?.state.selectedId);
      }
      if (item) result.push({ key: entry.key, playlistId: entry.playlistId, label: playlist?.name, updatedAt: entry.updatedAt, item });
    } catch { /* Removed libraries and playlists have no resumable entry. */ }
  }
  return result;
}
export async function saveLocalQueueSession(value: QueueSession) {
  const session = parseQueueSession(value);
  return transaction<{ ok: boolean }>('readwrite', (store, resolve) => {
    const request = store.get(storageKey);
    request.onsuccess = () => { store.put([session, ...read(request.result).filter(entry => entry.key !== session.key)].slice(0, 12), storageKey); resolve({ ok: true }); };
  });
}
export async function deleteLocalQueueSession(key: string) {
  return transaction<{ ok: boolean }>('readwrite', (store, resolve) => {
    const request = store.get(storageKey);
    request.onsuccess = () => { store.put(read(request.result).filter(entry => entry.key !== key), storageKey); resolve({ ok: true }); };
  });
}
