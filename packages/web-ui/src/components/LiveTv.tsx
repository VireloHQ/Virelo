/// <reference path="../hls-light.d.ts" />
import { useDeferredValue,useEffect,useId,useRef,useState,type ReactNode } from 'react';
import { Button } from '@heroui/react';
import { Play,Television } from '@phosphor-icons/react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { IPTV_MAX_BYTES,type IptvChannelInfo,type IptvImport,type IptvSourceInfo } from '@virelo/core/iptv';
import { t,useLocale } from '@edition/i18n';
import { readPlaybackVolume } from '../utils/playback-volume';
import { ConfirmationDialog } from './ConfirmationDialog';
import './LiveTv.css';

export type LiveTvService={
  sources:()=>Promise<IptvSourceInfo[]>;
  channels:(id:string)=>Promise<IptvChannelInfo[]>;
  add:(input:IptvImport)=>Promise<IptvSourceInfo>;
  remove:(id:string)=>Promise<unknown>;
  play:(id:string,index:number)=>Promise<{url:string;release?:()=>void}>;
};
type ImportMode='url'|'file'|'paste';
const pageSize=100;

export function LiveTv({service,admin}:{service:LiveTvService;admin?:ReactNode}) {
  useLocale();
  const client=useQueryClient(),id=useId();
  const [selected,setSelected]=useState<string|null>(null);
  const [tuned,setTuned]=useState<number|null>(null);
  const [search,setSearch]=useState(''),[group,setGroup]=useState(''),[limit,setLimit]=useState(pageSize);
  const query=useDeferredValue(search.trim().toLocaleLowerCase());
  const [adding,setAdding]=useState(false);
  const sources=useQuery({queryKey:['iptv-sources'],queryFn:service.sources});
  const source=sources.data?.find(item=>item.id===selected)??sources.data?.[0];
  const channels=useQuery({queryKey:['iptv-channels',source?.id],queryFn:()=>service.channels(source!.id),enabled:Boolean(source)});
  const add=useMutation({mutationFn:service.add,onSuccess:async result=>{
    await client.invalidateQueries({queryKey:['iptv-sources']});
    choose(result.id);setAdding(false);
  }});
  function choose(next:string|null) {
    setSelected(next);setTuned(null);setSearch('');setGroup('');setLimit(pageSize);
  }
  const list=channels.data??[];
  const groups=[...new Set(list.flatMap(entry=>entry.groups))].sort((a,b)=>a.localeCompare(b));
  const name=(entry:IptvChannelInfo,index:number)=>entry.name||t("Channel {count}",{count:index+1});
  const visible=list.map((item,index)=>({item,index})).filter(({item,index})=>
    (!group||item.groups.includes(group))&&(!query||name(item,index).toLocaleLowerCase().includes(query)));
  return <div className="content-view live-tv">
    <header className="content-heading">
      <div><h1>{t("Live TV")}</h1><p>{t("Watch channels from your own M3U or M3U8 playlists.")}</p></div>
      {sources.data?.length?<Button variant="secondary" onPress={()=>setAdding(value=>!value)} aria-expanded={adding}>{t("Add playlist")}</Button>:null}
    </header>
    {admin}
    {sources.isError&&<p className="error-copy" role="alert">{t(sources.error.message)} <button type="button" onClick={()=>void sources.refetch()}>{t("Try again")}</button></p>}
    {!sources.isPending&&!sources.isError&&(adding||!sources.data?.length)&&
      <PlaylistImport pending={add.isPending} error={add.error} onImport={input=>add.mutate(input)}/>}
    {source&&<div className="live-tv-grid">
      <section className="live-tv-directory" aria-label={t("Channels")}>
        <div className="live-tv-source">
          <label htmlFor={id+'-source'}>{t("Playlist")}</label>
          <select id={id+'-source'} value={source.id} onChange={event=>choose(event.currentTarget.value)}>
            {sources.data?.map(entry=><option value={entry.id} key={entry.id}>{entry.name}</option>)}
          </select>
        </div>
        <div className="live-tv-filters">
          <input type="search" value={search} aria-label={t("Search channels")} placeholder={t("Search channels")} onChange={event=>{setSearch(event.currentTarget.value);setLimit(pageSize);}}/>
          {groups.length>0&&<select aria-label={t("Channel group")} value={group} onChange={event=>{setGroup(event.currentTarget.value);setLimit(pageSize);}}>
            <option value="">{t("All groups")}</option>
            {groups.map(value=><option value={value} key={value}>{value}</option>)}
          </select>}
        </div>
        {channels.isPending&&<p role="status">{t("Loading…")}</p>}
        {channels.isError&&<p className="error-copy" role="alert">{t(channels.error.message)}</p>}
        {channels.data&&!visible.length&&<p>{t("No matches")}</p>}
        <ul className="live-channels">
          {visible.slice(0,limit).map(({item,index})=><li key={index}><button type="button" aria-pressed={tuned===index} onClick={()=>setTuned(index)}>
            <Play size={16} aria-hidden="true"/><span>{name(item,index)}</span>
          </button></li>)}
        </ul>
        {visible.length>limit&&<Button variant="ghost" onPress={()=>setLimit(value=>value+pageSize)}>{t("Load more")}</Button>}
        <ConfirmationDialog key={source.id} triggerLabel={t("Remove playlist")} title={t("Remove playlist?")} confirmLabel={t("Remove playlist")}
          onConfirm={async()=>{await service.remove(source.id);choose(null);await client.invalidateQueries({queryKey:['iptv-sources']});}}>
          <p>{source.name}</p>
        </ConfirmationDialog>
      </section>
      <section className="live-tv-screen" aria-label={t("Live TV")}>
        {tuned!==null&&list[tuned]?
          <LivePlayback key={source.id+':'+tuned} title={name(list[tuned],tuned)} service={service} source={source.id} channel={tuned}/>:
          <div className="live-tv-placeholder"><Television size={34} aria-hidden="true"/><p>{t("Choose a channel to watch.")}</p></div>}
      </section>
    </div>}
  </div>;
}

