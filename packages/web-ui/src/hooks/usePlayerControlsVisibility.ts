import { useEffect, useRef, useState, type RefObject } from 'react';

export function usePlayerControlsVisibility(videoRef: RefObject<HTMLVideoElement|null>, containerRef: RefObject<HTMLDivElement|null>, shorts = false) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const timer = useRef<number|null>(null);
  function clearTimer() {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }
  function revealControls() {
    clearTimer();
    setControlsVisible(true);
  }
  function scheduleControlsHide(delay = 2400) {
    if (shorts) return;
    clearTimer();
    if (!videoRef.current || videoRef.current.paused) return;
    timer.current = window.setTimeout(() => {
      if (containerRef.current?.querySelector(':focus-visible,[aria-haspopup][aria-expanded="true"]') || document.querySelector('.player-action-menu')) {
        scheduleControlsHide();
        return;
      }
      setControlsVisible(false);
      timer.current = null;
    },delay);
  }
  useEffect(() => clearTimer, []);
  return {controlsVisible,revealControls,scheduleControlsHide};
}
