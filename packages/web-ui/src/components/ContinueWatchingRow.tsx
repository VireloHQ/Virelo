import { useQuery } from '@tanstack/react-query';
import { t, useLocale } from '@edition/i18n';
import type { MediaItem } from '@edition/types';
import { useMediaServices } from '../media-services';
import { MediaRow } from './MediaRow';

export function ContinueWatchingRow({ items, kind = 'all', hiddenLibraryIds }: { items: MediaItem[]; kind?: 'all' | 'movie' | 'series'; hiddenLibraryIds?:number[] }) {
  useLocale();
  const { api } = useMediaServices();
  const sessions = useQuery({ queryKey: ['queue-sessions'], queryFn: api.queueSessions, staleTime: 0 });
  const byId = new Map<number, MediaItem>();
  const resumeSessions: Record<number, { key: string; label: string }> = {};
  for (const session of sessions.data ?? []) {
    if (byId.has(session.item.id) || hiddenLibraryIds?.includes(session.item.library_id) || kind !== 'all' && session.item.kind !== kind) continue;
    byId.set(session.item.id, session.item);
    resumeSessions[session.item.id] = { key: session.key, label: session.playlistId ? t('Playlist') + (session.label ? ' · ' + session.label : '') : t('Queue') };
  }
  for (const item of items) if (!byId.has(item.id)) byId.set(item.id, item);
  return <MediaRow title={t('Continue watching')} items={[...byId.values()]} playDirect resumeSessions={resumeSessions}/>;
}
