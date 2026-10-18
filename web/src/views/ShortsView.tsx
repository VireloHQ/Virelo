import { PageSkeleton } from '../components/PageSkeleton';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { ArrowDown, ArrowLeft, PictureInPicture, SpeakerHigh, SpeakerSlash, SpinnerGap } from '@phosphor-icons/react';
import { api } from '../api';
import { playVideo } from '../utils/media-playback';
import { useBackgroundPlayback } from '../hooks/useBackgroundPlayback';
import { usePlaybackVolume } from '../hooks/usePlaybackVolume';
import { useFavorite } from '../hooks/useFavorite';
import { FavoriteButton } from '../components/FavoriteButton';
import { MediaContextMenu } from '../components/MediaContextMenu';
import { useHlsFallback } from '../hooks/useHlsFallback';
import type { ShortItem } from '../types';

const PAGE_SIZE = 40;
const RENDER_WINDOW = 2;

export function ShortsView() {
  const { startId } = useSearch({ from: '/shorts' });
  return <ShortsFeedView key={startId ?? 'random'} startId={startId} />;
}

function ShortsFeedView({ startId }: { startId?: number }) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const scrollerHeight = useRef(0);
  activeIndexRef.current = activeIndex;
  const [pipOn, setPipOn] = useState(false);
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);

  const query = useInfiniteQuery({
    queryKey: ['shorts', seed, startId],
    queryFn: ({ pageParam }) => api.shorts({ limit: PAGE_SIZE, offset: pageParam, seed, startId }),
    initialPageParam: 0,
    gcTime: 0,
    getNextPageParam: (page, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < page.total ? loaded : undefined;
    }
  });

  const items: ShortItem[] = [];
  for (const page of query.data?.pages ?? []) items.push(...page.items);
  const activeItem = items[activeIndex];
  const total = query.data?.pages[0]?.total ?? 0;
  const hasNextPage = Boolean(query.hasNextPage);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientHeight < 1 || scrollerHeight.current !== el.clientHeight) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    setActiveIndex((prev) => (prev === index ? prev : index));
  }, []);

  const goTo = useCallback((index: number) => {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    el.scrollTo({ top: clamped * el.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [items.length]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const align = () => {
      scrollerHeight.current = el.clientHeight;
      el.scrollTo({ top: activeIndexRef.current * el.clientHeight, behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length > 0]);

  useEffect(() => {
    if (hasNextPage && items.length - activeIndex < 4) void query.fetchNextPage();
  }, [activeIndex, items.length, hasNextPage, query.fetchNextPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('input, textarea, select, button, [role="menu"], [role="dialog"]'))) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(activeIndex + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(activeIndex - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); goTo(items.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, activeIndex, items.length]);

  if (query.isError && items.length === 0) return <div className="shorts-empty"><p>Shorts could not be loaded.</p><button onClick={() => void query.refetch()}>Try again</button></div>;
  if (query.isLoading) return <PageSkeleton kind="shorts" />;
  if (startId !== undefined && query.data && items[0]?.id !== (query.data.pages[0]?.startId??startId)) {
    return <div className="shorts-empty"><p>This Short is no longer available in your Shorts feed.</p>
      <button onClick={() => history.back()}>Back</button></div>;
  }
  if (!query.isFetching && total === 0 && items.length === 0) {
    return (
      <div className="shorts-empty">
        <p>No vertical videos found. Portrait clips (height &gt; width) appear here as Shorts.</p>
        <button onClick={() => history.back()}>Back</button>
      </div>
    );
  }

  return (
    <div className="shorts-view">
      <button className="shorts-back" onClick={() => history.back()} aria-label="Back"><ArrowLeft /></button>
      <div className="shorts-scroller" ref={scrollerRef} onScroll={onScroll}>
        {items.map((item, i) => (
          <div className="short-slot" key={item.id}>
            {Math.abs(i - activeIndex) <= RENDER_WINDOW
              ? <div className="short-stage"><ShortsClip item={item} active={i === activeIndex} onSkip={() => goTo(i + 1)} pipOn={pipOn} onPip={setPipOn} /></div>
              : <div className="short-slot-placeholder" />}
          </div>
        ))}
      </div>
      {activeItem && (
        <div className="short-info" aria-live="polite">
          <h2>{activeItem.title}</h2>
          <p>{activeItem.filename}</p>
        </div>
      )}
    </div>
  );
}

function ShortsClip({ item, active, onSkip, pipOn, onPip }: { item: ShortItem; active: boolean; onSkip: () => void; pipOn: boolean; onPip: (on: boolean) => void }) {
  const navigate = useNavigate();
  const isLandscape = item.width !== null && item.height !== null && item.width > item.height;
  const videoRef = useRef<HTMLVideoElement>(null);
  const wantsPlayback = useRef(active);
  const activeRef = useRef(active);
  activeRef.current = active;
  const background=useBackgroundPlayback(item.id,videoRef,wantsPlayback,{
    active,
    resume:resumeBackground,
    play:()=>{wantsPlayback.current=true;resumeBackground();},
    pause:()=>{wantsPlayback.current=false;videoRef.current?.pause();}
  });
  function resumeBackground(){
    const video=videoRef.current;
    if(!video||!activeRef.current||!wantsPlayback.current)return;
    background.suspended.current=false;
    void playVideo(video,()=>activeRef.current&&wantsPlayback.current,()=>setMuted(true));
  }
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const { fallback, error, startFallback } = useHlsFallback(item, videoRef, wantsPlayback);
  const lastReport = useRef(0);
  const {volume,muted,setMuted} = usePlaybackVolume();
  const { favorite: liked, toggle: toggleFavorite } = useFavorite(item);
  const [pip, setPip] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(item.progress_position || 0);
  const [videoDuration, setVideoDuration] = useState(item.duration || 0);
  const [menuPosition, setMenuPosition] = useState<{x:number;y:number}|null>(null);

  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    setPipSupported(Boolean(video && document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function'));
    if (!video) return;
    const handleEnterPip = () => { setPip(true); onPip(true); };
    const handleLeavePip = () => { setPip(false); onPip(false); };
    video.addEventListener('enterpictureinpicture', handleEnterPip);
    video.addEventListener('leavepictureinpicture', handleLeavePip);
    return () => {
      video.removeEventListener('enterpictureinpicture', handleEnterPip);
      video.removeEventListener('leavepictureinpicture', handleLeavePip);
    };
  }, [onPip]);

  function requestPip(video: HTMLVideoElement, attempts = 0) {
    if (!activeRef.current || !video.isConnected) return;
    if (attempts > 3) { setPip(false); onPip(false); return; }
    const current = document.pictureInPictureElement;
    if (current === video) return;
    if (current) void document.exitPictureInPicture().catch(() => {});
    video.requestPictureInPicture()
      .then(() => { setPip(true); onPip(true); })
      .catch(() => { window.setTimeout(() => requestPip(video, attempts + 1), 300); });
  }

  function togglePip() {
    const video = videoRef.current;
    if (!video || !pipSupported || !active) return;
    if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
    else requestPip(video);
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    wantsPlayback.current = active;
    let cancelled = false;
    if (!active) {
      setMenuPosition(null);
      video.pause();
      if (document.pictureInPictureElement === video) void document.exitPictureInPicture().catch(() => {});
      return;
    }
    const duration = video.duration || item.duration || 0;
    const resume = item.progress_position || 0;
    setVideoDuration(duration);
    setCurrentTime(resume);
    if (resume > 5 && !item.progress_completed && (!duration || resume < duration * 0.92)) {
      try { video.currentTime = resume; } catch { /* retry after metadata */ }
    }
    setProgress(duration > 0 ? Math.min(100, (resume / duration) * 100) : 0);
    video.volume=volume;
    video.muted=muted;
    const followPip = () => { if (!cancelled && activeRef.current && pipOn && document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function') requestPip(video); };
    void playVideo(video, () => !cancelled && activeRef.current && wantsPlayback.current, () => setMuted(true)).then(followPip);
    return () => { cancelled = true; video.pause(); };
  }, [active, item.id]);

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    wantsPlayback.current = background.suspended.current ? !wantsPlayback.current : video.paused;
    if (wantsPlayback.current) void playVideo(video, () => activeRef.current && wantsPlayback.current, () => setMuted(true)); else video.pause();
  }

  function toggleMute() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setMuted(video.muted);
  }

  useEffect(()=>{
    const video=videoRef.current;
    if(video){video.volume=volume;video.muted=muted;}
  },[volume,muted]);

  function report(video: HTMLVideoElement) {
    const duration = video.duration || item.duration || 0;
    if (duration > 0) {
      setVideoDuration(duration);
      setCurrentTime(video.currentTime);
      setProgress(Math.min(100, (video.currentTime / duration) * 100));
    }
    if (Math.abs(video.currentTime - lastReport.current) > 5) {
      lastReport.current = video.currentTime;
      void api.progress(item.id, video.currentTime, video.duration);
    }
  }

  function seekTo(value: number) {
    const video = videoRef.current;
    const duration = videoDuration || video?.duration || item.duration || 0;
    if (!video || duration <= 0 || !Number.isFinite(value)) return;
    const next = Math.min(duration, Math.max(0, value));
    video.currentTime = next;
    setCurrentTime(next);
    setProgress((next / duration) * 100);
  }

  function commitSeek(value: number) {
    const video = videoRef.current;
    const duration = videoDuration || video?.duration || item.duration || 0;
    if (!video || duration <= 0 || !Number.isFinite(value)) return;
    void api.progress(item.id, Math.min(duration, Math.max(0, value)), duration);
  }

  function clearLongPress() {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== 'touch' || (event.target instanceof Element && event.target.closest('input, button, [role="menu"]'))) return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      setMenuPosition({x:event.clientX, y:event.clientY});
    }, 520);
  }

  return (
    <>
      <div
        className={`short-frame${isLandscape ? ' landscape' : ''}`}
        onContextMenu={(event) => { event.preventDefault(); setMenuPosition({x:event.clientX, y:event.clientY}); }}
        onPointerDown={handlePointerDown}
        onPointerMove={clearLongPress}
        onPointerUp={clearLongPress}
        onPointerCancel={clearLongPress}
      >
        <video
          ref={videoRef}
          className={`short-video${isLandscape ? ' landscape' : ''}`}
          src={`/api/media/${item.id}/stream`}
          preload={active ? 'auto' : 'metadata'}
          autoPlay={false}
          muted={muted}
          tabIndex={active ? 0 : -1}
          aria-label={`${item.title}. Press Space to play or pause.`}
          onKeyDown={(event) => { if (event.key === ' ' || event.key === 'k' || event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); togglePlay(); } }}
          playsInline
          onLoadedMetadata={(e) => {
            const nextDuration = Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : item.duration || 0;
            if (nextDuration > 0) setVideoDuration(nextDuration);
            if (e.currentTarget.paused) void playVideo(e.currentTarget, () => activeRef.current && wantsPlayback.current, () => setMuted(true));
          }}
          onClick={() => {
            if (longPressTriggered.current) {
              longPressTriggered.current = false;
              return;
            }
            togglePlay();
          }}
          onPause={(e) => {
            background.handlePause(e.currentTarget);
            void api.progress(item.id, e.currentTarget.currentTime, e.currentTarget.duration);
          }}
          onTimeUpdate={(e) => report(e.currentTarget)}
          onEnded={(e) => {
            setCurrentTime(0);
            setProgress(0);
            void api.progress(item.id, e.currentTarget.duration, e.currentTarget.duration);
            e.currentTarget.currentTime = 0;
            void playVideo(e.currentTarget, () => activeRef.current && wantsPlayback.current, () => setMuted(true));
          }}
          onError={() => { if (activeRef.current && fallback === 'idle') void startFallback(undefined, videoRef.current?.currentTime, wantsPlayback.current); }}
        />
        {fallback === 'starting' && active && wantsPlayback.current && videoRef.current?.paused && (
          <div className="short-status"><SpinnerGap className="spin" /><strong>Preparing video…</strong><span>This may take a moment.</span></div>
        )}
        {fallback === 'error' && (
          <div className="short-status error"><strong>Playback unavailable</strong><span>{error}</span></div>
        )}
        <input
          className="short-progress"
          type="range"
          min={0}
          max={Math.max(videoDuration, 1)}
          step={0.1}
          value={Math.min(currentTime, Math.max(videoDuration, 1))}
          style={{ '--progress': `${progress}%` } as CSSProperties}
          aria-label="Seek video"
          aria-valuetext={`${Math.round(currentTime)} seconds`}
          disabled={videoDuration <= 0}
          onInput={(e) => seekTo(Number(e.currentTarget.value))}
          onChange={(e) => seekTo(Number(e.currentTarget.value))}
          onKeyDown={(e) => {
            const duration = videoDuration || videoRef.current?.duration || item.duration || 0;
            const step = e.shiftKey ? 30 : 5;
            let next: number | null = null;
            if (e.key === 'ArrowLeft') next = currentTime - step;
            else if (e.key === 'ArrowRight') next = currentTime + step;
            else if (e.key === 'Home') next = 0;
            else if (e.key === 'End') next = duration;
            else if (e.key === 'PageUp') next = currentTime + duration * 0.1;
            else if (e.key === 'PageDown') next = currentTime - duration * 0.1;
            if (next !== null) {
              e.preventDefault();
              seekTo(next);
            }
          }}
          onPointerUp={(e) => commitSeek(Number(e.currentTarget.value))}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commitSeek(Number(e.currentTarget.value));
          }}
        />
      </div>
      {menuPosition && <MediaContextMenu
        item={{...item, liked: liked ? 1 : 0}}
        position={menuPosition}
        returnFocus={videoRef.current}
        favorite={liked}
        onFavorite={() => void toggleFavorite()}
        onPlay={() => { wantsPlayback.current = true; resumeBackground(); }}
        onDetails={() => void navigate({to:'/title/$mediaId',params:{mediaId:String(item.id)}})}
        onClose={() => setMenuPosition(null)}
      />}
      {active && <div className="short-actions">
        <button onClick={toggleMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
          {muted ? <SpeakerSlash weight="fill" /> : <SpeakerHigh weight="fill" />}
          <span>{muted ? 'Unmute' : 'Mute'}</span>
        </button>
        <FavoriteButton item={item} short />
        {pipSupported && <button className={pip ? 'on' : ''} onClick={togglePip} aria-label={pip ? 'Exit Picture in Picture' : 'Picture in Picture'}>
          <PictureInPicture weight={pip ? 'fill' : 'regular'} />
          <span>PiP</span>
        </button>}
        <button onClick={onSkip} aria-label="Next short">
          <ArrowDown weight="bold" />
          <span>Next</span>
        </button>
      </div>}
    </>
  );
}
