import { useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, TextArea } from '@heroui/react';
import { MagnifyingGlass, Play, Plus, Pulse, Television, Trash, UploadSimple } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IPTV_MAX_BYTES, type IptvChannelInfo, type IptvCheckResult, type IptvImport, type IptvSourceInfo } from '@virelo/core/iptv';
import { t, useLocale } from '@edition/i18n';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Select } from './Select';
import { LiveTvPlayback } from './LiveTvPlayback';
import { useIptvChecks } from '../hooks/useIptvChecks';
import './LiveTv.css';

export type LiveTvService = {
  sources: () => Promise<IptvSourceInfo[]>;
  channels: (id:string) => Promise<IptvChannelInfo[]>;
  add: (input:IptvImport) => Promise<IptvSourceInfo>;
  remove: (id:string) => Promise<unknown>;
  check: (id:string,index:number,signal:AbortSignal) => Promise<IptvCheckResult>;
  play: (id:string,index:number) => Promise<{url:string;release?:()=>void}>;
};
type ImportMode = 'url'|'file'|'paste';
const pageSize = 100;
const emptyChannels: IptvChannelInfo[] = [];
const channelName = (entry:IptvChannelInfo,index:number) => entry.name || t("Channel {count}",{count:index+1});

function statusLabels() {
  return {
    all:t("All statuses"),responding:t("Responding"),unavailable:t("Unavailable"),
    unconfirmed:t("Could not confirm"),'not-allowed':t("Not allowed"),unchecked:t("Not checked")
  };
}
type StatusFilter=keyof ReturnType<typeof statusLabels>;

