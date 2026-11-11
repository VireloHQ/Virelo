export async function playVideo(video: HTMLVideoElement, shouldPlay: () => boolean, onMuted?: () => void) {
  if (!video.isConnected || !shouldPlay()) return;
  try {
    await video.play();
  } catch (reason) {
    if (!video.isConnected || !shouldPlay() || !(reason instanceof DOMException) || reason.name !== 'NotAllowedError') return;
    // Audible autoplay needs a gesture in some browsers. Start muted instead of leaving a frozen frame.
    video.muted = true;
    onMuted?.();
    try { await video.play(); } catch { return; }
  }
  if (!shouldPlay() && video.isConnected) video.pause();
}

