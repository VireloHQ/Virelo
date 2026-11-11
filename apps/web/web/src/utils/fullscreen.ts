type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
};

type WebkitVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

/**
 * Toggle fullscreen across standard browsers and iPad/iPhone Safari.
 * Safari's native video fullscreen is the only reliable option on iOS/iPadOS
 * versions where element.requestFullscreen is missing or rejected.
 */
export async function toggleFullscreen(container: HTMLElement, video: HTMLVideoElement): Promise<void> {
  const doc = document as WebkitDocument;
  const nativeVideo = video as WebkitVideo;

  if (document.fullscreenElement) {
    await document.exitFullscreen?.().catch(() => {});
    return;
  }

  if (doc.webkitFullscreenElement) {
    doc.webkitExitFullscreen?.();
    return;
  }

  if (nativeVideo.webkitDisplayingFullscreen) {
    nativeVideo.webkitExitFullscreen?.();
    return;
  }

  try {
    if (typeof container.requestFullscreen === 'function') {
      await container.requestFullscreen();
      return;
    }
  } catch {
    // Fall through to Safari's video-only fullscreen API.
  }

  try {
    nativeVideo.webkitEnterFullscreen?.();
  } catch {
    // The browser does not expose a supported fullscreen mode.
  }
}
