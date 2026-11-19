import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { QueueState } from '@virelo/core/playback-queue';
import { useMediaServices } from '../media-services';
import { enqueueQueueSessionWrite } from '../utils/queue-session-writes';

export function useQueueSession(queue: QueueState, playlistId?: number, resumeKey?: string) {
  const { api } = useMediaServices();
  const client = useQueryClient();
  const [key] = useState(() => resumeKey ?? (playlistId ? 'playlist-' + playlistId : 'queue-' + (globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36) + '-' + Math.random().toString(36).slice(2))));
  const [error, setError] = useState('');
  const finished = useRef<string | null>(null);
  const mounted = useRef(false);
  const snapshot = JSON.stringify({ ids: queue.ids, manualIds: queue.manualIds, sourceIds: queue.sourceIds, selectedId: queue.selectedId, shuffled: queue.shuffled });
  useEffect(() => {
    let active = true;
    mounted.current = true;
    if (finished.current !== snapshot && queue.ids.length) {
      finished.current = null;
      const value = { key, playlistId, state: JSON.parse(snapshot), updatedAt: Date.now() };
      void enqueueQueueSessionWrite(client, key, () => api.saveQueueSession(value))
        .then(saved => {
          if (!saved) return;
          if (active) setError('');
          void client.invalidateQueries({ queryKey: ['queue-sessions'] });
          void client.invalidateQueries({ queryKey: ['queue-session', key], refetchType: 'none' });
        }).catch(() => { if (active) setError('Could not save queue.'); });
    }
    return () => { active = false; mounted.current = false; };
  }, [snapshot, key, playlistId, api, client]);
  const complete = () => {
    if (!mounted.current || finished.current === snapshot) return;
    finished.current = snapshot;
    void enqueueQueueSessionWrite(client, key, () => api.deleteQueueSession(key))
      .then(deleted => {
        if (!deleted) return;
        void client.invalidateQueries({ queryKey: ['queue-sessions'] });
        void client.invalidateQueries({ queryKey: ['queue-session', key], refetchType: 'none' });
      }).catch(() => { if (mounted.current) setError('Could not save queue.'); });
  };
  return { error, complete };
}
