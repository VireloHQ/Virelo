import type { CSSProperties, ReactNode } from 'react';
import { ArrowDown, PictureInPicture, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { FavoriteButton } from './FavoriteButton';
import { MediaContextMenu } from './MediaContextMenu';
import { useFavorite } from '../hooks/useFavorite';
import { api } from '../api';
import type { MediaItem } from '../types';

export interface ShortsPlaybackOptions {
  onNext: () => void;
  onDetails: () => void;
  pipOn: boolean;
  onPipChange: (on: boolean) => void;
}

export function ShortsPlayerControls({ item, current, duration, muted, pip, pipSupported, onSeek, onMute, onPip, onNext, children }: {
  item: MediaItem; current: number; duration: number; muted: boolean; pip: boolean; pipSupported: boolean;
  onSeek: (position: number) => void; onMute: () => void; onPip: () => void; onNext: () => void; children: ReactNode;
}) {
  function commitSeek(position: number) {
    if (duration > 0) void api.progress(item.id, Math.min(duration, Math.max(0, position)), duration);
  }
  return <div className="player-controls short-player-controls" onDoubleClick={event => event.stopPropagation()}>
    <input className="short-progress" type="range" min={0} max={Math.max(duration, 1)} step={0.1}
      value={Math.min(current, Math.max(duration, 1))} disabled={duration <= 0}
      style={{ '--progress': `${duration > 0 ? Math.min(100, current / duration * 100) : 0}%` } as CSSProperties}
      aria-label="Seek video" aria-valuetext={`${Math.round(current)} seconds`}
      onChange={event => onSeek(Number(event.currentTarget.value))}
      onKeyDown={event => {
        const step = event.shiftKey ? 30 : 5;
        const position = event.key === 'ArrowLeft' ? current - step : event.key === 'ArrowRight' ? current + step
          : event.key === 'Home' ? 0 : event.key === 'End' ? duration
          : event.key === 'PageUp' ? current + duration * 0.1 : event.key === 'PageDown' ? current - duration * 0.1 : null;
        if (position !== null) { event.preventDefault(); onSeek(Math.min(duration, Math.max(0, position))); }
      }}
      onPointerUp={event => commitSeek(Number(event.currentTarget.value))}
      onKeyUp={event => {
        if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) commitSeek(Number(event.currentTarget.value));
      }} />
    <div className="short-actions">
      <button type="button" onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>
        {muted ? <SpeakerSlash weight="fill" /> : <SpeakerHigh weight="fill" />}
        <span>{muted ? 'Unmute' : 'Mute'}</span>
      </button>
      <FavoriteButton item={item} short />
      {children}
      {pipSupported && <button type="button" onClick={onPip} aria-label={pip ? 'Exit Picture in Picture' : 'Picture in Picture'} aria-pressed={pip}>
        <PictureInPicture weight={pip ? 'fill' : 'regular'} /><span>PiP</span>
      </button>}
      <button type="button" onClick={onNext} aria-label="Next short"><ArrowDown weight="bold" /><span>Next</span></button>
    </div>
  </div>;
}

export function ShortsContextMenu({ item, position, returnFocus, onPlay, onDetails, onClose }: {
  item: MediaItem; position: { x: number; y: number }; returnFocus: HTMLElement | null;
  onPlay: () => void; onDetails: () => void; onClose: () => void;
}) {
  const { favorite, toggle } = useFavorite(item);
  return <MediaContextMenu item={{ ...item, liked: favorite ? 1 : 0 }} position={position}
    returnFocus={returnFocus} favorite={favorite} onFavorite={() => void toggle()}
    onPlay={onPlay} onDetails={onDetails} onClose={onClose} />;
}
