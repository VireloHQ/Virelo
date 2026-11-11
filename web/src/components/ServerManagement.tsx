import { useEffect, useState } from 'react';
import { Button } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowClockwise, CheckCircle, WarningCircle } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { useAccount } from './AccountSession';
import { Select } from './Select';
import { ConfirmationDialog } from './ConfirmationDialog';

type ServerState = {
  version: string;
  managed: boolean;
  restartSupported: boolean;
  pid: number;
  uptimeSeconds: number;
  platform: string;
  dataDir: string;
  host: string;
  port: number;
  desired: { host: string; port: number };
  restartRequired: boolean;
  libraries: number;
  scanRunning: boolean;
};

async function readState(): Promise<ServerState> {
  const response = await fetch('/api/server/management');
  if (!response.ok) throw new Error(t('Could not load server settings.'));
  return response.json() as Promise<ServerState>;
}

async function saveState(host: string, port: number): Promise<ServerState> {
  const response = await fetch('/api/server/management/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Virelo-Request': '1' },
    body: JSON.stringify({ host, port })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || t('Could not save server settings.'));
  }
  return response.json() as Promise<ServerState>;
}

async function serverAction(action: 'stop' | 'restart', locale = 'en') {
  if (action === 'restart') {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/server-recovery?locale=' + encodeURIComponent(locale);
    form.enctype = 'text/plain';
    document.body.append(form);
    form.submit();
    return;
  }
  const response = await fetch('/api/server/management/' + action, {
    method: 'POST',
    headers: { 'X-Virelo-Request': '1' }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || t('Could not contact the server manager.'));
  }
}

export function ServerManagement() {
  const locale = useLocale();
  const localAccess = useAccount()?.localAccess;
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['server-management'], queryFn: readState, refetchInterval: 10000 });
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('41777');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && query.data) {
      setHost(query.data.desired.host);
      setPort(String(query.data.desired.port));
    }
  }, [query.data, dirty]);
  const save = useMutation({
    mutationFn: () => saveState(host, Number(port)),
    onSuccess: value => {
      setDirty(false);
      client.setQueryData(['server-management'], value);
    }
  });
  const valid = /^\d{1,5}$/.test(port) && Number(port) <= 65535;
  const changed = query.data ? host !== query.data.desired.host || port !== String(query.data.desired.port) : false;
  return <section id="settings-panel-server" className="settings-card settings-section" aria-labelledby="settings-title-server">
    <div className="settings-card-head">
      <div><h2 id="settings-title-server" tabIndex={-1}>{t('Server')}</h2>
        <p>{t('Manage how Virelo listens for connections.')}</p></div>
    </div>
    {query.isPending && <p>{t('Loading…')}</p>}
    {query.error && <p className="error-copy" role="alert">{query.error.message}</p>}
    {query.data && <>
      <dl className="tool-status admin-setting-group" aria-label={t('Server')}>
        <div><dt>{t('Status')}</dt><dd><CheckCircle aria-hidden="true"/>{t('Running')}</dd></div>
        <div><dt>{t('Version')}</dt><dd>{query.data.version}</dd></div>
        <div><dt>{t('Libraries')}</dt><dd>{query.data.libraries}</dd></div>
        <div><dt>{t('Process ID')}</dt><dd>{query.data.pid}</dd></div>
      </dl>
      <div className="setting-row">
        <div className="setting-copy"><div><strong>{t('Listening address')}</strong>
          <p>{t('Localhost is recommended. All interfaces allows other devices to connect.')}</p></div></div>
        <Select className="settings-picker" label={t('Listening address')} value={host} options={[
          {value:'127.0.0.1',label:t('Localhost only')},
          {value:'0.0.0.0',label:t('All IPv4 interfaces')},
          {value:'::1',label:t('IPv6 localhost')},
          {value:'::',label:t('All IPv6 interfaces')}
        ]} onChange={value=>{setHost(value);setDirty(true);}} align="end"/>
      </div>
      <div className="setting-row">
        <div className="setting-copy"><div><strong>{t('HTTP port')}</strong>
          <p>{t('Use 0 to select an available port automatically.')}</p></div></div>
        <input className="settings-server-port" type="number" aria-label={t('HTTP port')} min={0} max={65535}
          value={port} onChange={event=>{setPort(event.target.value);setDirty(true);}}
          disabled={!localAccess} style={{width:'8rem',maxWidth:'100%'}}/>
      </div>
      <div className="settings-section-actions">
        <Button isDisabled={!localAccess || !valid || !changed} isPending={save.isPending}
          onPress={()=>save.mutate()}>{t('Save settings')}</Button>
        <Button variant="secondary" onPress={()=>void query.refetch()}><ArrowClockwise aria-hidden="true"/>{t('Refresh')}</Button>
      </div>
      {!localAccess && <p className="account-notice">{t('Server network settings can only be changed on localhost.')}</p>}
      {query.data.restartRequired && <p className="account-notice" role="status">
        <WarningCircle aria-hidden="true"/> {t('Restart Virelo to apply the saved address and port.')}
      </p>}
      {save.isSuccess && <p className="settings-saved" role="status"><CheckCircle aria-hidden="true"/> {t('Settings saved.')}</p>}
      {save.error && <p className="error-copy" role="alert">{save.error.message}</p>}
      {localAccess && query.data.managed && <div className="settings-section-actions">
        {query.data.restartSupported && <ConfirmationDialog
          triggerLabel={t('Restart server')} title={t('Restart Virelo?')}
          confirmLabel={t('Restart server')} confirmVariant="primary"
          onConfirm={()=>serverAction('restart',locale)}>
          <p>{t('Virelo will briefly disconnect connected devices while it restarts.')}</p>
        </ConfirmationDialog>}
        <ConfirmationDialog triggerLabel={t('Stop server')} title={t('Stop Virelo?')}
          confirmLabel={t('Stop server')} onConfirm={()=>serverAction('stop')}>
          <p>{t('Virelo will stop serving videos until it is started again.')}</p>
        </ConfirmationDialog>
      </div>}
      {localAccess && !query.data.restartSupported && <p className="account-notice">
        {t('Use your terminal or service manager to restart this instance.')}
      </p>}
    </>}
  </section>;
}
