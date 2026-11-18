import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueueState } from '@virelo/core/playback-queue';
import { useMediaServices } from '../media-services';

export function useQueueSession(queue: QueueState, playlistId?: number, resumeKey?: string) {
  const { api } = useMediaServices();
  const client = useQueryClient();
  const [key] = useState(() => resumeKey ?? (playlistId ? 'playlist-' + playlistId : 'queue-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))));
  const [error, setError] = useState('');
  const finished = useRef<string | null>(null);
  const pending = useRef<Promise<unknown>>(Promise.resolve());
  const snapshot = JSON.stringify({ ids: queue.ids, manualIds: queue.manualIds, sourceIds: queue.sourceIds, selectedId: queue.selectedId, shuffled: queue.shuffled });
  useEffect(() => {
    if (finished.current === snapshot || !queue.ids.length) return;
    finished.current = null;
    let active = true;
    const save = api.saveQueueSession({ key, playlistId, state: JSON.parse(snapshot), updatedAt: Date.now() })
      .then(() => { if (active) setError(''); void client.invalidateQueries({ queryKey: ['queue-sessions'] }); })
      .catch(() => { if (active) setError('Could not save queue.'); });
    pending.current = Promise.all([pending.current, save]).then(() => undefined);
    return () => { active = false; };
  }, [snapshot, key, playlistId, api, client]);
  const complete = () => {
    finished.current = snapshot;
    void pending.current.then(() => finished.current === snapshot ? api.deleteQueueSession(key) : undefined)
      .then(() => client.invalidateQueries({ queryKey: ['queue-sessions'] })).catch(() => setError('Could not save queue.'));
  };
  return { error, complete };
}
