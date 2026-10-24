import { PageSkeleton } from '../components/PageSkeleton';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearch } from '@tanstack/react-router';
import { api } from '../api';
import { PlaybackQueue } from '../components/PlaybackQueue';
import { Player } from '../components/Player';
import { queueDestination, type RepeatMode } from '../utils/playback-repeat';
import { loadFavoriteQueue, loadMediaQueue } from '../utils/favorites';
import { usePlaybackQueue } from '../hooks/usePlaybackQueue';
import { useQueueLayout } from '../hooks/useQueueLayout';
import type { MediaItem, QueueBehavior } from '../types';

export function WatchView() {
  const { mediaId } = useParams({ from: '/watch/$mediaId' });
  const searchParams = useSearch({ from: '/watch/$mediaId' });
  const queueEnabled = Boolean(searchParams.queue);
  const queueLayout = useQueueLayout(state => state.layout);
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const queueQ = useQuery({
    queryKey: ['watch-queue', searchParams],
    queryFn: () => (searchParams.favorites ? loadFavoriteQueue : loadMediaQueue)((offset, limit) => api.media({
      liked: searchParams.favorites ? 1 : undefined, search: searchParams.search, folder: searchParams.folder,
      libraryId: searchParams.libraryId, sort: searchParams.sort === 'random' ? 'title' : searchParams.sort, offset, limit
    })),
    enabled: queueEnabled
  });
  const itemQ = useQuery({ queryKey: ['media', Number(mediaId)], queryFn: () => api.mediaById(Number(mediaId)), enabled: !queueEnabled });
  if (queueEnabled) {
    if (queueQ.isError && !queueQ.data) return <div className="watch-empty" role="alert"><h1>Could not load queue</h1><p>{queueQ.error.message}</p><button onClick={() => void queueQ.refetch()}>Try again</button></div>;
    if (!queueQ.data) return <PageSkeleton kind="watch" queueLayout={queueLayout}/>;
    return <QueuedWatch key={JSON.stringify([mediaId, searchParams.search, searchParams.folder, searchParams.libraryId, searchParams.sort, searchParams.favorites])}
      source={queueQ.data} initialId={Number(mediaId)} behavior={settingsQ.data?.queueBehavior ?? 'auto'} shuffle={searchParams.sort === 'random'}
      refreshError={queueQ.error?.message} onRetry={() => void queueQ.refetch()}/>;
  }
  if (itemQ.isError) return <div className="watch-empty"><h1>Video unavailable</h1><p>{itemQ.error.message}</p><button onClick={() => void itemQ.refetch()}>Try again</button></div>;
  if (itemQ.isLoading || !itemQ.data) return <PageSkeleton kind="watch"/>;
  return <div className="watch-view"><Player item={itemQ.data} autoPlay/><div className="watch-copy"><h1>{itemQ.data.title}</h1><p>{itemQ.data.overview || itemQ.data.filename}</p></div></div>;
}

function QueuedWatch({ source, initialId, behavior, shuffle, refreshError, onRetry }: { source: MediaItem[]; initialId: number; behavior: QueueBehavior; shuffle: boolean; refreshError?: string; onRetry: () => void }) {
  const { queue, items, activeIndex, update, select } = usePlaybackQueue(source, initialId, shuffle);
  const layout = useQueueLayout(state => state.layout);
  const [repeatOverride, setRepeatOverride] = useState<RepeatMode | null>(null);
  const repeat = repeatOverride ?? (behavior === 'loop' ? 'queue' : 'off');
  const current = items[activeIndex];
  if (!current) return <div className="watch-empty"><h1>No videos in this queue</h1><p>The current filter matches no available videos.</p></div>;
  const wraps = repeat === 'queue';
  const advance = (direction: 1 | -1, ended = false) => {
    const next = queueDestination(activeIndex, items.length, direction, repeat, ended, behavior !== 'manual');
    if (next !== null) select(next);
  };
  return <div className="watch-view has-queue" data-queue-layout={layout}>
    <div className="watch-main">
      <Player item={current} queue={items} queueIndex={activeIndex} onEnded={() => advance(1, true)}
        onNext={() => advance(1)} onPrev={() => advance(-1)}
        canGoNext={items.length > 1 && (activeIndex < items.length - 1 || wraps)} canGoPrev={items.length > 1 && (activeIndex > 0 || wraps)}
        repeatMode={repeat} onRepeatChange={setRepeatOverride} autoPlay/>
      <div className="watch-copy"><h1>{current.title}</h1><p className="watch-description">{current.overview || current.filename}</p>
        {refreshError && <p className="error-copy" role="alert">Could not refresh the queue. {refreshError} <button type="button" onClick={onRetry}>Try again</button></p>}
      </div>
    </div>
    <PlaybackQueue items={items} activeIndex={activeIndex} repeatMode={repeat} onRepeatChange={setRepeatOverride}
      onSelect={select} state={queue} onEdit={update}/>
  </div>;
}
