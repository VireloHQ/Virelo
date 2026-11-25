import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { t, useLocale } from '../i18n';
import '../live-tv-frame.css';

export function LiveTvView() {
  useLocale();
  const cleanupFrame = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => cleanupFrame.current?.(), []);

  return <div className="content-view">
    {failed ? <>
      <p role="alert">{t("The page could not be displayed. You can try opening it again.")}</p>
      <Button variant="secondary" onPress={() => setFailed(false)}>{t("Try again")}</Button>
    </> : <iframe className="live-tv-frame" src="/media/iptv/" title={t("Live TV")} allowFullScreen
      onLoad={({ currentTarget: frame }) => {
        cleanupFrame.current?.();
        const doc = frame.contentDocument, root = doc?.getElementById('root');
        if (!doc || !root) { setFailed(true); return; }
        const shell = frame.closest('.app-shell');
        const header = shell?.querySelector('.topbar'), dock = shell?.querySelector('.mobile-nav');
        const viewport = window.visualViewport;
        // In-frame dialogs must fit the visible part of the frame, above the app's mobile dock.
        const position = () => {
          const bounds = frame.getBoundingClientRect(), bar = header?.getBoundingClientRect();
          const dockTop = dock?.getClientRects().length ? dock.getBoundingClientRect().top : Infinity;
          const viewportTop = viewport?.offsetTop ?? 0;
          const headerBottom = bar && bar.right > bounds.left && bar.left < bounds.right ? bar.bottom : 0;
          const top = Math.max(bounds.top, viewportTop, headerBottom);
          const bottom = Math.min(viewportTop + (viewport?.height ?? window.innerHeight), dockTop);
          doc.documentElement.style.setProperty('--live-tv-viewport-top', `${top - bounds.top}px`);
          doc.documentElement.style.setProperty('--live-tv-viewport-height', `${Math.max(0, bottom - top)}px`);
        };
        // Keep scrolling in the app; only the frame's document can connect to stream providers.
        const resize = () => {
          const height = Math.ceil(root.getBoundingClientRect().height);
          if (height > 0) frame.style.height = height + 'px';
          position();
        };
        const observer = new ResizeObserver(resize);
        observer.observe(root);
        window.addEventListener('scroll', position, { passive: true });
        window.addEventListener('resize', position);
        viewport?.addEventListener('resize', position);
        viewport?.addEventListener('scroll', position);
        cleanupFrame.current = () => {
          observer.disconnect();
          window.removeEventListener('scroll', position);
          window.removeEventListener('resize', position);
          viewport?.removeEventListener('resize', position);
          viewport?.removeEventListener('scroll', position);
        };
        resize();
      }}/>}
  </div>;
}
