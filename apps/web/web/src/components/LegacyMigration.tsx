import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { ArrowSquareOut, DownloadSimple } from '@phosphor-icons/react';
import { deviceLocale, getLocale, t, useLocale } from '../i18n';
import { hasBrowserData } from '../browser-backup';
import { newAppUrl } from '../utils/app-location';
import { downloadBrowserBackup } from './BrowserBackup';
import { LoadingSpinner } from '@virelo/web-ui/components/LoadingSpinner.tsx';

export function LegacyMigration() {
  useLocale();
  const [checking, setChecking] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    void hasBrowserData().then(saved => {
      if (cancelled) return;
      if (!saved) {
        const next = newAppUrl(window.location.href);
        next.searchParams.set('lang', deviceLocale());
        window.location.replace(next.href);
      } else setChecking(false);
    }).catch(() => { if (!cancelled) { setChecking(false); setError('Browser storage could not be read. Your existing data has not been removed.'); } });
    return () => { cancelled = true; };
  }, []);
  const old = new URL(window.location.href); old.searchParams.set('legacy', '1');
  const next = newAppUrl(window.location.href); next.pathname = '/settings'; next.search = ''; next.searchParams.set('section', 'backup'); next.searchParams.set('lang', getLocale()); next.hash = '';
  return <main className="migration-page"><section className="migration-card" aria-labelledby="migration-title">
    <div className="migration-brand"><img src="/virelo-icon-180.png?v=ribbon-1" alt="" width={58} height={58}/><span>Virelo</span></div>
    <h1 id="migration-title">{t('Virelo has moved')}</h1>
    {checking ? <p role="status"><LoadingSpinner/>{t('Checking saved data…')}</p> : <>
      <p>{t('Your library is still saved here. Export it, then import the backup at app.virelo.dev.')}</p>
      <p>{t('Reconnect your folders after importing.')}</p>
      <div className="backup-actions">
        <Button isPending={pending} isDisabled={pending} onPress={async () => {
          setPending(true); setError('');
          try { await downloadBrowserBackup('library'); }
          catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export this backup.'); }
          finally { setPending(false); }
        }}><DownloadSimple/>{t('Export library backup')}</Button>
        <Button variant="secondary" onPress={() => window.location.assign(next.href)}><ArrowSquareOut/>{t('Open new Virelo')}</Button>
      </div>
      {error && <p className="error-copy" role="alert">{t(error)}</p>}
      <a className="migration-old-link" href={old.href}>{t('Open old library')}</a>
    </>}
  </section></main>;
}
