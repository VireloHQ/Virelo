import React, { useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import { SplashScreen } from '@virelo/web-ui/components/SplashScreen.tsx';
import { initialLocale, router } from './router';
import { initializeLocale, setLocale } from './i18n';
import { LocaleRoot } from '@virelo/web-ui/i18n/LocaleRoot.tsx';
import './styles.css';
import './streaming-ui.css';
import '@virelo/web-ui/ui-motion.css';
import { APP_ORIGIN, LEGACY_HOST } from './utils/app-location';
const LegacyMigration = React.lazy(() => import('./components/LegacyMigration').then(module => ({ default: module.LegacyMigration })));
const legacyVisit = window.location.hostname === LEGACY_HOST && new URLSearchParams(window.location.search).get('legacy') !== '1';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' })
      .catch(error => console.warn('Offline caching is unavailable; the app will keep working.', error));
  });
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 20_000, refetchOnWindowFocus: false, retry: 1 } }
});
initializeLocale();
if (initialLocale) void setLocale(initialLocale).catch(() => {});

// A repair/rescan replaces blob URLs. All artwork consumers must stop using the revoked URL.
window.addEventListener('virelo-thumbnail-updated',event=>{
  const {id,url}=(event as CustomEvent<{id:number;url:string|null}>).detail;
  queryClient.setQueriesData({queryKey:['thumbnail',id]},url);
});

function App() {
  const [showSplash, setShowSplash] = useState(() => window.location.origin === APP_ORIGIN || window.location.pathname === '/app' || window.location.pathname.startsWith('/app/'));
  const finishSplash = useCallback(() => setShowSplash(false), []);

  return (
    <>
      {legacyVisit ? <React.Suspense fallback={null}><LegacyMigration/></React.Suspense> : <RouterProvider router={router} />}
      {showSplash && <SplashScreen onDone={finishSplash} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LocaleRoot>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
    </LocaleRoot>
  </React.StrictMode>
);
