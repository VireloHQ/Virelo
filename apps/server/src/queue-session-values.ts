export interface SavedQueueState {
  ids: number[];
  manualIds: number[];
  sourceIds: number[];
  selectedId: number;
  shuffled: boolean;
}
export interface QueueSession {
  key: string;
  playlistId?: number;
  state: SavedQueueState;
  updatedAt: number;
}
export class QueueSessionError extends Error { readonly statusCode = 400; }
export const validQueueSessionKey = (key: unknown): key is string => typeof key === 'string' && /^(queue|playlist)-[a-zA-Z0-9-]{1,80}$/.test(key);
export function parseQueueSession(input: unknown): QueueSession {
  const value = input as QueueSession;
  if (!value || !validQueueSessionKey(value.key) || !value.state) throw new QueueSessionError('Invalid saved queue.');
  const ids = (value: unknown): number[] => {
    if (!Array.isArray(value) || value.length > 10000 || value.some(id => !Number.isSafeInteger(id) || id <= 0)
      || new Set(value).size !== value.length) throw new QueueSessionError('Invalid saved queue.');
    return [...value];
  };
  const state = { ids: ids(value.state.ids), manualIds: ids(value.state.manualIds), sourceIds: ids(value.state.sourceIds),
    selectedId: value.state.selectedId, shuffled: value.state.shuffled };
  const source = new Set(state.sourceIds), ordered = new Set(state.ids);
  if (!ordered.has(state.selectedId) || typeof state.shuffled !== 'boolean' || state.ids.some(id => !source.has(id))
    || state.manualIds.length !== state.ids.length || state.manualIds.some(id => !ordered.has(id))) throw new QueueSessionError('Invalid saved queue.');
  if (value.playlistId !== undefined && (!Number.isSafeInteger(value.playlistId) || value.playlistId <= 0
    || value.key !== 'playlist-' + value.playlistId)) throw new QueueSessionError('Invalid saved queue.');
  if (value.playlistId === undefined && !value.key.startsWith('queue-')) throw new QueueSessionError('Invalid saved queue.');
  return { key: value.key, ...(value.playlistId === undefined ? {} : { playlistId: value.playlistId }), state, updatedAt: Date.now() };
}
export function restrictQueueSession(session: QueueSession, availableIds: number[]): QueueSession | null {
  const available = new Set(availableIds), ids = session.state.ids.filter(id => available.has(id));
  if (!ids.length) return null;
  const index = session.state.ids.indexOf(session.state.selectedId);
  const selectedId = session.state.ids.slice(index).find(id => available.has(id)) ?? ids.at(-1)!;
  return { ...session, state: { ...session.state, ids, selectedId,
    manualIds: session.state.manualIds.filter(id => available.has(id)), sourceIds: session.state.sourceIds.filter(id => available.has(id)) } };
}
