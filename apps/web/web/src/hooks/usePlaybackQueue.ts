import { useState } from 'react';
import type { MediaItem } from '../types';
import { createQueue, reconcileQueue, type QueueState } from '../utils/playback-queue';

export function usePlaybackQueue(source: MediaItem[], initialId: number, shuffle=false) {
  const sourceIds = source.map(item => item.id);
  const [state, setState] = useState(() => createQueue(sourceIds, initialId, shuffle));
  const queue = reconcileQueue(state, sourceIds);
  if (queue !== state) setState(queue);
  const byId = new Map(source.map(item => [item.id, item]));
  const items = queue.ids.map(id => byId.get(id)!).filter(Boolean);
  const update = (change: (current: QueueState) => QueueState) =>
    setState(current => change(reconcileQueue(current, sourceIds)));
  const select = (index: number) => {
    const id = items[index]?.id;
    if (id !== undefined) update(current => ({ ...current, selectedId: id }));
  };
  return { queue, items, activeIndex: Math.max(0, items.findIndex(item => item.id === queue.selectedId)), update, select };
}
