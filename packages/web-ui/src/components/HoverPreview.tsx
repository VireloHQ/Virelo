import { useEffect, useRef, useState } from 'react';
import { SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { createHoverPreview } from '../utils/hover-preview';
import './HoverPreview.css';

export function HoverPreview({ src, start }: { src: string; start: number }) {
  useLocale();
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<ReturnType<typeof createHoverPreview> | null>(null);
  const [state, setState] = useState({ muted: true, playing: false, progress: 0 });
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
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
    {state.playing && <div className="preview-progress"><i style={{ width: `${state.progress * 100}%` }} /></div>}
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
