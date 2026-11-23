import { useEffect, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { t, useLocale } from '../i18n';
import '../live-tv-frame.css';

export function LiveTvView() {
  useLocale();
  const observer = useRef<ResizeObserver | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => () => observer.current?.disconnect(), []);

  return <div className="content-view">
    {failed ? <>
      <p role="alert">{t("The page could not be displayed. You can try opening it again.")}</p>
      <Button variant="secondary" onPress={() => setFailed(false)}>{t("Try again")}</Button>
    </> : <iframe className="live-tv-frame" src="/media/iptv/" title={t("Live TV")} allowFullScreen
      onLoad={({ currentTarget: frame }) => {
        observer.current?.disconnect();
        const root = frame.contentDocument?.getElementById('root');
        if (!root) { setFailed(true); return; }
        // Keep scrolling in the app; only the frame's document can connect to stream providers.
        const resize = () => {
          const height = Math.ceil(root.getBoundingClientRect().height);
          if (height > 0) frame.style.height = height + 'px';
        };
        observer.current = new ResizeObserver(resize);
        observer.current.observe(root);
        resize();
      }}/>}
  </div>;
}
