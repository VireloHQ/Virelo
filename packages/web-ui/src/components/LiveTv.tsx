import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal, TextArea } from '@heroui/react';
import { Broadcast, CheckCircle, ClipboardText, Clock, FileText, LinkSimple, LockSimple, MagnifyingGlass, MinusCircle, Play, Playlist, Plus, Pulse, Question, Stop, TagSimple, Television, Trash, UploadSimple, XCircle } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { IPTV_MAX_BYTES, type IptvChannelInfo, type IptvCheckResult, type IptvGuide, type IptvImport, type IptvSourceInfo } from '@virelo/core/iptv';
import { t, useLocale } from '@edition/i18n';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Select } from './Select';
import { LiveTvPlayback } from './LiveTvPlayback';
import { usePlaybackDock } from './PlaybackDock';
import { useIptvChecks } from '../hooks/useIptvChecks';
import './LiveTv.css';

export type LiveTvService = {
  sources: () => Promise<IptvSourceInfo[]>;
  channels: (id:string) => Promise<IptvGuide>;
  add: (input:IptvImport) => Promise<IptvSourceInfo>;
  remove: (id:string) => Promise<unknown>;
  check: (id:string,index:number,signal:AbortSignal) => Promise<IptvCheckResult>;
  play: (id:string,index:number) => Promise<{url:string;release?:()=>void}>;
};
const importModes = [
  {value:'url',label:'Playlist link',Icon:LinkSimple},
  {value:'stream',label:'Stream link',Icon:Broadcast},
  {value:'file',label:'File',Icon:FileText},
  {value:'paste',label:'Paste text',Icon:ClipboardText}
] as const;
type ImportMode = (typeof importModes)[number]['value'];
type PlaylistInput = IptvImport & { file?:File };
const pageSize = 100;
const emptyChannels: IptvChannelInfo[] = [];
const emptyChecks:ReadonlyMap<number,IptvCheckResult>=new Map();
type GuideState={channels:IptvChannelInfo[];results:ReadonlyMap<number,IptvCheckResult>;lastCheckedAt:number};
const channelName = (entry:IptvChannelInfo,index:number) => entry.name || t("Channel {count}",{count:index+1});

function statusLabels() {
  return {
    all:t("All statuses"),responding:t("Responding"),unavailable:t("Unavailable"),
    unconfirmed:t("Could not confirm"),'not-allowed':t("Not allowed"),unchecked:t("Not checked")
  };
}
type StatusFilter=keyof ReturnType<typeof statusLabels>;
const statusIcons = {all:Broadcast,responding:CheckCircle,unavailable:XCircle,unconfirmed:Question,'not-allowed':LockSimple,unchecked:MinusCircle};
const groupIcon = <TagSimple/>;

