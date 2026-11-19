const STORAGE_KEY = 'virelo-preview-muted:v1';
let sessionMuted: boolean | undefined;
let active: { stop: () => void } | undefined;

export function readPreviewMuted() {
  if (sessionMuted !== undefined) return sessionMuted;
  try { return sessionMuted = window.localStorage.getItem(STORAGE_KEY) !== 'false'; }
  catch { return sessionMuted = true; }
}

function savePreviewMuted(muted: boolean) {
  sessionMuted = muted;
  try { window.localStorage.setItem(STORAGE_KEY, String(muted)); }
  catch { /* Keep the explicit choice for this session if storage is blocked. */ }
}

export function createHoverPreview(video: HTMLVideoElement, start: number, callbacks: {
  onState: (state: { muted: boolean; playing: boolean; progress: number; duration: number }) => void;
  onStop: () => void;
}) {
  let disposed = false;
  let attempt = 0;
  const duration = () => Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
  const report = () => {
    if (!disposed) callbacks.onState({
      muted: video.muted || video.paused,
      playing: !video.paused,
      progress: duration() && Number.isFinite(video.currentTime) ? Math.min(1, Math.max(0, video.currentTime / duration())) : 0,
      duration: duration()
    });
  };
  const play = async (muted: boolean) => {
    const current = ++attempt;
    video.muted = muted;
    try {
      await video.play();
    } catch (error) {
      if (disposed || current !== attempt) return;
      if (!muted && error instanceof DOMException && error.name === 'NotAllowedError') {
        // Autoplay policy is not a change to the user's saved sound preference.
        video.muted = true;
        try { await video.play(); }
        catch { if (!disposed && current === attempt) video.pause(); }
      } else {
        video.muted = true;
        video.pause();
      }
    }
    if (!disposed && current === attempt) report();
  };
  const startPlayback = () => {
    if (disposed) return;
    // A stale/finished resume point must not trap the preview in the final half-second.
    const startAt = Number.isFinite(start) && start > 0 && start < duration() - .5 ? start : 0;
    if (startAt > 0) try { video.currentTime = startAt; } catch { /* Some sources are not seekable yet. */ }
    void play(readPreviewMuted());
  };
  const ended = () => {
    if (disposed) return;
    try { video.currentTime = 0; } catch { controller.stop(); return; }
    void play(video.muted);
  };
  const fail = () => controller.stop();
  const controller = {
    seek(position: number) {
      if (disposed || !duration() || !Number.isFinite(position)) return;
      try { video.currentTime = Math.max(0, Math.min(duration(), position)); }
      catch { return; }
      if (video.paused) void play(video.muted);
      report();
    },
    toggleMuted() {
      if (disposed) return;
      const muted = !video.muted && !video.paused;
      savePreviewMuted(muted);
      void play(muted);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      attempt++;
      if (active === controller) active = undefined;
      video.removeEventListener('loadedmetadata', startPlayback);
      video.removeEventListener('timeupdate', report);
      video.removeEventListener('durationchange', report);
      video.removeEventListener('ended', ended);
      video.removeEventListener('volumechange', report);
      video.removeEventListener('pause', report);
      video.removeEventListener('error', fail);
      video.muted = true;
      video.pause();
      video.removeAttribute('src');
      video.load();
    },
    stop() {
      if (disposed) return;
      controller.dispose();
      callbacks.onStop();
    }
  };
  active?.stop();
  active = controller;
  video.muted = readPreviewMuted();
  video.addEventListener('timeupdate', report);
  video.addEventListener('durationchange', report);
  video.addEventListener('ended', ended);
  video.addEventListener('volumechange', report);
  video.addEventListener('pause', report);
  video.addEventListener('error', fail);
  if (video.readyState >= 1) startPlayback();
  else video.addEventListener('loadedmetadata', startPlayback, { once: true });
  return controller;
}
