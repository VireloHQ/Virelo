import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { LiveTv } from '@virelo/web-ui/components/LiveTv.tsx';
import { PlaybackDockContext } from '@virelo/web-ui/components/PlaybackDock.tsx';
import { LocaleRoot } from '@virelo/web-ui/i18n/LocaleRoot.tsx';
import { localLiveTv } from './iptv-local';
import { initializeLocale } from './i18n';
import { APP_ORIGIN,LEGACY_HOST } from './utils/app-location';
import { AppearanceProvider } from './components/AppearanceProvider';
import '@fontsource-variable/inter';
import './styles.css';
import './streaming-ui.css';
import '@virelo/web-ui/ui-motion.css';
import './live-tv-frame.css';

function EmbeddedLiveTv() {
  const frame=window.frameElement;
  const [minimized,setMinimized]=useState(frame?.hasAttribute('data-minimized') ?? false);
  useEffect(() => {
    if (!frame) return;
    const sync=()=>setMinimized(frame.hasAttribute('data-minimized'));
    const observer=new MutationObserver(sync);
    observer.observe(frame,{attributeFilter:['data-minimized']});
    sync();
    return ()=>observer.disconnect();
  },[frame]);
  const send=(action:'playing'|'stopped'|'restore'|'close')=>window.parent.postMessage('virelo:live-tv:'+action,location.origin);
  return <PlaybackDockContext.Provider value={{
    source:{kind:'live-tv'},minimized,
    onPlaying:()=>send('playing'),onStopped:()=>send('stopped'),
    restore:()=>send('restore'),close:()=>send('close')
  }}>
    <div className="app-shell live-tv-embed"><div className="playback-dock" data-minimized={minimized || undefined}><LiveTv service={localLiveTv}/></div></div>
  </PlaybackDockContext.Provider>;
}

if (window.top === window) {
  location.replace(location.origin===APP_ORIGIN?'/live-tv':location.hostname===LEGACY_HOST?'/app/live-tv?legacy=1':'/app/live-tv');
} else {
  initializeLocale();
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:20000,refetchOnWindowFocus:false}}});
  createRoot(document.getElementById('root')!).render(
    <LocaleRoot><QueryClientProvider client={client}><AppearanceProvider>
      <EmbeddedLiveTv/>
    </AppearanceProvider></QueryClientProvider></LocaleRoot>
  );
}
