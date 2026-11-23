import { createRoot } from 'react-dom/client';
import { QueryClient,QueryClientProvider } from '@tanstack/react-query';
import { ArrowLeft } from '@phosphor-icons/react';
import { LiveTv } from '@virelo/web-ui/components/LiveTv.tsx';
import { LocaleRoot } from '@virelo/web-ui/i18n/LocaleRoot.tsx';
import { localLiveTv } from './iptv-local';
import { initializeLocale,t,useLocale } from './i18n';
import { APP_ORIGIN,LEGACY_HOST } from './utils/app-location';
import '@fontsource-variable/inter';
import './styles.css';
import './streaming-ui.css';
import '@virelo/web-ui/ui-motion.css';

initializeLocale();
const client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:20000,refetchOnWindowFocus:false}}});
function LiveTvPage() {
  useLocale();
  const back=location.origin===APP_ORIGIN?'/library':location.hostname===LEGACY_HOST?'/app/library?legacy=1':'/app/library';
  return <main className="app-shell">
    <a className="live-tv-return library-playlists-link" href={back}><ArrowLeft aria-hidden="true"/>{t("Library")}</a>
    <LiveTv service={localLiveTv}/>
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <LocaleRoot><QueryClientProvider client={client}><LiveTvPage/></QueryClientProvider></LocaleRoot>
);
