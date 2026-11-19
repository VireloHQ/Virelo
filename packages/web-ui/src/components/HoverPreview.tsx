import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { createHoverPreview } from '../utils/hover-preview';
import { usePlaybackVolume } from '../hooks/usePlaybackVolume';
import { useVolumeLeveling } from '../hooks/useVolumeLeveling';
import type { AudioLoudness } from '../utils/volume-leveling';
import './HoverPreview.css';

export function HoverPreview({ src, start, measurement }: { src: string; start: number; measurement?: AudioLoudness | null }) {
  useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<ReturnType<typeof createHoverPreview> | null>(null);
  const [state, setState] = useState({ muted: true, playing: false, progress: 0, duration: 0 });
  const [stopped, setStopped] = useState(false);

  // Restore focus and unload before a settings change removes the controls.
  useLayoutEffect(() => {
    const root = rootRef.current, video = videoRef.current;
    if (!root || !video || !src || stopped) return;
    const returnFocus = () => {
      if (root.contains(document.activeElement)) {
        root.closest('.media-card')?.querySelector<HTMLAnchorElement>('.media-card-link')?.focus({ preventScroll: true });
      }
    };
    // Set the source here too: StrictMode's cleanup deliberately unloads the element.
    video.src = src;
    const controller = createHoverPreview(video, start, {
      onState: setState,
      onStop: () => { returnFocus(); setStopped(true); }
    });
    controllerRef.current = controller;
    const hide = () => { if (document.hidden) controller.stop(); };
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) controller.stop();
    });
    observer.observe(root);
    document.addEventListener('visibilitychange', hide);
    window.addEventListener('pagehide', controller.stop);
    hide();
    return () => {
      returnFocus();
      observer.disconnect();
      document.removeEventListener('visibilitychange', hide);
      window.removeEventListener('pagehide', controller.stop);
      controllerRef.current = null;
      controller.dispose();
    };
  }, [src, start, stopped]);

  if (stopped) return null;
  const label = state.muted ? t('Unmute preview') : t('Mute preview');
  return <div className="preview-player hover-preview" ref={rootRef}>
    <video ref={videoRef} muted playsInline preload="auto" aria-hidden="true"
      style={{ visibility: state.playing ? 'visible' : 'hidden' }} />
    {/* Attach the video ref before the audio owner's layout effects run. */}
    <PreviewAudio videoRef={videoRef} muted={state.muted} measurement={measurement} />
    <input type="range" className="preview-seek" aria-label={t('Seek preview')}
      aria-valuetext={t('{value0} of {value1}', { value0: previewTime(state.progress * state.duration), value1: previewTime(state.duration) })}
      min={0} max={state.duration || 1} step={.1} value={state.progress * state.duration} disabled={!state.duration}
      style={{ '--preview-progress': `${state.progress * 100}%` } as CSSProperties}
      onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
      onClick={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onChange={event => controllerRef.current?.seek(Number(event.currentTarget.value))} />
    <button type="button" className="preview-audio-button" aria-label={label} title={label}
      disabled={!src}
      onPointerDown={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
      onKeyDown={event => event.stopPropagation()}
      onClick={event => { event.preventDefault(); event.stopPropagation(); controllerRef.current?.toggleMuted(); }}>
      {state.muted ? <SpeakerSlash aria-hidden="true" weight="fill" /> : <SpeakerHigh aria-hidden="true" weight="fill" />}
    </button>
  </div>;
}

function PreviewAudio({ videoRef, muted, measurement }: {
  videoRef: RefObject<HTMLVideoElement | null>; muted: boolean; measurement?: AudioLoudness | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const volume = usePlaybackVolume();
  // Keep preview mute independent; unmount this owner when the stopped preview removes its video.
  useVolumeLeveling(videoRef, audioRef, '', { ...volume, muted }, measurement);
  return null;
}

function previewTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
