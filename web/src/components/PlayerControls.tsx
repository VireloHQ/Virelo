import { t, useLocale } from '../i18n';
import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { ArrowsOut, Pause, PictureInPicture, Play, Shuffle, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { RepeatControl } from './RepeatControl';
import { useAppearance } from './AppearanceProvider';
import type { RepeatMode } from '../utils/playback-repeat';
import replay10 from '../assets/icons/replay-10.svg';
import forward30 from '../assets/icons/forward-30.svg';
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
  useLocale();
  const { current, duration, paused, busy, repeat, onRepeat, hasQueue } = props;
  const style = useAppearance().value.controllerStyle;
  const controls: Record<string, ReactNode> = {
    shuffle: <button type="button" aria-label={t("Shuffle queue")} aria-pressed={Boolean(props.shuffled)} disabled={!props.onShuffle || !hasQueue} onClick={props.onShuffle}><Shuffle/></button>,
    previous: <button type="button" className="queue-previous" aria-label={t("Previous video")} disabled={!props.onPrev || !props.canGoPrev} onClick={props.onPrev}><SkipBack weight="fill"/></button>,
    rewind: <button type="button" className="skip-button" aria-label={t("Rewind 10 seconds")} onClick={() => props.onSeekBy(-10)}><span className="player-seek-icon" style={{maskImage:`url("${replay10}")`}} aria-hidden="true"/></button>,
    play: <button type="button" className="player-play-button" aria-label={paused ? t("Play") : t("Pause")} aria-busy={busy} onClick={props.onToggle}>{paused ? <Play weight="fill"/> : <Pause weight="fill"/>}</button>,
    forward: <button type="button" className="skip-button" aria-label={t("Fast-forward 30 seconds")} onClick={() => props.onSeekBy(30)}><span className="player-seek-icon" style={{maskImage:`url("${forward30}")`}} aria-hidden="true"/></button>,
    next: <button type="button" className="queue-next" aria-label={t("Next video")} disabled={!props.onNext || !props.canGoNext} onClick={props.onNext}><SkipForward weight="fill"/></button>,
    repeat: <RepeatControl mode={repeat} hasQueue={hasQueue} onChange={onRepeat}/>
  };
  const order = style === 'streamline' || style === 'theater'
    ? ['play','rewind','forward','previous','next','shuffle','repeat']
    : ['shuffle','previous','rewind','play','forward','next','repeat'];
  const progress = duration > 0 ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
  return <div className="player-controls" data-controller-style={style} onDoubleClick={event => event.stopPropagation()}>
    <div className="player-timeline">
      <span className="player-time" aria-label={t("Elapsed time")}>{playerTime(current)}</span>
      <input className="player-seek" style={{ '--range-fill': progress + '%' } as CSSProperties} aria-label={t("Seek")}
        aria-valuetext={t('{value0} of {value1}',{value0:playerTime(current),value1:playerTime(duration)})} type="range" min={0} max={Math.max(duration, 1)} step={.1}
        disabled={duration <= 0} value={Math.max(0, Math.min(current, Math.max(duration, 1)))} onChange={event => props.onSeek(Number(event.currentTarget.value))}
        onKeyDown={event => {
          const value = Number(event.currentTarget.value), step = event.shiftKey ? 30 : 5;
          const target = event.key === 'ArrowLeft' ? value - step : event.key === 'ArrowRight' ? value + step
            : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null;
          if (target !== null) { event.preventDefault(); props.onSeek(Math.max(0, Math.min(duration, target))); }
        }}/>
      <span className="player-time player-time-remaining" aria-label={t("Remaining time")} title={t("Remaining time")}>{playerTime(Math.max(0, duration - current))}</span>
    </div>
    <div className="player-toolbar">
      <div className="player-queue-position">{props.queuePosition && <small className="player-queue">{props.queuePosition}</small>}</div>
      <div className="player-transport" role="group" aria-label={t("Playback controls")}>
        {order.map(key => <Fragment key={key}>{controls[key]}</Fragment>)}
      </div>
      <div className="player-tools">
        {props.favorite}
        <PlayerVolume volume={props.volume} muted={props.muted} onVolume={props.onVolume} onMute={props.onMute}/>
        <button type="button" aria-label={t("Fullscreen")} onClick={props.onFullscreen}><ArrowsOut/></button>
        {props.pipSupported && <button type="button" aria-label={props.pip ? t("Exit Picture in Picture") : t("Picture in Picture")} aria-pressed={props.pip} onClick={props.onPip}><PictureInPicture/></button>}
        {props.settings}
      </div>
    </div>
  </div>;
}

function PlayerVolume({ volume, muted, onVolume, onMute }: { volume: number; muted: boolean; onVolume: (value: number) => void; onMute: () => void }) {
  useLocale();
  const [open, setOpen] = useState(false), [animate, setAnimate] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const value = muted ? 0 : volume;
  return <div className="player-volume"><Popover isOpen={open} onOpenChange={setOpen}>
    <Button ref={triggerRef} isIconOnly variant="ghost" className="player-volume-trigger" aria-label={t("Volume")}
      onPressStart={event => setAnimate(event.pointerType !== 'keyboard')}>{muted || volume === 0 ? <SpeakerSlash/> : <SpeakerHigh/>}</Button>
    <Popover.Content className="player-volume-popover" placement="top" offset={12} containerPadding={8} isNonModal data-animate={animate}
      shouldCloseOnInteractOutside={target => !triggerRef.current?.contains(target)}
      UNSTABLE_portalContainer={document.fullscreenElement instanceof HTMLElement ? document.fullscreenElement : document.body}>
      <Popover.Dialog aria-label={t("Volume")}><div className="player-volume-dialog"
        onKeyDownCapture={event => { if (event.key === 'Escape') setAnimate(false); }}>
        <button type="button" onClick={onMute} aria-label={muted ? t("Unmute") : t("Mute")} aria-pressed={muted}>{muted || volume === 0 ? <SpeakerSlash/> : <SpeakerHigh/>}</button>
        <input className="volume-slider" style={{ '--range-fill': value * 100 + '%' } as CSSProperties} aria-label={t("Volume")} aria-valuetext={Math.round(value * 100) + '%'}
          type="range" min={0} max={1} step={.01} value={value} onChange={event => onVolume(Number(event.currentTarget.value))}/>
        <output aria-label={t("Volume level")}>{Math.round(value * 100)}</output>
      </div></Popover.Dialog>
    </Popover.Content>
  </Popover></div>;
}

export function playerTime(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0, seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
