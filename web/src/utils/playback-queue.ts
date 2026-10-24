export type QueueLayout = 'horizontal' | 'vertical';
export interface QueueSnapshot {
  ids: number[];
  manualIds: number[];
  selectedId: number;
  shuffled: boolean;
}
export interface QueueState extends QueueSnapshot {
  sourceIds: number[];
  undo: QueueSnapshot | null;
  notice: string;
}
const same = (a: number[], b: number[]) => a.length === b.length && a.every((id, index) => id === b[index]);

export function createQueue(sourceIds: number[], selectedId: number, shuffle=false): QueueState {
  const ids = [...new Set(sourceIds)];
  const state: QueueState = { ids, manualIds: ids, sourceIds: ids, selectedId: ids.includes(selectedId) ? selectedId : ids[0],
    shuffled: false, undo: null, notice: '' };
  return shuffle ? { ...toggleQueueShuffle(state), undo: null, notice: '' } : state;
}

// Refetches update metadata and membership without undoing queue edits.
export function reconcileQueue(state: QueueState, source: number[]): QueueState {
  const sourceIds = [...new Set(source)];
  if (same(state.sourceIds, sourceIds)) return state;
  const available = new Set(sourceIds), known = new Set(state.sourceIds);
  const added = sourceIds.filter(id => !known.has(id));
  const retain = (ids: number[]) => ids.filter(id => available.has(id));
  const ids = [...retain(state.ids), ...added], manualIds = [...retain(state.manualIds), ...added];
  const selectedId = ids.includes(state.selectedId) ? state.selectedId : ids[Math.min(Math.max(0, state.ids.indexOf(state.selectedId)), ids.length - 1)];
  const undo = state.undo ? { ...state.undo, ids: retain(state.undo.ids), manualIds: retain(state.undo.manualIds) } : null;
  return { ...state, ids, manualIds, sourceIds, selectedId, undo };
}

function edit(state: QueueState, next: Partial<QueueSnapshot>, notice: string): QueueState {
  const { ids, manualIds, selectedId, shuffled } = state;
  return { ...state, ...next, undo: { ids, manualIds, selectedId, shuffled }, notice };
}

export function moveQueueItem(state: QueueState, id: number, target: number): QueueState {
  const index = state.ids.indexOf(id);
  if (index < 0 || !Number.isInteger(target) || target < 0 || target >= state.ids.length || index === target) return state;
  const ids = [...state.ids];
  ids.splice(index, 1); ids.splice(target, 0, id);
  return edit(state, { ids, manualIds: ids, shuffled: false }, 'Queue reordered.');
}
export function playQueueItemNext(state: QueueState, id: number): QueueState {
  if (id === state.selectedId || !state.ids.includes(id)) return state;
  const without = state.ids.filter(value => value !== id);
  const target = without.indexOf(state.selectedId) + 1;
  const ids = [...without]; ids.splice(target, 0, id);
  if (same(ids, state.ids)) return state;
  return edit(state, { ids, manualIds: ids, shuffled: false }, 'Video will play next.');
}
export function removeQueueItem(state: QueueState, id: number): QueueState {
  const index = state.ids.indexOf(id);
  if (index < 0 || state.ids.length <= 1) return state;
  const ids = state.ids.filter(value => value !== id);
  return edit(state, { ids, manualIds: state.manualIds.filter(value => value !== id),
    selectedId: id === state.selectedId ? ids[Math.min(index, ids.length - 1)] : state.selectedId }, 'Video removed from queue.');
}
export function clearUpcoming(state: QueueState): QueueState {
  const index = state.ids.indexOf(state.selectedId);
  if (index < 0 || index === state.ids.length - 1) return state;
  const ids = state.ids.slice(0, index + 1), kept = new Set(ids);
  return edit(state, { ids, manualIds: state.manualIds.filter(id => kept.has(id)) }, 'Upcoming videos removed from queue.');
}
export function toggleQueueShuffle(state: QueueState, random: () => number = Math.random): QueueState {
  if (state.ids.length < 2) return state;
  if (state.shuffled) return edit(state, { ids: state.manualIds, shuffled: false }, 'Shuffle off. Custom order restored.');
  const rest = state.ids.filter(id => id !== state.selectedId);
  for (let i = rest.length - 1; i > 0; i--) {
    const target = Math.floor(random() * (i + 1));
    [rest[i], rest[target]] = [rest[target], rest[i]];
  }
  return edit(state, { ids: [state.selectedId, ...rest], manualIds: state.ids, shuffled: true }, 'Shuffle on.');
}
export function resetQueue(state: QueueState): QueueState {
  if (same(state.ids, state.sourceIds) && !state.shuffled) return state;
  return edit(state, { ids: state.sourceIds, manualIds: state.sourceIds, shuffled: false }, 'Original queue restored.');
}
export function undoQueueEdit(state: QueueState): QueueState {
  if (!state.undo?.ids.length) return state;
  const selectedId = state.undo.ids.includes(state.selectedId) ? state.selectedId :
    state.undo.ids.includes(state.undo.selectedId) ? state.undo.selectedId : state.undo.ids[0];
  return { ...state, ...state.undo, selectedId, undo: null, notice: 'Queue change undone.' };
}
