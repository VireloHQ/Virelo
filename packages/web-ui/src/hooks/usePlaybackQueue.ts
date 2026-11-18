import { useState } from 'react';
import type { MediaItem } from '@edition/types';
import { createQueue, reconcileQueue, type QueueState } from '@virelo/core/playback-queue';
import type { SavedQueueState } from '@virelo/core/queue-session';

export function usePlaybackQueue(source: MediaItem[], initialId: number, shuffle=false, saved?: SavedQueueState) {
  const sourceIds = source.map(item => item.id);
  const [state, setState] = useState<QueueState>(() => saved ? { ...saved, undo: null, notice: '' } : createQueue(sourceIds, initialId, shuffle));
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