function PlaylistImport({pending,error,onImport}:{pending:boolean;error:Error|null;onImport:(input:IptvImport)=>void}) {
  useLocale();
  const id=useId(),[mode,setMode]=useState<ImportMode>('url');
  const [name,setName]=useState(''),[url,setUrl]=useState(''),[paste,setPaste]=useState('');
  const [file,setFile]=useState<File|null>(null),[reading,setReading]=useState(false),[message,setMessage]=useState('');
  const submit=async()=>{
    setMessage('');
    const label=name.trim()||(mode==='file'?file?.name.replace(/\.m3u8?$/i,'').slice(0,120):undefined)||t("Playlist");
    if(mode==='url'){onImport({name:label,url:url.trim()});return;}
    if(mode==='paste'){onImport({name:label,text:paste});return;}
    if(!file)return;
    if(file.size>IPTV_MAX_BYTES){setMessage(t("This playlist is too large."));return;}
    setReading(true);
    try{onImport({name:label,text:await file.text()});}
    catch{setMessage(t("Could not read this playlist."));}
    finally{setReading(false);}
  };
  return <form className="live-tv-import" onSubmit={event=>{event.preventDefault();if(!pending&&!reading)void submit();}}>
    <h2>{t("Add playlist")}</h2>
    <div className="live-tv-modes" role="group" aria-label={t("Import from")}>
      {(['url','file','paste'] as const).map(value=><Button key={value} variant={mode===value?'secondary':'ghost'}
        aria-pressed={mode===value} onPress={()=>{setMode(value);setMessage('');}}>
        {value==='url'?t("Playlist link"):value==='file'?t("File"):t("Paste text")}
      </Button>)}
    </div>
    <label htmlFor={id+'-name'}>{t("Playlist name")}</label>
    <input id={id+'-name'} value={name} maxLength={120} onChange={event=>setName(event.currentTarget.value)}/>
    {mode==='url'?<>
      <label htmlFor={id+'-url'}>{t("Playlist link")}</label>
      <input id={id+'-url'} type="url" value={url} maxLength={4096} required autoComplete="off" spellCheck={false} onChange={event=>setUrl(event.currentTarget.value)}/>
    </>:mode==='file'?<>
      <label htmlFor={id+'-file'}>{t("Playlist file")}</label>
      <input id={id+'-file'} type="file" accept=".m3u,.m3u8" onChange={event=>setFile(event.currentTarget.files?.[0]??null)}/>
    </>:<>
      <label htmlFor={id+'-text'}>{t("Playlist text")}</label>
      <textarea id={id+'-text'} rows={4} value={paste} maxLength={IPTV_MAX_BYTES} required spellCheck={false} onChange={event=>setPaste(event.currentTarget.value)}/>
    </>}
    <Button type="submit" isPending={pending||reading} isDisabled={mode==='file'&&!file}>{t("Add playlist")}</Button>
    {(message||error)&&<p className="error-copy" role="alert">{message||t(error!.message)}</p>}
  </form>;
}

function LivePlayback({title,service,source,channel}:{title:string;service:LiveTvService;source:string;channel:number}) {
  useLocale();
  const ref=useRef<HTMLVideoElement>(null);
  const [attempt,setAttempt]=useState(0),[failure,setFailure]=useState('');
  const [opening,setOpening]=useState(true);
  useEffect(()=>{
    const video=ref.current!;
    let disposed=false,release:(()=>void)|undefined,hls:import('hls.js').default|undefined;
    const ready=()=>{if(!disposed){setOpening(false);void video.play().catch(()=>{});}};
    const failed=(reason?:string)=>{
      if(!disposed){release?.();release=undefined;setOpening(false);setFailure(reason||'Could not play this HLS stream.');}
    };
    const onError=()=>failed();
    video.addEventListener('loadedmetadata',ready,{once:true});
    video.addEventListener('error',onError);
    const volume=readPlaybackVolume();
    video.volume=volume.volume;video.muted=volume.muted;
    void (async()=>{
      const stream=await service.play(source,channel);
      if(disposed){stream.release?.();return;}
      release=stream.release;
      if(video.canPlayType('application/vnd.apple.mpegurl'))video.src=stream.url;
      else{
        const {default:Hls}=await import('hls.js/light');
        if(disposed)return;
        if(!Hls.isSupported()){failed('HLS playback is not available in this browser.');return;}
        const player=new Hls({lowLatencyMode:false,maxBufferLength:20});
        hls=player;
        player.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal){player.destroy();hls=undefined;failed();}});
        player.loadSource(stream.url);player.attachMedia(video);
      }
    })().catch(error=>failed(error instanceof Error?error.message:undefined));
    return()=>{
      disposed=true;hls?.destroy();release?.();
      video.removeEventListener('loadedmetadata',ready);video.removeEventListener('error',onError);
      video.pause();video.removeAttribute('src');video.load();
    };
  },[service,source,channel,attempt]);
  return <>
    <h2>{title}</h2>
    <video ref={ref} aria-label={title} controls playsInline crossOrigin="anonymous"/>
    {opening&&<p role="status">{t("Loading…")}</p>}
    {failure&&<div className="live-tv-error" role="alert"><p>{t(failure)}</p><Button variant="secondary"
      onPress={()=>{setFailure('');setOpening(true);setAttempt(value=>value+1);}}>{t("Try again")}</Button></div>}
  </>;
}
