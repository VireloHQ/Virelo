import { useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { ArrowsOut, Pause, PictureInPicture, Play, Shuffle, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { RepeatControl } from './RepeatControl';
import type { RepeatMode } from '../utils/playback-repeat';
import '../player-transport.css';

interface PlayerControlsProps {
  current: number; duration: number; paused: boolean; busy: boolean;
  volume: number; muted: boolean; pip: boolean; pipSupported: boolean;
  canGoPrev: boolean; canGoNext: boolean; hasQueue: boolean; queuePosition?: string;
  shuffled?: boolean; onShuffle?: () => void;
  repeat: RepeatMode; onRepeat: (mode: RepeatMode) => void;
  onToggle: () => void; onSeek: (position: number) => void; onSeekBy: (seconds: number) => void;
  onPrev?: () => void; onNext?: () => void; onVolume: (value: number) => void; onMute: () => void;
  onFullscreen: () => void; onPip: () => void; favorite: ReactNode; settings: ReactNode;
}

export function PlayerControls(props: PlayerControlsProps) {
  const { current, duration, paused, busy, repeat, onRepeat, hasQueue } = props;
  const progress = duration > 0 ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
  return <div className="player-controls" onDoubleClick={event => event.stopPropagation()}>
    <div className="player-timeline">
      <span className="player-time" aria-label="Elapsed time">{playerTime(current)}</span>
      <input className="player-seek" style={{ '--range-fill': progress + '%' } as CSSProperties} aria-label="Seek"
        aria-valuetext={playerTime(current) + ' of ' + playerTime(duration)} type="range" min={0} max={Math.max(duration, 1)} step={.1}
        disabled={duration <= 0} value={Math.max(0, Math.min(current, Math.max(duration, 1)))} onChange={event => props.onSeek(Number(event.currentTarget.value))}
        onKeyDown={event => {
          const value = Number(event.currentTarget.value), step = event.shiftKey ? 30 : 5;
          const target = event.key === 'ArrowLeft' ? value - step : event.key === 'ArrowRight' ? value + step
            : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null;
          if (target !== null) { event.preventDefault(); props.onSeek(Math.max(0, Math.min(duration, target))); }
        }}/>
      <span className="player-time player-time-remaining" aria-label="Remaining time" title="Remaining time">{playerTime(Math.max(0, duration - current))}</span>
    </div>
    <div className="player-toolbar">
      <div className="player-queue-position">{props.queuePosition && <small className="player-queue">{props.queuePosition}</small>}</div>
      <div className="player-transport" role="group" aria-label="Playback controls">
        <button type="button" aria-label="Shuffle queue" aria-pressed={Boolean(props.shuffled)} disabled={!props.onShuffle || !hasQueue} onClick={props.onShuffle}><Shuffle/></button>
        <button type="button" className="queue-previous" aria-label="Previous video" disabled={!props.onPrev || !props.canGoPrev} onClick={props.onPrev}><SkipBack weight="fill"/></button>
        <button type="button" className="skip-button" aria-label="Rewind 10 seconds" onClick={() => props.onSeekBy(-10)}><SeekIcon seconds={10}/></button>
        <button type="button" className="player-play-button" aria-label={paused ? 'Play' : 'Pause'} aria-busy={busy} onClick={props.onToggle}>{paused ? <Play weight="fill"/> : <Pause weight="fill"/>}</button>
        <button type="button" className="skip-button" aria-label="Fast-forward 30 seconds" onClick={() => props.onSeekBy(30)}><SeekIcon seconds={30} forward/></button>
        <button type="button" className="queue-next" aria-label="Next video" disabled={!props.onNext || !props.canGoNext} onClick={props.onNext}><SkipForward weight="fill"/></button>
        <RepeatControl mode={repeat} hasQueue={hasQueue} onChange={onRepeat}/>
      </div>
      <div className="player-tools">
        {props.favorite}
        <PlayerVolume volume={props.volume} muted={props.muted} onVolume={props.onVolume} onMute={props.onMute}/>
        <button type="button" aria-label="Fullscreen" onClick={props.onFullscreen}><ArrowsOut/></button>
        {props.pipSupported && <button type="button" aria-label={props.pip ? 'Exit Picture in Picture' : 'Picture in Picture'} aria-pressed={props.pip} onClick={props.onPip}><PictureInPicture/></button>}
        {props.settings}
      </div>
    </div>
  </div>;
}

function SeekIcon({ seconds, forward = false }: { seconds: number; forward?: boolean }) {
  return <svg className="player-seek-icon" viewBox="0 0 28 28" aria-hidden="true">
    <path d="M6 14a8 8 0 1 1 16 0M2 10l4 4 4-4" transform={forward?'translate(28 0) scale(-1 1)':undefined} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    <text x="14" y="23" textAnchor="middle" fill="currentColor">{seconds}</text>
  </svg>;
}

function PlayerVolume({ volume, muted, onVolume, onMute }: { volume: number; muted: boolean; onVolume: (value: number) => void; onMute: () => void }) {
  const [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  const value = muted ? 0 : volume;
  return <div className="player-volume"><Popover isOpen={open} onOpenChange={setOpen}>
    <Button isIconOnly variant="ghost" className="player-volume-trigger" aria-label="Volume"
      onPressStart={event => setAnimate(event.pointerType !== 'keyboard')}>{muted || volume === 0 ? <SpeakerSlash/> : <SpeakerHigh/>}</Button>
    <Popover.Content className="player-volume-popover" placement="top" offset={12} containerPadding={8} isNonModal data-animate={animate}
      UNSTABLE_portalContainer={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body}>
      <Popover.Dialog aria-label="Volume"><div className="player-volume-dialog"
        onKeyDownCapture={event => { if (event.key === 'Escape') setAnimate(false); }}>
        <button type="button" onClick={onMute} aria-label={muted ? 'Unmute' : 'Mute'} aria-pressed={muted}>{muted || volume === 0 ? <SpeakerSlash/> : <SpeakerHigh/>}</button>
        <input className="volume-slider" style={{ '--range-fill': value * 100 + '%' } as CSSProperties} aria-label="Volume" aria-valuetext={Math.round(value * 100) + '%'}
          type="range" min={0} max={1} step={.01} value={value} onChange={event => onVolume(Number(event.currentTarget.value))}/>
        <output aria-label="Volume level">{Math.round(value * 100)}</output>
      </div></Popover.Dialog>
    </Popover.Content>
  </Popover></div>;
}

export function playerTime(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0, seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
