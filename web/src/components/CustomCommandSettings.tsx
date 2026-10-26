import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { Copy, Play, Plus, Stop, TerminalWindow } from '@phosphor-icons/react';
import { api } from '../api';
import type { CustomCommand, CustomCommandDefinition } from '../../../src/custom-command-types';
import { ConfirmationDialog } from './ConfirmationDialog';
import './CustomCommandSettings.css';

const labels: Record<CustomCommand['status'], string> = { stopped:'Stopped', running:'Running', stopping:'Stopping…', exited:'Exited', error:'Failed' };
const running = (command: CustomCommand) => command.status === 'running' || command.status === 'stopping';

export function CustomCommandSettings() {
  useLocale();
  const client = useQueryClient(), [editing, setEditing] = useState<number | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey:['custom-commands'] });
  const commands = useQuery({ queryKey:['custom-commands'], queryFn:api.commands, retry:false, refetchInterval:query => query.state.data?.some(running) ? 1500 : false });
  return <section id="settings-panel-commands" className="settings-card settings-section command-settings" aria-labelledby="settings-title-commands">
    <div className="settings-card-head"><div><h2 id="settings-title-commands" tabIndex={-1}>{t("External tools")}</h2><p>{t("Start and stop your own CLI tools, including tunnels, from this PC.")}</p></div></div>
    <div className="command-safety"><TerminalWindow aria-hidden="true"/><p>{t("Commands run with this server’s permissions and can change files. Only add tools you trust. Nothing starts automatically.")}</p></div>
    <p className="command-help">{t("Only administrators connected directly through localhost can manage these tools. A launcher does not change your provider’s terms or grant permission to share videos.")}</p>
    {commands.isPending && <p role="status">{t("Loading commands…")}</p>}
    {commands.error && <p className="error-copy" role="alert">{t(commands.error.message)}</p>}
    <div className="command-list">{commands.data?.map(command => <div className="command-entry" key={command.id}>
      {editing === command.id ? <CommandEditor command={command} onDone={() => { setEditing(null); void refresh(); }}/>
        : <CommandCard command={command} onEdit={() => setEditing(command.id)} onChange={refresh}/>}
    </div>)}</div>
    {editing === 0 ? <CommandEditor onDone={() => { setEditing(null); void refresh(); }}/>
      : <Button variant="secondary" isDisabled={editing !== null || (commands.data?.length ?? 0) >= 8 || !commands.data} onPress={() => setEditing(0)}><Plus aria-hidden="true"/> {t("Add command")}</Button>}
    <details className="command-guide"><summary>{t("How commands work")}</summary><p>{t("Install and sign in to the tool on this PC first. Enter its executable separately from its arguments. Pipes, redirection and shell expansion are not applied. Windows batch files require an explicit command interpreter.")}</p><p><Trans message="Use {value0} as an argument placeholder for Virelo’s local HTTP address and current port. Commands run from Virelo’s data directory without interactive input. Keep tools in the foreground; detached services cannot be managed here." values={{value0:<code>{'{url}'}</code>}}/></p><p>{t("For remote access, set a fixed HTTPS URL or a domain used for generated URLs. Only that exact active hostname is allowed through Virelo’s Host check. Configure proxies to preserve the public Host and overwrite forwarding headers. Localhost-only administrator restrictions still apply.")}</p><p>{t("Stop controls only the process launched here and its attached children. It does not stop separately started services. Saved commands and arguments are stored in Virelo’s database; use the tool’s own credential storage instead of putting tokens in arguments.")}</p></details>
  </section>;
}

function CommandCard({ command, onEdit, onChange }: { command:CustomCommand; onEdit:() => void; onChange:() => Promise<unknown> }) {
  useLocale();
  const [copyMessage, setCopyMessage] = useState<{url:string;message:string} | null>(null);
  const action = useMutation({ mutationFn:(operation:'start'|'stop') => operation === 'start' ? api.startCommand(command.id) : api.stopCommand(command.id), onSettled:onChange });
  const copy = async () => {
    try { await navigator.clipboard.writeText(command.activeUrl); setCopyMessage({url:command.activeUrl,message:'URL copied'}); }
    catch { setCopyMessage({url:command.activeUrl,message:'Could not copy. Select the URL and copy it manually.'}); }
  };
  return <>
    <div className="command-heading"><div><h3>{command.name}</h3><span className="command-status" data-status={command.status}>{t(labels[command.status])}{command.exitCode !== null && ['exited','error'].includes(command.status) ? <> · {t('Exit code: {value0}',{value0:command.exitCode})}</> : ''}</span></div>
      <div className="command-actions"><Button variant={running(command)?'secondary':'primary'} isPending={action.isPending || command.status === 'stopping'} onPress={() => action.mutate(running(command)?'stop':'start')}>{running(command)?<Stop aria-hidden="true"/>:<Play aria-hidden="true"/>}{running(command)?t("Stop"):t("Start")}</Button>
        <Button variant="ghost" isDisabled={running(command) || action.isPending} onPress={onEdit}>{t("Edit")}</Button></div>
    </div>
    <code className="command-executable">{command.executable}</code>
    {command.activeUrl && <div className="command-url"><a href={command.activeUrl} target="_blank" rel="noreferrer">{command.activeUrl}</a><Button variant="secondary" onPress={() => void copy()}><Copy aria-hidden="true"/> {t("Copy URL")}</Button></div>}
    {!command.activeUrl && command.status === 'running' && command.urlDomain && <p className="command-help"><Trans message="Waiting for an HTTPS URL under {value0} in the tool’s output…" values={{value0:command.urlDomain}}/></p>}
    {action.error && <p className="error-copy" role="alert">{t(action.error.message)}</p>}
    {copyMessage && command.activeUrl && copyMessage.url === command.activeUrl && <p className="command-help" role="status">{t(copyMessage.message)}</p>}
    {command.output && <details className="command-output"><summary>{t("Command output")}</summary><pre tabIndex={0} aria-label={t("{value0} output", { value0: command.name })}>{command.output}</pre></details>}
  </>;
}

