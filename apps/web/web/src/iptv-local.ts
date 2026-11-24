import { IPTV_CHECK_TIMEOUT_MS,IPTV_MAX_BYTES,IPTV_MAX_SOURCES,iptvUrl,parseIptvChannels,sniffIptvManifest,type IptvChannel,type IptvSourceInfo } from '@virelo/core/iptv';
import type { LiveTvService } from '@virelo/web-ui/components/LiveTv.tsx';

function open() {
  return new Promise<IDBDatabase>((resolve,reject)=>{
    const request=indexedDB.open('virelo-live-tv',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('sources',{keyPath:'id'});
      request.result.createObjectStore('channels');
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Could not open browser storage.'));
  });
}
async function read<T>(store:string,id?:string) {
  const db=await open();
  try{return await new Promise<T>((resolve,reject)=>{
    const object=db.transaction(store).objectStore(store);
    const request=id===undefined?object.getAll():object.get(id);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error('Could not open browser storage.'));
  });}finally{db.close();}
}
async function change(source:IptvSourceInfo,channels?:IptvChannel[]) {
  const db=await open();
  try{await new Promise<void>((resolve,reject)=>{
    const transaction=db.transaction(['sources','channels'],'readwrite');
    const sources=transaction.objectStore('sources'),entries=transaction.objectStore('channels');
    let full=false;
    transaction.oncomplete=()=>resolve();
    transaction.onabort=()=>reject(new Error(full?'Remove a playlist before adding another.':'Could not open browser storage.'));
    if(channels){
      const count=sources.count();
      count.onsuccess=()=>{
        if(count.result>=IPTV_MAX_SOURCES){full=true;transaction.abort();return;}
        sources.add(source);entries.add(channels,source.id);
      };
    }else {sources.delete(source.id);entries.delete(source.id);}
  });}finally{db.close();}
}
async function fetchPlaylist(value:string){
  const url=iptvUrl(value);
  if(!url)throw new Error('Enter an HTTPS playlist link.');
  const error=()=>new Error('Could not load this playlist. Check that the server allows browser access.');
  const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',signal:AbortSignal.timeout(20000)}).catch(()=>{throw error();});
  const final=iptvUrl(response.url),reader=response.body?.getReader();
  if(!response.ok||!final||!reader){await reader?.cancel();throw error();}
  const decoder=new TextDecoder();
  let text='',bytes=0;
  try{
    for(;;){
      const {done,value}=await reader.read().catch(()=>{throw error();});
      if(done)break;
      if((bytes+=value.length)>IPTV_MAX_BYTES)throw new Error('This playlist is too large.');
      text+=decoder.decode(value,{stream:true});
    }
    return {text:text+decoder.decode(),url:final.href};
  }finally{await reader.cancel().catch(()=>{});}
}
const channels=(id:string)=>read<IptvChannel[]|undefined>('channels',id);
// Reuse the IndexedDB read for the lifetime of the check, not across playlist sessions.
const checkLists=new WeakMap<AbortSignal,{id:string;list:Promise<IptvChannel[]|undefined>}>();
export const localLiveTv:LiveTvService={
  sources:()=>read<IptvSourceInfo[]>('sources'),
  channels:async id=>(await channels(id)??[]).map(({name,groups})=>({name,groups})),
  add:async input=>{
    const loaded=input.url?await fetchPlaylist(input.url):{text:input.text??'',url:undefined};
    const source={id:crypto.randomUUID(),name:input.name};
    await change(source,parseIptvChannels(loaded.text,source.name,loaded.url));
    return source;
  },
  remove:id=>change({id,name:''}),
  check:async (id,index,signal)=>{
    let stored=checkLists.get(signal);
    if(stored?.id!==id){
      stored={id,list:channels(id)};
      checkLists.set(signal,stored);
    }
    const channel=(await stored.list)?.[index];
    signal.throwIfAborted();
    const url=channel&&iptvUrl(channel.url);
    if(!url)return {status:'unavailable'};
    const started=performance.now();
    try{
      const response=await fetch(url,{credentials:'omit',referrerPolicy:'no-referrer',cache:'no-store',
        signal:AbortSignal.any([signal,AbortSignal.timeout(IPTV_CHECK_TIMEOUT_MS)])});
      const reader=response.body?.getReader();
      try{
        if(!response.ok||!iptvUrl(response.url)||!reader||!await sniffIptvManifest(async()=>(await reader.read()).value))
          return {status:'unavailable'};
        return {status:'responding',milliseconds:Math.max(1,Math.round(performance.now()-started))};
      }finally{void reader?.cancel().catch(()=>{});}
    }catch{return {status:'unconfirmed'};}
  },
  play:async (id,index)=>{
    const channel=(await channels(id))?.[index];
    if(!channel)throw new Error('Playlist not found.');
    return {url:channel.url};
  }
};
