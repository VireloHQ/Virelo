import { useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { DownloadSimple, UploadSimple } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { backupSummary, exportBrowserData, importBrowserBackup, readBrowserBackup, type BackupKind, type BrowserBackup } from '../browser-backup';
import { Select } from '@virelo/web-ui/components/Select.tsx';
import { ConfirmationDialog } from '@virelo/web-ui/components/ConfirmationDialog.tsx';
import './BrowserBackup.css';

export async function downloadBrowserBackup(kind: BackupKind) {
  const blob = await exportBrowserData(kind), url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = kind === 'settings' ? 'virelo-settings.json' : 'virelo-library-backup.json';
    document.body.append(link);
    link.click();
    link.remove();
  } finally { window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

export function BrowserBackupSettings() {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<BackupKind>('library');
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [draft, setDraft] = useState<BrowserBackup | null>(null);
  const summary = draft ? backupSummary(draft) : null;
  return <section id="settings-panel-backup" className="settings-card settings-section" aria-labelledby="settings-title-backup">
    <div className="settings-card-head"><div><h2 id="settings-title-backup" tabIndex={-1}>{t('Export / Import')}</h2><p>{t('Back up settings or move your library to another browser.')}</p></div></div>
    <div className="backup-actions">
      <Select label={t('Export contents')} value={kind} options={[{ value: 'settings', label: t('Settings only') }, { value: 'library', label: t('Library and settings') }]} onChange={value => setKind(value as BackupKind)}/>
      <Button variant="secondary" isPending={pending} isDisabled={pending} onPress={async () => {
        setPending(true); setError(''); setMessage('');
        try { await downloadBrowserBackup(kind); setMessage('Backup ready.'); }
        catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not export this backup.'); }
        finally { setPending(false); }
      }}><DownloadSimple/>{t('Export')}</Button>
      <Button variant="secondary" isDisabled={pending} onPress={() => input.current?.click()}><UploadSimple/>{t('Import')}</Button>
    </div>
    <p className="backup-note">{t('Videos and folder permissions are not included. Reconnect folders after importing a library.')}</p>
    <input ref={input} type="file" accept=".json,application/json" hidden onChange={async event => {
      const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
      if (!file) return;
      setPending(true); setError(''); setMessage('');
      try { setDraft(await readBrowserBackup(file)); }
      catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not read this backup.'); }
      finally { setPending(false); }
    }}/>
    {error && <p className="error-copy" role="alert">{t(error)}</p>}
    {message && <div className="backup-result" role="status"><p>{t(message)}</p>{message !== 'Backup ready.' && <Button variant="secondary" onPress={() => window.location.reload()}>{t('Reload app')}</Button>}</div>}
    {draft && summary && <ConfirmationDialog key={JSON.stringify(summary)} initialOpen="pointer" triggerLabel={t('Import')} title={t('Import backup?')} confirmLabel={t('Import')} confirmVariant="primary" onAfterClose={() => setDraft(null)} onConfirm={async () => {
      const result = await importBrowserBackup(draft);
      if (result.preferencesRestored) window.location.reload();
      else setMessage('Data was imported, but some browser preferences could not be saved.');
    }}>
      {summary.kind === 'settings' ? <p>{t('This replaces your saved settings. Your library is unchanged.')}</p> : <>
        <p>{t('{value0} libraries · {value1} videos · {value2} playlists', { value0: summary.libraries, value1: summary.videos, value2: summary.playlists })}</p>
        <p>{t('Library backups can only be imported into an empty library. Reconnect your folders afterward.')}</p>
      </>}
    </ConfirmationDialog>}
  </section>;
}