function CommandEditor({ command, onDone }: { command?:CustomCommand; onDone:() => void }) {
  useLocale();
  const id = useId();
  const [form, setForm] = useState<CustomCommandDefinition>(() => command ?? { name:'', executable:'', args:[], publicUrl:'', urlDomain:'' });
  const [argumentsText, setArgumentsText] = useState(command?.args.join('\n') ?? '');
  const save = useMutation({ mutationFn:() => api.saveCommand({ ...form, args:argumentsText ? argumentsText.replaceAll('\r\n','\n').split('\n') : [] }, command?.id), onSuccess:onDone });
  const remove = useMutation({ mutationFn:() => api.removeCommand(command!.id), onSuccess:onDone });
  return <form className="command-editor account-form" aria-label={command?t("Edit command"):t("New command")} onSubmit={event => { event.preventDefault(); if (!save.isPending && !remove.isPending) save.mutate(); }}>
    <h3>{command?t("Edit command"):t("New command")}</h3>
    <label htmlFor={`${id}-name`}>{t("Button name")}</label><Input id={`${id}-name`} value={form.name} onChange={event => setForm({ ...form, name:event.target.value })} maxLength={80} required autoFocus/>
    <label htmlFor={`${id}-executable`}>{t("Executable")}</label><Input id={`${id}-executable`} value={form.executable} onChange={event => setForm({ ...form, executable:event.target.value })} placeholder={t("Tool name or full executable path")} autoCapitalize="none" spellCheck={false} required/>
    <label htmlFor={`${id}-args`}>{t("Arguments")}</label><textarea className="input command-args" id={`${id}-args`} value={argumentsText} onChange={event => setArgumentsText(event.target.value)} rows={4} spellCheck={false} autoCapitalize="none" aria-describedby={`${id}-args-help`}/>
    <small id={`${id}-args-help`}><Trans message="One argument per line, without surrounding quotes. Use {value0} for Virelo’s local address." values={{value0:<code>{'{url}'}</code>}}/></small>
    <fieldset className="command-address"><legend>{t("Public address")} <span>{t("Optional")}</span></legend>
      <label htmlFor={`${id}-url`}>{t("Fixed public URL")}</label><Input id={`${id}-url`} value={form.publicUrl} onChange={event => setForm({ ...form, publicUrl:event.target.value })} type="url" placeholder="https://media.example.com" autoCapitalize="none" spellCheck={false}/>
      <label htmlFor={`${id}-domain`}>{t("Generated URL domain")}</label><Input id={`${id}-domain`} value={form.urlDomain} onChange={event => setForm({ ...form, urlDomain:event.target.value })} placeholder="share.example.com" autoCapitalize="none" spellCheck={false}/>
      <small>{t("Choose one. For generated URLs, enter the provider’s domain without https:// or a wildcard. Only a matching HTTPS URL from this command’s output is accepted.")}</small>
    </fieldset>
    <p className="command-help">{t("Saving does not run the command. The provider’s login, plan limits and content policies still apply.")}</p>
    {save.error && <p className="error-copy" role="alert">{t(save.error.message)}</p>}
    {remove.error && <p className="error-copy" role="alert">{t(remove.error.message)}</p>}
    <div className="command-editor-actions"><Button type="submit" isPending={save.isPending} isDisabled={remove.isPending}>{t("Save command")}</Button><Button variant="secondary" isDisabled={save.isPending || remove.isPending} onPress={onDone}>{t("Cancel")}</Button>
      {command && <ConfirmationDialog triggerLabel={t("Remove command")} title={t("Remove this command?")} confirmLabel={t("Remove command")} onConfirm={() => remove.mutateAsync()}><p>{t("Remove the saved launcher. The tool, its settings and your video files are not deleted.")}</p></ConfirmationDialog>}
    </div>
  </form>;
}
