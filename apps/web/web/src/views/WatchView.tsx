import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { FloppyDisk, ListPlus } from '@phosphor-icons/react';
import { api } from '../api';
import { PlaybackQueue } from '../components/PlaybackQueue';
import { SavePlaylist } from '../components/SavePlaylist';
import { Player } from '../components/Player';
import { WatchInfo, WatchRecommendations } from '../components/WatchInfo';
import { queueDestination, type RepeatMode } from '../utils/playback-repeat';
import { loadFavoriteQueue, loadMediaQueue } from '../utils/favorites';
import { toggleQueueShuffle } from '../utils/playback-queue';
import { usePlaybackQueue } from '../hooks/usePlaybackQueue';
import { useQueueLayout } from '../hooks/useQueueLayout';
import type { MediaItem, PlaylistDetail, QueueBehavior } from '../types';

export function WatchView() {
  useLocale();
  const { mediaId } = useParams({ from: '/app/watch/$mediaId' });
  const searchParams = useSearch({ from: '/app/watch/$mediaId' });
  const queueEnabled = Boolean(searchParams.queue || searchParams.playlistId);
  const playlistQ = useQuery({ queryKey: ['playlist', searchParams.playlistId], queryFn: () => api.playlist(searchParams.playlistId!), enabled: searchParams.playlistId !== undefined });
  const queueLayout = useQueueLayout(state => state.layout);
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const queueQ = useQuery({
    queryKey: ['watch-queue', searchParams],
    queryFn: () => (searchParams.favorites ? loadFavoriteQueue : loadMediaQueue)((offset, limit) => api.media({
      liked: searchParams.favorites ? 1 : undefined, search: searchParams.search, folder: searchParams.folder, recursive: searchParams.exactFolder?0:undefined,
      libraryId: searchParams.libraryId, sort: searchParams.sort === 'random' ? 'title' : searchParams.sort, offset, limit
    })),
    enabled: queueEnabled && searchParams.playlistId === undefined
  });
  const itemQ = useQuery({ queryKey: ['media', Number(mediaId)], queryFn: () => api.mediaById(Number(mediaId)), enabled: !queueEnabled });
  if (queueEnabled) {
    const source = searchParams.playlistId ? playlistQ.data?.items : queueQ.data;
    const error = searchParams.playlistId ? playlistQ.error : queueQ.error;
    const retry = () => { void (searchParams.playlistId ? playlistQ.refetch() : queueQ.refetch()); };
    if (error && !source) return <div className="watch-empty" role="alert"><h1>{t("Could not load queue")}</h1><p>{t(error.message)}</p><button onClick={retry}>{t("Try again")}</button></div>;
    if (!source) return <PageSkeleton kind="watch" queueLayout={queueLayout}/>;
    return <QueuedWatch key={JSON.stringify([mediaId, searchParams.search, searchParams.folder, searchParams.libraryId, searchParams.sort, searchParams.favorites, searchParams.playlistId])}
      source={source} initialId={Number(mediaId)} behavior={settingsQ.data?.queueBehavior ?? 'auto'} shuffle={searchParams.sort === 'random'}
      playlist={searchParams.playlistId ? playlistQ.data : undefined} refreshError={error?.message} onRetry={retry}/>;
  }
  if (itemQ.isError) return <div className="watch-empty"><h1>{t("Video unavailable")}</h1><p>{t(itemQ.error.message)}</p><button onClick={() => void itemQ.refetch()}>{t("Try again")}</button></div>;
  if (itemQ.isLoading || !itemQ.data) return <PageSkeleton kind="watch"/>;
  return <div className="watch-view"><Player item={itemQ.data} autoPlay/><WatchInfo item={itemQ.data} actions={<SavePlaylist mediaIds={[itemQ.data.id]}/>}/><WatchRecommendations item={itemQ.data}/></div>;
}

function QueuedWatch({ source, initialId, behavior, shuffle, playlist, refreshError, onRetry }: { source: MediaItem[]; initialId: number; behavior: QueueBehavior; shuffle: boolean; playlist?: PlaylistDetail; refreshError?: string; onRetry: () => void }) {
  useLocale();
  const { queue, items, activeIndex, update, select } = usePlaybackQueue(source, initialId, shuffle);
  const layout = useQueueLayout(state => state.layout);
  const [repeatOverride, setRepeatOverride] = useState<RepeatMode | null>(null);
  const [saveOpen, setSaveOpen] = useState<'pointer' | 'keyboard' | null>(null);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () => api.updatePlaylist(playlist!.id, { revision: playlist!.revision, mediaIds: items.map(item => item.id) }),
    onSuccess: saved => { client.setQueryData(['playlist', saved.id], saved); void client.invalidateQueries({ queryKey: ['playlists'] }); }
  });
  const dirty = playlist && (items.length !== playlist.items.length || items.some((item, index) => item.id !== playlist.items[index]?.id));
  const repeat = repeatOverride ?? (behavior === 'loop' ? 'queue' : 'off');
  const current = items[activeIndex];
  if (!current) return <div className="watch-empty"><h1>{playlist ? t("No available videos in this playlist") : t("No videos in this queue")}</h1><p>{playlist ? t("Restore library access or add more videos to continue.") : t("The current filter matches no available videos.")}</p>{playlist && <Link to="/app/playlists/$playlistId" params={{playlistId:String(playlist.id)}}>{t("Open playlist")}</Link>}</div>;
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
        repeatMode={repeat} onRepeatChange={setRepeatOverride} shuffled={queue.shuffled} onShuffle={()=>update(toggleQueueShuffle)} autoPlay/>
      <WatchInfo item={current} actions={<SavePlaylist mediaIds={[current.id]}/>}>
        {refreshError && <p className="error-copy" role="alert"><Trans message="Could not refresh the queue. {value0} {value1}" values={{value0:t(refreshError),value1:<button type="button" onClick={onRetry}>{t("Try again")}</button>}}/></p>}
      </WatchInfo>
    </div>
    <PlaybackQueue items={items} activeIndex={activeIndex} repeatMode={repeat} onRepeatChange={setRepeatOverride}
      onSelect={select} state={queue} onEdit={update}
      heading={playlist && <Link to="/app/playlists/$playlistId" params={{playlistId:String(playlist.id)}} title={playlist.name}>{playlist.name}</Link>}
      menuActions={[
        ...(playlist ? [{label:t("Save current order"),icon:<FloppyDisk/>,disabled:!dirty || save.isPending,action:()=>save.mutate()}] : []),
        {label:t("Save queue as playlist"),icon:<ListPlus/>,action:()=>setSaveOpen(document.activeElement?.matches(':focus-visible') ? 'keyboard' : 'pointer')}
      ]}
      feedback={<>
        {save.error && <p className="queue-save-error error-copy" role="alert">{t(save.error.message)}</p>}
        <span className="sr-only" role="status">{save.isPending ? t("Working…") : save.isSuccess && !dirty ? t("Saved") : ''}</span>
        {saveOpen && <SavePlaylist mediaIds={items.map(item=>item.id)} initialOpen={saveOpen} onClose={()=>setSaveOpen(null)}/>}
      </>}/>
    <WatchRecommendations item={current}/>
  </div>;
}
