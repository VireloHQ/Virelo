const STORAGE_KEY = 'virelo-preview-muted:v1';
const PREVIEW_WINDOW = 15;
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
  onState: (state: { muted: boolean; playing: boolean; progress: number }) => void;
  onStop: () => void;
}) {
  let disposed = false;
  let attempt = 0;
  let startAt = Math.max(0, start);
  const report = () => {
    if (!disposed) callbacks.onState({
      muted: video.muted || video.paused,
      playing: !video.paused,
      progress: Math.min(1, Math.max(0, (video.currentTime - startAt) / PREVIEW_WINDOW))
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
    if (Number.isFinite(video.duration)) startAt = Math.min(startAt, Math.max(0, video.duration - .5));
    try { video.currentTime = startAt; } catch { /* Some sources are not seekable yet. */ }
    void play(readPreviewMuted());
  };
  const timeUpdate = () => {
    if (startAt + PREVIEW_WINDOW <= video.duration - .5 && video.currentTime >= startAt + PREVIEW_WINDOW) {
      video.currentTime = startAt;
    }
    report();
  };
  const ended = () => {
    video.currentTime = startAt;
    void play(video.muted);
  };
  const fail = () => controller.stop();
  const controller = {
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
      video.removeEventListener('timeupdate', timeUpdate);
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
  video.addEventListener('timeupdate', timeUpdate);
  video.addEventListener('ended', ended);
  video.addEventListener('volumechange', report);
  video.addEventListener('pause', report);
  video.addEventListener('error', fail);
  if (video.readyState >= 1) startPlayback();
  else video.addEventListener('loadedmetadata', startPlayback, { once: true });
  return controller;
}