export function LiveTv({service,admin}:{service:LiveTvService;admin?:ReactNode}) {
  const locale = useLocale(), id = useId();
  const playback=usePlaybackDock(), minimized=playback?.minimized;
  const client = useQueryClient();
  const screen = useRef<HTMLElement>(null), guide = useRef<HTMLUListElement>(null);
  const [selected,setSelected] = useState<string|null>(null), [tuned,setTuned] = useState<number|null>(null);
  const [search,setSearch] = useState(''), [group,setGroup] = useState(''), [limit,setLimit] = useState(pageSize);
  const [statusFilter,setStatusFilter] = useState<StatusFilter>('all');
  const query = useDeferredValue(search.trim().toLocaleLowerCase());
  const [adding,setAdding] = useState(false);
  const [firstCheck,setFirstCheck] = useState<string|null>(null);
  const sources = useQuery({queryKey:['iptv-sources'],queryFn:service.sources});
  const source = sources.data?.find(item => item.id === selected) ?? sources.data?.[0];
  const sourceId=source?.id;
  const publishChecks=useCallback((id:string,updates:ReadonlyMap<number,IptvCheckResult>)=>{
    client.setQueryData<GuideState>(['iptv-channels',id],previous=>{
      if(!previous)return previous;
      const results=new Map(previous.results);
      let lastCheckedAt=previous.lastCheckedAt;
      for(const [index,result] of updates){
        if(!result.checkedAt&&results.get(index)?.checkedAt)continue;
        results.set(index,result);
        lastCheckedAt=Math.max(lastCheckedAt,result.checkedAt??0);
      }
      return {...previous,results,lastCheckedAt};
    });
  },[client]);
  const checks = useIptvChecks(sourceId,service.check,publishChecks);
  const runChecks=checks.run;
  const dateFormat=useMemo(()=>new Intl.DateTimeFormat(locale,{dateStyle:'short',timeStyle:'short'}),[locale]);
  const statuses = useMemo(statusLabels,[locale]);
  const statusOptions = useMemo(() => (Object.keys(statuses) as StatusFilter[]).map(value => {
    const Icon = statusIcons[value];
    return {value,label:statuses[value],icon:<Icon/>};
  }),[statuses]);
  const channels = useQuery({queryKey:['iptv-channels',sourceId],enabled:Boolean(sourceId),refetchOnWindowFocus:false,queryFn:async ():Promise<GuideState>=>{
    const {channels,checks}=await service.channels(sourceId!);
    const results=new Map<number,IptvCheckResult>();
    let lastCheckedAt=0;
    for(const result of checks){results.set(result.index,result);lastCheckedAt=Math.max(lastCheckedAt,result.checkedAt);}
    return {channels,results,lastCheckedAt};
  }});
  const list = channels.data?.channels ?? emptyChannels;
  const results = channels.data?.results ?? emptyChecks;
  const lastChecked = channels.data?.lastCheckedAt ? new Date(channels.data.lastCheckedAt) : null;
  const active = tuned === null ? undefined : list[tuned];
  const add = useMutation({mutationFn:async ({file,...input}:PlaylistInput) => {
    if (!file) return service.add(input);
    if (file.size>IPTV_MAX_BYTES) throw new Error('This playlist is too large.');
    let text:string;
    try { text=await file.text(); }
    catch { throw new Error('Could not read this playlist.'); }
    return service.add({...input,text});
  },onSuccess:async result => {
    await client.invalidateQueries({queryKey:['iptv-sources']});
    choose(result.id,true); setAdding(false);
  }});

  const playlists = useMemo(() => (sources.data ?? []).map(item => ({value:item.id,label:item.name})),[sources.data]);
  const groups = useMemo(() => [
    {value:'',label:t("All groups"),icon:groupIcon},
    ...[...new Set(list.flatMap(entry=>entry.groups))].sort((a,b) => a.localeCompare(b,locale)).map(value => ({value,label:value,icon:groupIcon}))
  ],[list,locale]);
  const matches = useMemo(() => list.flatMap((item,index) => {
    const label = channelName(item,index);
    return (!group || item.groups.includes(group)) && (!query || label.toLocaleLowerCase().includes(query)) ? [{index,label}] : [];
  }),[list,group,query,locale]);
  const visible = useMemo(() => statusFilter==='all'?matches:matches.filter(({index})=>(results.get(index)?.status??'unchecked')===statusFilter),
    [matches,statusFilter,results]);
  const unchecked = useMemo(() => visible.filter(({index})=>!results.has(index)),[visible,results]);

  useEffect(() => { if (guide.current) guide.current.scrollTop = 0; },[sourceId,group,query,statusFilter]);
  useEffect(()=>{
    if(!sourceId||firstCheck!==sourceId||!list.length)return;
    setFirstCheck(null);
    void runChecks(list.map((_,index)=>index));
  },[firstCheck,sourceId,list,runChecks]);

  function choose(next:string|null,checkNew=false) {
    checks.cancel();
    playback?.onStopped();
    setFirstCheck(checkNew?next:null);
    setSelected(next); setTuned(null); setSearch(''); setGroup(''); setStatusFilter('all'); setLimit(pageSize);
  }
  function checkMatches() {
    if(checks.running){checks.cancel();return;}
    void checks.run((unchecked.length?unchecked:visible).map(({index})=>index));
  }
  function tune(index:number, pointer:boolean) {
    if(index!==tuned)playback?.onStopped();
    setTuned(index);
    if (pointer && (screen.current?.parentElement?.clientWidth ?? Infinity) <= 720)
      window.requestAnimationFrame(() => screen.current?.scrollIntoView({block:'nearest',behavior:'instant'}));
  }

  function changeAdding(open:boolean) {
    if (add.isPending) return;
    add.reset(); setAdding(open);
  }

  const canAdd = !sources.isPending && !sources.isError;
  const importTitle = id+'-import-title';
  const checkLabel = checks.running?t("Cancel checks"):!visible.length||unchecked.length?t("Check channels"):t("Recheck channels");
  return <div className="content-view live-tv" data-import-open={!minimized && adding || undefined}>
    {!minimized && <><header className="content-heading">
      <div><h1>{t("Live TV")}</h1><p>{t("Watch channels from your own M3U or M3U8 playlists.")}</p></div>
      {canAdd && <Modal isOpen={adding} onOpenChange={changeAdding}>
        <Button variant="secondary"><Plus size={18} aria-hidden="true"/>{t("Add playlist")}</Button>
        <Modal.Backdrop className="virelo-confirm-backdrop live-tv-import-backdrop" isDismissable={!add.isPending} isKeyboardDismissDisabled={add.isPending}>
          <Modal.Container className="virelo-confirm-container" placement="center" size="sm" scroll="inside">
            <Modal.Dialog className="virelo-confirm-dialog live-tv-import-dialog" aria-labelledby={importTitle}>
              <Modal.Header className="virelo-confirm-header">
                <Modal.Heading id={importTitle} className="virelo-confirm-title">{t("Add playlist")}</Modal.Heading>
              </Modal.Header>
              <PlaylistImport titleId={importTitle} pending={add.isPending} error={add.error}
                onImport={input => add.mutate(input)} onCancel={() => changeAdding(false)}/>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>}
    </header>
    {admin}
    {sources.isPending && <p role="status" className="live-tv-message">{t("Loading…")}</p>}
    {sources.isError && <div className="live-tv-notice" role="alert"><p>{t(sources.error.message)}</p><Button variant="secondary" onPress={() => void sources.refetch()}>{t("Try again")}</Button></div>}
    {canAdd && !source && <p className="live-tv-message">{t("No playlists yet")}</p>}
    </>}
    {source && <div className="live-tv-grid">
      {!minimized && <section className="live-tv-directory" aria-labelledby={id+'-channels'}>
        <div className="live-tv-directory-head">
          <div className="live-tv-directory-title">
            <div className="live-tv-directory-meta"><h2 id={id+'-channels'}>{t("Channels")}</h2>
              {channels.data && <span className="live-tv-channel-count">
                <span aria-hidden="true">{visible.length.toLocaleString(locale)}</span>
                <span className="sr-only">{t("{count} channels",{count:visible.length})}</span>
              </span>}
            </div>
            <div className="live-tv-check-tools">
              {checks.progress && <span className="live-tv-check-progress" role="progressbar" aria-label={t("Checking…")}
                aria-valuemin={0} aria-valuemax={checks.progress.total} aria-valuenow={checks.progress.completed}>
                {checks.progress.completed.toLocaleString(locale)} / {checks.progress.total.toLocaleString(locale)}
              </span>}
              <Button variant="ghost" isIconOnly className="live-tv-check-button" aria-label={checkLabel} data-checking={checks.running || undefined}
                render={props=><button {...props} title={checkLabel}/>}
                aria-describedby={id+'-check-help'} isDisabled={!visible.length&&!checks.running} onPress={checkMatches}>
                {checks.running?<Stop size={18} weight="fill" aria-hidden="true"/>:<Pulse size={18} aria-hidden="true"/>}
              </Button>
              <span className="sr-only" id={id+'-check-help'}>{t("Checks all matching channels, including channels not yet shown, without starting playback.")}</span>
            </div>
          </div>
          <div className="live-tv-source">
            <Select label={t("Playlist")} icon={<Playlist/>} value={source.id} options={playlists} onChange={choose}/>
            <ConfirmationDialog key={source.id} triggerLabel={t("Remove playlist")} triggerIcon={<Trash size={17} aria-hidden="true"/>} triggerIconOnly triggerVariant="ghost"
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
            {groups.length > 1 && <Select label={t("Channel group")} icon={groupIcon} className={group?'live-tv-filter-active':undefined}
              value={group} options={groups} onChange={value => { setGroup(value); setLimit(pageSize); }}/>}
            <Select label={t("Stream status")} icon={<Broadcast/>} className={statusFilter!=='all'?'live-tv-filter-active':undefined}
              value={statusFilter} options={statusOptions} onChange={value => { setStatusFilter(value as StatusFilter); setLimit(pageSize); }}/>
          </div>
          {lastChecked && <div className="live-tv-checked">
            <Clock size={14} aria-hidden="true"/>
            <time dateTime={lastChecked.toISOString()}>{t("Last checked: {value0}",{value0:dateFormat.format(lastChecked)})}</time>
          </div>}
        </div>
        {channels.isPending && <p className="live-tv-message" role="status">{t("Loading…")}</p>}
        {channels.isError && <div className="live-tv-notice" role="alert"><p>{t(channels.error.message)}</p><Button variant="secondary" onPress={() => void channels.refetch()}>{t("Try again")}</Button></div>}
        {channels.data && !visible.length && <p className="live-tv-message">{t("No matches")}</p>}
        <ul className="live-channels" ref={guide} tabIndex={visible.length?0:undefined} aria-label={t("Channels")}>
          {visible.slice(0,limit).map(({index,label}) => {
            const result=results.get(index), pending=checks.checking.has(index);
            const status=pending?'checking':result?.status??'unchecked';
            const text=pending?t("Checking…"):result?.status==='responding'?t("{value0} ms",{value0:result.milliseconds}):statuses[result?.status??'unchecked'];
            const collection=group?undefined:list[index].groups[0];
            return <li className="live-channel-row" data-tuned={tuned===index} key={index}>
              <Button className="live-channel-play" variant="ghost" aria-label={label} aria-pressed={tuned===index} onPress={event => tune(index,event.pointerType!=='keyboard')}>
                <span className="live-channel-mark" aria-hidden="true"><Play size={15} weight={tuned===index?'fill':'regular'}/></span>
                <span className="live-channel-copy"><span>{label}</span>{collection && <small>{collection}</small>}</span>
              </Button>
              <Button className="live-channel-check" variant="ghost" data-status={status}
                aria-label={t("Check {value0}",{value0:label})+': '+text} aria-describedby={id+'-check-help'}
                aria-busy={pending} aria-disabled={checks.running||undefined} onPress={()=>void checks.run([index])}>
                <span className="live-channel-result">{status==='unchecked'?'—':text}</span>
              </Button>
            </li>;
          })}
        </ul>
        {visible.length > limit && <div className="live-tv-more"><Button variant="ghost" onPress={() => setLimit(value => value+pageSize)}>{t("Load more")}</Button></div>}
      </section>}
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

function PlaylistImport({titleId,pending,error,onImport,onCancel}: {
  titleId:string; pending:boolean; error:Error|null; onImport:(input:PlaylistInput)=>void; onCancel:()=>void
}) {
  const [mode,setMode] = useState<ImportMode>('url');
  const [name,setName] = useState(''), [url,setUrl] = useState(''), [paste,setPaste] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const [file,setFile] = useState<File|null>(null);
  const stream = mode==='stream';
  const submit = () => {
    const label = name.trim() || (mode==='file' ? file?.name.replace(/\.m3u8?$/i,'').slice(0,120) : undefined) || (stream?t("Live TV"):t("Playlist"));
    if (stream) { onImport({name:label,streamUrl:url.trim()}); return; }
    if (mode==='url') { onImport({name:label,url:url.trim()}); return; }
    if (mode==='paste') { onImport({name:label,text:paste}); return; }
    if (file) onImport({name:label,file});
  };

  return <form aria-labelledby={titleId} className="live-tv-import" onSubmit={event => { event.preventDefault(); if (!pending) submit(); }}>
    <Modal.Body className="virelo-confirm-body live-tv-import-fields">
      <div className="live-tv-modes" role="group" aria-label={t("Import from")}>
        {importModes.map(({value,label,Icon}) => <Button key={value} type="button" variant={mode===value?'secondary':'ghost'}
          aria-pressed={mode===value} isDisabled={pending} onPress={() => setMode(value)}>
          <Icon size={16} aria-hidden="true"/>{t(label)}
        </Button>)}
      </div>
      <label className="live-tv-field"><span>{stream?t("Channel name"):t("Playlist name")}</span>
        <Input maxLength={120} value={name} readOnly={pending} onChange={event => setName(event.currentTarget.value)}/>
      </label>
      {mode==='url'||stream ? <label className="live-tv-field"><span>{stream?t("Stream link"):t("Playlist link")}</span>
        <Input type="url" value={url} maxLength={4096} required autoComplete="off" spellCheck={false} readOnly={pending}
          placeholder="https://" onChange={event => setUrl(event.currentTarget.value)}/>
      </label> : mode==='file' ? <div className="live-tv-file">
        <input ref={fileInput} type="file" accept=".m3u,.m3u8" hidden
          onChange={event => { const next=event.currentTarget.files?.[0]; if (next) setFile(next); event.currentTarget.value=''; }}/>
        <Button variant="secondary" isDisabled={pending} onPress={() => fileInput.current?.click()}><UploadSimple size={18} aria-hidden="true"/>{t("Playlist file")}</Button>
        {file && <span>{file.name}</span>}
      </div> : <label className="live-tv-field"><span>{t("Playlist text")}</span>
        <TextArea rows={4} value={paste} maxLength={IPTV_MAX_BYTES} required spellCheck={false} readOnly={pending} onChange={event => setPaste(event.currentTarget.value)}/>
      </label>}
      {error && <p className="error-copy" role="alert">{t(error.message)}</p>}
    </Modal.Body>
    <Modal.Footer className="virelo-confirm-footer">
      <Button type="button" variant="secondary" isDisabled={pending} onPress={onCancel}>{t("Cancel")}</Button>
      <Button type="submit" isPending={pending} isDisabled={pending || (mode==='file'&&!file)}>{stream?t("Add stream"):t("Add playlist")}</Button>
    </Modal.Footer>
  </form>;
}
