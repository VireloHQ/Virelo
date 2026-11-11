import { useLayoutEffect, useState, type RefObject } from 'react';
import { DEFAULT_VIDEO_PRESENTATION, normalizeVideoPresentation, videoPresentationStyle, type VideoPresentation } from '../utils/video-presentation';

export function useVideoPresentation(itemId: number, containerRef: RefObject<HTMLElement | null>) {
  const [stored, setStored] = useState({ itemId, settings: DEFAULT_VIDEO_PRESENTATION });
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Reset synchronously on an item change, including when revisiting a previously adjusted item.
  if (stored.itemId !== itemId) setStored({ itemId, settings: DEFAULT_VIDEO_PRESENTATION });
  const settings = stored.itemId === itemId ? stored.settings : DEFAULT_VIDEO_PRESENTATION;
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const next = { width: container.clientWidth, height: container.clientHeight };
      setSize(previous => previous.width === next.width && previous.height === next.height ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  const update = (patch: Partial<VideoPresentation>) => setStored(previous => ({
    itemId, settings: normalizeVideoPresentation({
      ...(previous.itemId === itemId ? previous.settings : DEFAULT_VIDEO_PRESENTATION), ...patch
    })
  }));
  const reset = () => setStored({ itemId, settings: DEFAULT_VIDEO_PRESENTATION });
  return { settings, update, reset, style: videoPresentationStyle(settings, size) };
}