export function LiveTv({service,admin}:{service:LiveTvService;admin?:ReactNode}) {
  const locale = useLocale(), id = useId();
  const client = useQueryClient();
  const screen = useRef<HTMLElement>(null), guide = useRef<HTMLUListElement>(null);
  const [selected,setSelected] = useState<string|null>(null), [tuned,setTuned] = useState<number|null>(null);
  const [search,setSearch] = useState(''), [group,setGroup] = useState(''), [limit,setLimit] = useState(pageSize);
  const [statusFilter,setStatusFilter] = useState<StatusFilter>('all');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const [adding,setAdding] = useState(false);
  const sources = useQuery({queryKey:['iptv-sources'],queryFn:service.sources});
  const source = sources.data?.find(item => item.id === selected) ?? sources.data?.[0];
  const checks = useIptvChecks(source?.id,service.check);
  const statuses = useMemo(statusLabels,[locale]);
  const statusOptions = useMemo(() => Object.entries(statuses).map(([value,label])=>({value,label})),[statuses]);
  const channels = useQuery({queryKey:['iptv-channels',source?.id],queryFn:() => service.channels(source!.id),enabled:Boolean(source)});
  const list = channels.data ?? emptyChannels;
  const active = tuned === null ? undefined : list[tuned];
  const add = useMutation({mutationFn:service.add,onSuccess:async result => {
    await client.invalidateQueries({queryKey:['iptv-sources']});
    choose(result.id); setAdding(false);
  }});

  const playlists = useMemo(() => (sources.data ?? []).map(item => ({value:item.id,label:item.name})),[sources.data]);
  const groups = useMemo(() => [
    {value:'',label:t("All groups")},
    ...[...new Set(list.flatMap(entry=>entry.groups))].sort((a,b) => a.localeCompare(b,locale)).map(value => ({value,label:value}))
  ],[list,locale]);
  const matches = useMemo(() => list.flatMap((item,index) => {
    const label = channelName(item,index);
    return (!group || item.groups.includes(group)) && (!query || label.toLocaleLowerCase().includes(query)) ? [{index,label}] : [];
  }),[list,group,query,locale]);
  const visible = statusFilter==='all'?matches:matches.filter(({index})=>(checks.results.get(index)?.status??'unchecked')===statusFilter);

  useEffect(() => { if (guide.current) guide.current.scrollTop = 0; },[source?.id,group,query,statusFilter]);

  function choose(next:string|null) {
    checks.cancel();
    setSelected(next); setTuned(null); setSearch(''); setGroup(''); setStatusFilter('all'); setLimit(pageSize);
  }
  function checkVisible() {
    if(checks.running){checks.cancel();return;}
    const list=guide.current;
    if(!list)return;
    const viewport=list.getBoundingClientRect();
    const indices=Array.from(list.querySelectorAll<HTMLElement>('[data-channel]')).filter(row=>{
      const rect=row.getBoundingClientRect();
      return rect.bottom>viewport.top&&rect.top<viewport.bottom;
    }).map(row=>Number(row.dataset.channel));
    void checks.run(indices);
  }
  function tune(index:number, pointer:boolean) {
    setTuned(index);
    if (pointer && (screen.current?.parentElement?.clientWidth ?? Infinity) <= 720)
      window.requestAnimationFrame(() => screen.current?.scrollIntoView({block:'nearest',behavior:'instant'}));
  }

  return <div className="content-view live-tv">
    <header className="content-heading">
      <div><h1>{t("Live TV")}</h1><p>{t("Watch channels from your own M3U or M3U8 playlists.")}</p></div>
      {source && <Button variant="secondary" isDisabled={add.isPending} aria-expanded={adding} aria-controls={adding?id+'-import':undefined}
        onPress={() => { add.reset(); setAdding(value => !value); }}><Plus size={18} aria-hidden="true"/>{t("Add playlist")}</Button>}
    </header>
    {admin}
    {sources.isPending && <p role="status" className="live-tv-message">{t("Loading…")}</p>}
    {sources.isError && <div className="live-tv-notice" role="alert"><p>{t(sources.error.message)}</p><Button variant="secondary" onPress={() => void sources.refetch()}>{t("Try again")}</Button></div>}
    {!sources.isPending && !sources.isError && (adding || !source) &&
      <PlaylistImport id={id+'-import'} pending={add.isPending} error={add.error} onImport={input => add.mutate(input)}
        onCancel={source ? () => { add.reset(); setAdding(false); } : undefined}/>}
    {source && <div className="live-tv-grid">
      <section className="live-tv-directory" aria-labelledby={id+'-channels'}>
        <div className="live-tv-directory-head">
          <div className="live-tv-directory-title"><h2 id={id+'-channels'}>{t("Channels")}</h2>
            {channels.data && <span>{t("{count} channels",{count:visible.length})}</span>}
          </div>
          <div className="live-tv-source">
            <Select label={t("Playlist")} value={source.id} options={playlists} onChange={choose}/>
            <ConfirmationDialog key={source.id} triggerLabel={t("Remove playlist")} triggerIcon={<Trash size={18}/>} triggerIconOnly
              title={t("Remove playlist?")} confirmLabel={t("Remove playlist")}
              onConfirm={async () => { await service.remove(source.id); choose(null); await client.invalidateQueries({queryKey:['iptv-sources']}); }}>
              <p>{source.name}</p>
            </ConfirmationDialog>
          </div>
          <div className="live-tv-search">
            <MagnifyingGlass size={18} aria-hidden="true"/>
            <Input aria-label={t("Search channels")} placeholder={t("Search channels")} inputMode="search" value={search} spellCheck={false} autoComplete="off"
              onChange={event => { setSearch(event.currentTarget.value); setLimit(pageSize); }}/>
          </div>
          <div className="live-tv-filters">
            {groups.length > 1 && <Select label={t("Channel group")} value={group} options={groups} onChange={value => { setGroup(value); setLimit(pageSize); }}/>}
            <Select label={t("Stream status")} value={statusFilter} options={statusOptions} onChange={value => { setStatusFilter(value as StatusFilter); setLimit(pageSize); }}/>
          </div>
          <div className="live-tv-check-tools">
            <Button variant="ghost" aria-describedby={id+'-check-help'} isDisabled={!visible.length&&!checks.running} onPress={checkVisible}>
              <Pulse size={16} aria-hidden="true"/>{checks.running?t("Cancel checks"):t("Check visible")}
            </Button>
            <span className="sr-only" id={id+'-check-help'}>{t("Checks the response of the stream playlist without starting playback.")}</span>
          </div>
        </div>
        {channels.isPending && <p className="live-tv-message" role="status">{t("Loading…")}</p>}
        {channels.isError && <div className="live-tv-notice" role="alert"><p>{t(channels.error.message)}</p><Button variant="secondary" onPress={() => void channels.refetch()}>{t("Try again")}</Button></div>}
        {channels.data && !visible.length && <p className="live-tv-message">{t("No matches")}</p>}
        <ul className="live-channels" ref={guide} tabIndex={visible.length?0:undefined} aria-label={t("Channels")}>
          {visible.slice(0,limit).map(({index,label}) => {
            const result=checks.results.get(index), pending=checks.checking.has(index);
            const status=pending?'checking':result?.status??'unchecked';
            const text=pending?t("Checking…"):result?.status==='responding'?t("{value0} ms",{value0:result.milliseconds}):statuses[result?.status??'unchecked'];
            return <li className="live-channel-row" data-channel={index} data-tuned={tuned===index} key={index}>
              <Button className="live-channel-play" variant="ghost" aria-pressed={tuned===index} onPress={event => tune(index,event.pointerType!=='keyboard')}>
                <Play size={16} weight={tuned===index?'fill':'regular'} aria-hidden="true"/><span>{label}</span>
              </Button>
              <Button className="live-channel-check" variant="ghost" data-status={status}
                aria-label={t("Check {value0}",{value0:label})+': '+text} aria-describedby={id+'-check-help'}
                aria-busy={pending} aria-disabled={checks.running||undefined} onPress={()=>void checks.run([index])}>
                {status==='unchecked'?'—':text}
              </Button>
            </li>;
          })}
        </ul>
        {visible.length > limit && <div className="live-tv-more"><Button variant="ghost" onPress={() => setLimit(value => value+pageSize)}>{t("Load more")}</Button></div>}
      </section>
      <section className="live-tv-screen" aria-label={t("Live TV")} data-tuned={Boolean(active)} ref={screen}>
        {tuned !== null && active ? <>
          <LiveTvPlayback key={source.id+':'+tuned} title={channelName(active,tuned)} service={service} source={source.id} channel={tuned}/>
          <div className="live-tv-channel-info"><h2>{channelName(active,tuned)}</h2>
            {active.groups.length > 0 && <p>{active.groups.join(', ')}</p>}
          </div>
        </> : <div className="live-tv-placeholder"><Television size={32} aria-hidden="true"/><p>{t("Choose a channel to watch.")}</p></div>}
      </section>
    </div>}
  </div>;
}

