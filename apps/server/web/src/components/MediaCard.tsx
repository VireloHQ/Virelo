import { t, useLocale } from '../i18n';
import { Link, useNavigate } from '@tanstack/react-router';
import { useFavorite } from '../hooks/useFavorite';
import { Play } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { artwork } from '../api';
import type { MediaItem } from '../types';
import { HoverPreview } from '@virelo/web-ui/components/HoverPreview.tsx';
import { usePreviewEnabled } from '@virelo/web-ui/hooks/usePreviewEnabled.ts';
import { MediaContextMenu } from '@virelo/web-ui/components/MediaContextMenu.tsx';

const HOVER_CAPABLE = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;

export interface MediaCardProps { item:MediaItem;layout?:'auto'|'landscape'|'poster';compact?:boolean;short?:boolean;playDirect?:boolean;preview?:boolean;onHoverChange?:(hovered:boolean)=>void;resumeSession?:{key:string;label:string}; }

export function MediaCard({item, compact=false, short=false, playDirect=false, preview=false, onHoverChange, layout='auto', resumeSession}:MediaCardProps) {
  useLocale();
  const showPreview = usePreviewEnabled() && preview;
  const navigate = useNavigate();
  const { favorite, error: favoriteError, toggle: toggleFavorite } = useFavorite(item);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const [menuPosition, setMenuPosition] = useState<{x:number;y:number}|null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  useEffect(() => () => {
    if (longPressTimer.current !== null) window.clearTimeout(longPressTimer.current);
  }, []);
  const progressDuration = item.progress_duration || item.duration || 0;
  const progress = progressDuration > 0 ? Math.min(100, ((item.progress_position || 0) / progressDuration) * 100) : 0;
  const isPortrait = Boolean(item.width && item.height && item.height > item.width);
  const hasPoster = Boolean(item.poster_path && (item.kind === 'movie' || (item.kind === 'series' && item.episode === null)));
  const isPoster = !short && !playDirect && (layout === 'poster' || (layout === 'auto' && hasPoster));
  const imageKinds: Array<'poster' | 'backdrop' | 'thumbnail'> = isPoster ? ['poster', 'backdrop', 'thumbnail'] : ['backdrop', 'thumbnail', 'poster'];
  const imageSources = [...new Set(imageKinds.filter((kind) => kind === 'thumbnail' || Boolean(kind === 'poster' ? item.poster_path : item.backdrop_path)).map((kind) => artwork(item, kind)))];
  const details = [item.kind === 'series' && item.season !== null && item.episode !== null ? `S${item.season} E${item.episode}` : item.year, item.duration ? t('{count} min',{count:Math.max(1,Math.round(item.duration/60))}) : null].filter(Boolean).join(' · ');
  const destination = short ? '/shorts' : playDirect ? '/watch/$mediaId' : '/title/$mediaId';
  const progressLabel = playDirect && (item.progress_position || 0) > 10 ? t('Resume {value0}',{value0:formatTime(item.progress_position||0)}) : null;
  const previewStart = (item.progress_position || 0) > 5 ? item.progress_position! : 0;
  const openMenu = (x:number, y:number) => setMenuPosition({x, y});
  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const handlePointerDown = (event:PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    clearLongPress();
    longPressTriggered.current = false;
    longPressTimer.current = window.setTimeout(() => {
      longPressTriggered.current = true;
      openMenu(event.clientX, event.clientY);
    }, 520);
  };
  const handleClick = (event:MouseEvent<HTMLAnchorElement>) => {
    if (!longPressTriggered.current) return;
    event.preventDefault();
    event.stopPropagation();
    longPressTriggered.current = false;
  };
  const goToPlayback = () => {
    if (short) void navigate({to:'/shorts',search:{startId:item.id}});
    else void navigate({to:'/watch/$mediaId',params:{mediaId:String(item.id)},search:playDirect && resumeSession ? {resumeSession:resumeSession.key} : undefined});
  };
  const goToDetails = () => void navigate({to:'/title/$mediaId',params:{mediaId:String(item.id)}});
  return (
    <div className={`media-card ${isPoster?'art-poster':''} ${compact?'compact':''} ${playDirect?'resume-card ':''}${short?`shorts-card ${isPortrait?'art-portrait':'art-landscape'}`:''}${showPreview?' previewing':''}`}
      onMouseEnter={HOVER_CAPABLE && onHoverChange ? ()=>onHoverChange(true) : undefined}
      onMouseLeave={HOVER_CAPABLE && onHoverChange ? event=>{
        if(event.currentTarget.querySelector('.hover-preview')?.contains(document.activeElement))cardRef.current?.focus({preventScroll:true});
        onHoverChange(false);
      } : undefined}
      onFocus={onHoverChange ? event=>{if(!event.currentTarget.contains(event.relatedTarget))onHoverChange(true);} : undefined}
      onBlur={onHoverChange ? event=>{if(!event.currentTarget.contains(event.relatedTarget)&&!event.currentTarget.matches(':hover'))onHoverChange(false);} : undefined}
      onContextMenu={(event) => { event.preventDefault(); openMenu(event.clientX, event.clientY); }}
      onPointerDown={handlePointerDown}
      onPointerMove={clearLongPress}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}>
      <Link ref={cardRef} to={destination} params={short ? undefined : {mediaId:String(item.id)}} search={short ? {startId:item.id} : playDirect && resumeSession ? {resumeSession:resumeSession.key} : undefined} aria-label={progressLabel ? `${progressLabel}: ${item.title}${resumeSession ? ` · ${resumeSession.label}` : ''}` : undefined} className="media-card-copy media-card-link" preload="intent" onClick={handleClick}>
        <strong title={item.title}>{item.title}</strong>
        {(progressLabel || details || resumeSession) && <span title={resumeSession?.label}>{[progressLabel || details, resumeSession?.label].filter(Boolean).join(' · ')}</span>}
      </Link>
      <div className="media-card-art">
        <img key={imageSources.join('|')} src={imageSources[0]} alt="" loading="lazy" decoding="async" onLoad={(e)=>{const image=e.currentTarget;if(image.naturalWidth>1||image.naturalHeight>1) image.dataset.loaded='true';}} onError={(e)=>{const image=e.currentTarget;delete image.dataset.loaded;const next=Number(image.dataset.fallbackIndex || 0)+1;if(next<imageSources.length){image.dataset.fallbackIndex=String(next);image.src=imageSources[next];}else image.style.display='none';}}/>
        <div className="media-card-fallback"><Play weight="fill"/></div>
        <div className="media-card-play"><span><Play weight="fill"/></span></div>
        {showPreview && <HoverPreview src={`/api/media/${item.id}/stream`} start={previewStart} />}
        {progress > 0 && <div className="card-progress"><i style={{width:`${progress}%`}}/></div>}
      </div>
      {favoriteError && <span className="error-copy" role="alert">{t(favoriteError)}</span>}
      {menuPosition && <MediaContextMenu
        item={{...item, liked: favorite ? 1 : 0}}
        position={menuPosition}
        returnFocus={cardRef.current}
        favorite={favorite}
        onFavorite={() => void toggleFavorite()}
        onPlay={goToPlayback}
        onDetails={goToDetails}
        onClose={() => setMenuPosition(null)}
      />}
    </div>
  );
}

function formatTime(value:number) {
  const minutes = Math.floor(value / 60);
  const seconds = Math.floor(value % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}
