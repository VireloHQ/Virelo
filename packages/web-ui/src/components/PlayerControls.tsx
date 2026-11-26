import { t, useLocale } from '@edition/i18n';
import { Fragment, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Button, Popover } from '@heroui/react';
import { ArrowsOut, Pause, PictureInPicture, Play, Shuffle, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { RepeatControl } from './RepeatControl';
import { PlayerTimeline, type TimelineProps } from './PlayerTimeline';
import { useAppearance } from '@edition/components/AppearanceProvider';
import type { RepeatMode } from '@virelo/core/playback-repeat';
import replay10 from '../assets/icons/replay-10.svg';
import forward30 from '../assets/icons/forward-30.svg';
import '../player-transport.css';

interface TransportProps {
  paused: boolean; busy: boolean;
  volume: number; muted: boolean; pip: boolean; pipSupported: boolean;
  onToggle: () => void; onVolume: (value: number) => void; onMute: () => void;
  onFullscreen: () => void; onPip: () => void;
}
interface VideoControlsProps extends TimelineProps {
  live?: false;
  canGoPrev: boolean; canGoNext: boolean; hasQueue: boolean; queuePosition?: string;
  shuffled?: boolean; onShuffle?: () => void;
  repeat: RepeatMode; onRepeat: (mode: RepeatMode) => void;
  onSeekBy: (seconds: number) => void;
  onPrev?: () => void; onNext?: () => void;
  favorite: ReactNode; settings: ReactNode;
}
type PlayerControlsProps = TransportProps & (VideoControlsProps | { live: true; timeline: TimelineProps });

export function PlayerControls(props: PlayerControlsProps) {
  useLocale();
  const { paused, busy } = props;
  const style = useAppearance().value.controllerStyle;
  const timeline = props.live ? props.timeline : props;
  const play = <button type="button" className="player-play-button" aria-label={paused ? t("Play") : t("Pause")} aria-busy={busy} onClick={props.onToggle}>{paused ? <Play weight="fill"/> : <Pause weight="fill"/>}</button>;
  const controls: Record<string, ReactNode> = props.live ? {play} : {
    shuffle: <button type="button" aria-label={t("Shuffle queue")} aria-pressed={Boolean(props.shuffled)} disabled={!props.onShuffle || !props.hasQueue} onClick={props.onShuffle}><Shuffle/></button>,
    previous: <button type="button" className="queue-previous" aria-label={t("Previous video")} disabled={!props.onPrev || !props.canGoPrev} onClick={props.onPrev}><SkipBack weight="fill"/></button>,
    rewind: <button type="button" className="skip-button" aria-label={t("Rewind 10 seconds")} onClick={() => props.onSeekBy(-10)}><span className="player-seek-icon" style={{maskImage:`url("${replay10}")`}} aria-hidden="true"/></button>,
    play,
    forward: <button type="button" className="skip-button" aria-label={t("Fast-forward 30 seconds")} onClick={() => props.onSeekBy(30)}><span className="player-seek-icon" style={{maskImage:`url("${forward30}")`}} aria-hidden="true"/></button>,
    next: <button type="button" className="queue-next" aria-label={t("Next video")} disabled={!props.onNext || !props.canGoNext} onClick={props.onNext}><SkipForward weight="fill"/></button>,
    repeat: <RepeatControl mode={props.repeat} hasQueue={props.hasQueue} onChange={props.onRepeat}/>
  };
  const order = style === 'streamline' || style === 'theater'
    ? ['play','rewind','forward','previous','next','shuffle','repeat']
    : ['shuffle','previous','rewind','play','forward','next','repeat'];
  return <div className="player-controls" data-controller-style={style} data-live={props.live || undefined} onDoubleClick={event => event.stopPropagation()}>
    <PlayerTimeline current={timeline.current} duration={timeline.duration} rolling={timeline.rolling} atLiveEdge={timeline.atLiveEdge} onSeek={timeline.onSeek}/>
    <div className="player-toolbar">
      <div className="player-queue-position">{props.live ? !timeline.rolling && <small className="player-queue">{t("Live TV")}</small> : props.queuePosition && <small className="player-queue">{props.queuePosition}</small>}</div>
      <div className="player-transport" role="group" aria-label={t("Playback controls")}>
        {props.live ? play : order.map(key => <Fragment key={key}>{controls[key]}</Fragment>)}
      </div>
      <div className="player-tools">
        {!props.live && props.favorite}
        <PlayerVolume volume={props.volume} muted={props.muted} onVolume={props.onVolume} onMute={props.onMute}/>
        <button type="button" aria-label={t("Fullscreen")} onClick={props.onFullscreen}><ArrowsOut/></button>
        {props.pipSupported && <button type="button" aria-label={props.pip ? t("Exit Picture in Picture") : t("Picture in Picture")} aria-pressed={props.pip} onClick={props.onPip}><PictureInPicture/></button>}
        {!props.live && props.settings}
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
