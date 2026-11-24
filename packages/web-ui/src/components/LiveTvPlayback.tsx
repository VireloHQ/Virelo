/// <reference path="../hls-light.d.ts" />
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowsOut, Pause, PictureInPicture, Play, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { LoadingSpinner } from './LoadingSpinner';
import { PlayerActionMenu } from './PlayerActionMenu';
import { PlayerControls } from './PlayerControls';
import { usePlaybackVolume } from '../hooks/usePlaybackVolume';
import { usePlayerControlsVisibility } from '../hooks/usePlayerControlsVisibility';
import { toggleFullscreen } from '../utils/fullscreen';
import type { LiveTvService } from './LiveTv';
import '../player-ui.css';

export function LiveTvPlayback({title, service, source, channel}: {title:string; service:LiveTvService; source:string; channel:number}) {
  useLocale();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { controlsVisible, revealControls, scheduleControlsHide } = usePlayerControlsVisibility(videoRef,containerRef);
  const { volume, muted, setVolume, setMuted } = usePlaybackVolume();
  const [attempt,setAttempt] = useState(0), [failure,setFailure] = useState('');
  const [opening,setOpening] = useState(true), [paused,setPaused] = useState(true);
  const [pip,setPip] = useState(false);
  const [menu,setMenu] = useState<{x:number;y:number;keyboard?:boolean}|null>(null);
  const pipSupported = Boolean(document.pictureInPictureEnabled && HTMLVideoElement.prototype.requestPictureInPicture);
  useLayoutEffect(() => {
    const video = videoRef.current;
    if (video) { video.volume = volume; video.muted = muted; }
  },[volume,muted]);

  useEffect(() => {
    const video = videoRef.current!;
    let disposed = false, release: (() => void)|undefined, hls: import('hls.js').default|undefined;
    const ready = () => { if (!disposed) { setOpening(false); void video.play().catch(() => {}); } };
    const fail = (message = 'Could not play this HLS stream.') => {
      if (disposed) return;
      hls?.destroy(); hls = undefined;
      release?.(); release = undefined;
      setOpening(false); setFailure(message);
    };
    const onError = () => fail();
    const enterPip = () => setPip(true), leavePip = () => setPip(false);
    video.addEventListener('loadedmetadata',ready,{once:true});
    video.addEventListener('error',onError);
    video.addEventListener('enterpictureinpicture',enterPip);
    video.addEventListener('leavepictureinpicture',leavePip);
    void (async () => {
      const stream = await service.play(source,channel);
      if (disposed) { stream.release?.(); return; }
      release = stream.release;
      if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = stream.url;
      else {
        const { default:Hls } = await import('hls.js/light');
        if (disposed) return;
        if (!Hls.isSupported()) { fail('HLS playback is not available in this browser.'); return; }
        const player = new Hls({lowLatencyMode:false,maxBufferLength:20});
        hls = player;
        player.on(Hls.Events.ERROR,(_event,data) => { if (data.fatal) fail(); });
        player.loadSource(stream.url);
        player.attachMedia(video);
      }
    })().catch(error => fail(error instanceof Error?error.message:undefined));
    return () => {
      disposed = true; hls?.destroy(); release?.();
      video.removeEventListener('loadedmetadata',ready);
      video.removeEventListener('error',onError);
      video.removeEventListener('enterpictureinpicture',enterPip);
      video.removeEventListener('leavepictureinpicture',leavePip);
      video.pause(); video.removeAttribute('src'); video.load();
    };
  },[service,source,channel,attempt]);

  const toggle = () => {
    const video = videoRef.current;
    if (!video || opening || failure) return;
    if (video.paused) void video.play().catch(() => {});
    else video.pause();
  };
  const mute = () => setMuted(value => !value);
  const fullscreen = () => { if (containerRef.current && videoRef.current) void toggleFullscreen(containerRef.current,videoRef.current); };
  const togglePip = () => {
    if (!pipSupported) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void videoRef.current?.requestPictureInPicture().catch(() => {});
  };
  return <div className={`player live-tv-player${controlsVisible?' controls-visible':''}`} ref={containerRef} tabIndex={0} aria-label={t("{value0} player",{value0:title})}
    onPointerMove={event => { if (event.pointerType === 'mouse') { revealControls(); scheduleControlsHide(); } }}
    onPointerLeave={() => scheduleControlsHide(300)} onFocusCapture={revealControls} onBlurCapture={() => scheduleControlsHide(300)}
    onDoubleClick={fullscreen}
    onContextMenu={event => { event.preventDefault(); if (!opening && !failure) { revealControls(); setMenu({x:event.clientX,y:event.clientY}); } }}
    onKeyDown={event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === ' ' || event.key === 'k') { event.preventDefault(); toggle(); }
      if (!opening && !failure && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        setMenu({x:bounds.left+24,y:bounds.top+24,keyboard:true});
      }
    }}>
    <video className="video-presentation" ref={videoRef} aria-label={title} playsInline crossOrigin="anonymous"
      onClick={() => { if (controlsVisible) toggle(); else { revealControls(); scheduleControlsHide(); } }}
      onPlay={() => { setPaused(false); revealControls(); scheduleControlsHide(); }}
      onPause={() => { setPaused(true); revealControls(); }}/>
    {opening && <div className="player-status" role="status"><LoadingSpinner/><strong>{t("Opening video…")}</strong></div>}
    {failure ? <div className="player-status error" role="alert"><strong>{t("Playback unavailable")}</strong><span>{t(failure)}</span>
      <Button variant="secondary" onPress={() => { containerRef.current?.focus(); setFailure(''); setPaused(true); setOpening(true); setAttempt(value => value+1); }}>{t("Try again")}</Button>
    </div> : !opening && <PlayerControls live paused={paused} busy={false} volume={volume} muted={muted} pip={pip} pipSupported={pipSupported}
      onToggle={toggle} onVolume={value => { setMuted(false); setVolume(value); }} onMute={mute} onFullscreen={fullscreen} onPip={togglePip}/>}
    {menu && <PlayerActionMenu label={t("Video actions")} position={menu} returnFocus={containerRef.current} onClose={() => setMenu(null)}
      actions={[
        {label:paused?'Play':'Pause',icon:paused?<Play/>:<Pause/>,action:toggle},
        {label:muted?'Unmute':'Mute',icon:muted?<SpeakerSlash/>:<SpeakerHigh/>,action:mute},
        ...(pipSupported?[{label:pip?'Exit Picture in Picture':'Picture in Picture',icon:<PictureInPicture/>,action:togglePip}]:[]),
        {label:t("Fullscreen"),icon:<ArrowsOut/>,action:fullscreen}
      ]}/>}
  </div>;
}
