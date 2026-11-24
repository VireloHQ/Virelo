import { createRoot } from 'react-dom/client';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { LiveTv } from '@virelo/web-ui/components/LiveTv.tsx';
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

if (window.top === window) {
  location.replace(location.origin===APP_ORIGIN?'/live-tv':location.hostname===LEGACY_HOST?'/app/live-tv?legacy=1':'/app/live-tv');
} else {
  initializeLocale();
  const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:20000,refetchOnWindowFocus:false}}});
  createRoot(document.getElementById('root')!).render(
    <LocaleRoot><QueryClientProvider client={client}><AppearanceProvider>
      <div className="app-shell live-tv-embed"><LiveTv service={localLiveTv}/></div>
    </AppearanceProvider></QueryClientProvider></LocaleRoot>
  );
}
