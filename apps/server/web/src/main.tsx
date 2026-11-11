import React, { useCallback, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource-variable/inter';
import { SplashScreen } from '@virelo/web-ui/components/SplashScreen.tsx';
import { router } from './router';
import { AccountSession } from './components/AccountSession';
import { initializeLocale } from './i18n';
import { LocaleRoot } from '@virelo/web-ui/i18n/LocaleRoot.tsx';
import './styles.css';
import './streaming-ui.css';
import '@virelo/web-ui/ui-motion.css';

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

function App() {
  const [showSplash, setShowSplash] = useState(true);
  const finishSplash = useCallback(() => setShowSplash(false), []);

  return (
    <>
      <AccountSession><RouterProvider router={router} /></AccountSession>
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