function PlaylistImport({id,pending,error,onImport,onCancel}: {
  id:string; pending:boolean; error:Error|null; onImport:(input:IptvImport)=>void; onCancel?:()=>void
}) {
  const [mode,setMode] = useState<ImportMode>('url');
  const [name,setName] = useState(''), [url,setUrl] = useState(''), [paste,setPaste] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [file,setFile] = useState<File|null>(null), [reading,setReading] = useState(false), [message,setMessage] = useState('');
  const busy = pending || reading;
  const submit = async () => {
    setMessage('');
    const label = name.trim() || (mode==='file' ? file?.name.replace(/\.m3u8?$/i,'').slice(0,120) : undefined) || t("Playlist");
    if (mode==='url') { onImport({name:label,url:url.trim()}); return; }
    if (mode==='paste') { onImport({name:label,text:paste}); return; }
    if (!file) return;
    if (file.size>IPTV_MAX_BYTES) { setMessage(t("This playlist is too large.")); return; }
    setReading(true);
    try { onImport({name:label,text:await file.text()}); }
    catch { setMessage(t("Could not read this playlist.")); }
    finally { setReading(false); }
  };

  return <form id={id} aria-labelledby={id+'-title'} className="live-tv-import" onSubmit={event => { event.preventDefault(); if (!busy) void submit(); }}>
    <h2 id={id+'-title'}>{t("Add playlist")}</h2>
    <div className="live-tv-modes" role="group" aria-label={t("Import from")}>
      {(['url','file','paste'] as const).map(value => <Button key={value} variant={mode===value?'secondary':'ghost'}
        aria-pressed={mode===value} isDisabled={busy} onPress={() => { setMode(value); setMessage(''); }}>
        {value==='url'?t("Playlist link"):value==='file'?t("File"):t("Paste text")}
      </Button>)}
    </div>
    <label className="live-tv-field"><span>{t("Playlist name")}</span>
      <Input maxLength={120} value={name} onChange={event => setName(event.currentTarget.value)}/>
    </label>
    {mode==='url' ? <label className="live-tv-field"><span>{t("Playlist link")}</span>
      <Input type="url" value={url} maxLength={4096} required autoComplete="off" spellCheck={false}
        placeholder="https://" onChange={event => setUrl(event.currentTarget.value)}/>
    </label> : mode==='file' ? <div className="live-tv-file">
      <input ref={fileInput} type="file" accept=".m3u,.m3u8" hidden
        onChange={event => { const next=event.currentTarget.files?.[0]; if (next) setFile(next); event.currentTarget.value=''; }}/>
      <Button variant="secondary" isDisabled={busy} onPress={() => fileInput.current?.click()}><UploadSimple size={18} aria-hidden="true"/>{t("Playlist file")}</Button>
      {file && <span>{file.name}</span>}
    </div> : <label className="live-tv-field"><span>{t("Playlist text")}</span>
      <TextArea rows={4} value={paste} maxLength={IPTV_MAX_BYTES} required spellCheck={false} onChange={event => setPaste(event.currentTarget.value)}/>
    </label>}
    {(message || error) && <p className="error-copy" role="alert">{message || t(error!.message)}</p>}
    <div className="live-tv-form-actions">
      <Button type="submit" isPending={busy} isDisabled={mode==='file'&&!file}>{t("Add playlist")}</Button>
      {onCancel && <Button variant="ghost" isDisabled={busy} onPress={onCancel}>{t("Cancel")}</Button>}
    </div>
  </form>;
}
