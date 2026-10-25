import { createHash } from 'node:crypto';
import { stat, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { hasFfmpeg, probeMedia, type PlaybackQuality } from './ffmpeg.js';
import { DemandCache, SEGMENT_MAX_BYTES } from './demand-cache.js';
import { prepareGeneratedFile } from './image-files.js';

export const SEGMENT_SECONDS=2;
type Mode='compatible'|'adaptive'|'audio';
type Options={mode:Mode;audioStream?:number;duration?:number|null;sourceWidth?:number;sourceHeight?:number;qualities?:PlaybackQuality[]};
type Spec=Options&{source:string;duration:number;id:number;prefix:string;root:string;fingerprint:string};
type Job={controller:AbortController;child?:ChildProcess;promise:Promise<string>};
const specs=new Map<string,Spec>(),errors=new Map<string,string>(),managers=new Map<string,Manager>();
const specKey=(root:string,id:number,mode:Mode,audioStream?:number)=>`${resolve(root)}:${id}:${mode}:${audioStream??'default'}`;
const managerFor=(root:string)=>{const key=resolve(root);let manager=managers.get(key);if(!manager){const setting=Number(process.env.VIRELO_CACHE_MAX_MB??512);const limit=(Number.isFinite(setting)?Math.max(128,Math.min(65536,setting)):512)*1024*1024;manager=new Manager(key,limit);managers.set(key,manager);}return manager;};

export function mediaPlaylist(duration:number){
  if(!Number.isFinite(duration)||duration<=0||duration>7*86400)throw Error('Video duration is unavailable or exceeds seven days.');
  const lines=['#EXTM3U','#EXT-X-VERSION:3',`#EXT-X-TARGETDURATION:${SEGMENT_SECONDS}`,'#EXT-X-MEDIA-SEQUENCE:0','#EXT-X-PLAYLIST-TYPE:VOD','#EXT-X-INDEPENDENT-SEGMENTS'];
  for(let index=0;index*SEGMENT_SECONDS<duration;index++)lines.push(`#EXTINF:${Math.min(SEGMENT_SECONDS,duration-index*SEGMENT_SECONDS).toFixed(6)},`,`segment-${index}.ts`);
  return lines.concat('#EXT-X-ENDLIST','').join('\n');
}
export function demandStatus(dataDir:string,id:number,mode:Mode,audioStream?:number){
  const key=specKey(dataDir,id,mode,audioStream),spec=specs.get(key);
  const variants=spec?.qualities?.map(quality=>({...quality,url:`${spec.prefix}/${quality.height}/index.m3u8`}))??[];
  if(errors.has(key))return {status:'error' as const,error:errors.get(key),playlist:'',url:'',variants};
  if(!spec)return {status:'idle' as const,playlist:'',url:'',variants};
  const playlist=`${spec.prefix}/${mode==='adaptive'?'master':'index'}.m3u8`;
  // Ready means the full timeline is addressable, not that a film was encoded.
  return {status:'ready' as const,playlist,url:playlist,variants,startTime:0,bufferedUntil:spec.duration,complete:true};
}
export async function startDemand(dataDir:string,id:number,source:string,options:Options){
  const key=specKey(dataDir,id,options.mode,options.audioStream);
  try{
    if(!(await hasFfmpeg()))throw Error('FFmpeg is not installed or not available in PATH.');
    const info=await stat(source),duration=options.duration??(await probeMedia(source))?.duration;
    if(!duration)throw Error('Video duration could not be inspected.');mediaPlaylist(duration);
    if(options.mode==='adaptive'&&!options.qualities?.length)throw Error('Video resolution could not be detected.');
    const fingerprint=createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}:segments-v2:${SEGMENT_SECONDS}`).digest('hex').slice(0,16);
    const prefix=`/playback/${id}/${fingerprint}/${options.mode}/${options.audioStream??'default'}`;
    specs.set(key,{...options,source,duration,id,prefix,root:resolve(dataDir),fingerprint});errors.delete(key);
    await managerFor(dataDir).cache.prune();return demandStatus(dataDir,id,options.mode,options.audioStream);
  }catch(reason){errors.set(key,reason instanceof Error?reason.message:'Playback preparation failed.');return demandStatus(dataDir,id,options.mode,options.audioStream);}
}
function findSpec(dataDir:string,prefix:string){return [...specs.values()].find(spec=>spec.root===resolve(dataDir)&&spec.prefix===prefix);}
export function demandManifest(dataDir:string,prefix:string,resource:string){
  const spec=findSpec(dataDir,prefix);if(!spec)return null;
  if(resource==='master.m3u8'&&spec.mode==='adaptive'){
    const landscape=(spec.sourceWidth??1)>=(spec.sourceHeight??1),ratio=(spec.sourceWidth??1)/(spec.sourceHeight??1);
    return ['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-INDEPENDENT-SEGMENTS',...spec.qualities!.flatMap(quality=>{
      const width=landscape?Math.round(quality.height*ratio/2)*2:quality.height,height=landscape?quality.height:Math.round(quality.height/ratio/2)*2;
      return [`#EXT-X-STREAM-INF:BANDWIDTH=${quality.bitrate+192000},RESOLUTION=${width}x${height}`,`${quality.height}/index.m3u8`];
    }),''].join('\n');
  }
  if(resource==='index.m3u8'&&spec.mode!=='adaptive')return mediaPlaylist(spec.duration);
  if(spec.mode==='adaptive'&&spec.qualities!.some(quality=>resource===`${quality.height}/index.m3u8`))return mediaPlaylist(spec.duration);
  return null;
}
export async function demandSegment(dataDir:string,prefix:string,resource:string,signal:AbortSignal){
  const spec=findSpec(dataDir,prefix);if(!spec)throw Error('Playback session is unavailable.');
  const match=resource.match(/^(?:(\d+)\/)?segment-(\d+)\.ts$/);if(!match)throw Error('Invalid segment.');
  const index=Number(match[2]),height=match[1]===undefined?undefined:Number(match[1]);
  if(!Number.isSafeInteger(index)||index<0||index*SEGMENT_SECONDS>=spec.duration)throw Error('Invalid segment.');
  const quality=spec.qualities?.find(candidate=>candidate.height===height);
  if((spec.mode==='adaptive'&&!quality)||(spec.mode!=='adaptive'&&height!==undefined))throw Error('Invalid rendition.');
  return managerFor(dataDir).segment(spec,index,quality,signal);
}
class Manager {
  readonly cache:DemandCache;
  private jobs=new Map<string,Job>();
  private queue:Array<()=>void>=[];
  private running=0;
  constructor(readonly root:string,limit:number){this.cache=new DemandCache(root,limit);}
  private pump(){while(this.running<2&&this.queue.length){this.running++;this.queue.shift()!();}}
  async segment(spec:Spec,index:number,quality:PlaybackQuality|undefined,signal:AbortSignal){
    const path=join(this.cache.root,'segments-v2',String(spec.id),spec.fingerprint,spec.mode,String(spec.audioStream??'default'),String(quality?.height??'original'),`segment-${index}.ts`);
    const unpin=this.cache.pin(path);let released=false;
    const release=()=>{if(released)return;released=true;unpin();};
    if(signal.aborted){release();throw Error('Playback request was cancelled.');}
    try{
      if(await this.cache.lookup(path))return {path,release};
      let job=this.jobs.get(path);
      if(!job){
        if(this.queue.length>=16)throw Error('Too many playback requests.');
        const controller=new AbortController();let done:(path:string)=>void=()=>{},fail:(reason:unknown)=>void=()=>{};
        const promise=new Promise<string>((res,rej)=>{done=res;fail=rej;});job={controller,promise};this.jobs.set(path,job);
        const current=job;
        this.queue.push(()=>{void this.encode(spec,index,quality,path,current).then(done,fail).finally(()=>{this.jobs.delete(path);this.running--;this.pump();});});this.pump();
      }
      const current=job;let abortReject:(reason:Error)=>void=()=>{};
      const abortPromise=new Promise<never>((_res,rej)=>{abortReject=rej;});
      const aborted=()=>{release();if(!this.cache.isPinned(path)){current.controller.abort();current.child?.kill('SIGTERM');}abortReject(Error('Playback request was cancelled.'));};
      signal.addEventListener('abort',aborted,{once:true});
      try{if(signal.aborted)aborted();await Promise.race([current.promise,abortPromise]);}
      finally{signal.removeEventListener('abort',aborted);}
      return {path,release};
    }catch(reason){release();throw reason;}
  }
  private async encode(spec:Spec,index:number,quality:PlaybackQuality|undefined,path:string,job:Job){
    const temporary=path+'.part',start=index*SEGMENT_SECONDS;
    try{
      if(job.controller.signal.aborted)throw Error('Playback request was cancelled.');
      await this.cache.prune(2*SEGMENT_MAX_BYTES);
      await prepareGeneratedFile(temporary,this.cache.root);await prepareGeneratedFile(path,this.cache.root);
      const args=['-hide_banner','-loglevel','error','-ss',String(start),'-i',spec.source,'-t',String(Math.min(SEGMENT_SECONDS,spec.duration-start))];
      if(spec.mode==='audio')args.push('-vn');
      else{
        args.push('-map','0:v:0','-c:v','libx264','-preset','veryfast','-threads','2','-pix_fmt','yuv420p','-bf','0','-sc_threshold','0');
        if(quality){const landscape=(spec.sourceWidth??1)>=(spec.sourceHeight??1);args.push('-vf',landscape?`scale=-2:${quality.height}`:`scale=${quality.height}:-2`,'-b:v',String(quality.bitrate),'-maxrate',String(Math.round(quality.bitrate*1.08)),'-bufsize',String(quality.bitrate*2));}
        else args.push('-crf','21');
      }
      args.push('-map',spec.audioStream===undefined?'0:a:0?':`0:${spec.audioStream}`,'-c:a','aac','-b:a','192k','-ac','2','-af','aresample=async=1:first_pts=0','-output_ts_offset',String(start),'-muxdelay','0','-f','mpegts','-fs',String(SEGMENT_MAX_BYTES),'-y',temporary);
      await new Promise<void>((res,rej)=>{
        if(job.controller.signal.aborted){rej(Error('Playback request was cancelled.'));return;}
        const child=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{windowsHide:true});job.child=child;let error='';
        const timer=setTimeout(()=>{child.kill('SIGTERM');},45000);timer.unref();
        child.stderr?.on('data',chunk=>{error=(error+String(chunk)).slice(-1000);});
        child.once('error',reason=>{clearTimeout(timer);rej(reason);});
        child.once('exit',code=>{clearTimeout(timer);if(code===0&&!job.controller.signal.aborted)res();else rej(Error(error||'Playback segment conversion failed or was cancelled.'));});
      });
      const info=await stat(temporary);if(!info.size||info.size>=SEGMENT_MAX_BYTES)throw Error('Playback segment exceeds the size limit.');
      await rename(temporary,path);await this.cache.record(path);return path;
    }finally{await rm(temporary,{force:true}).catch(()=>{});}
  }
  async stop(){const jobs=[...this.jobs.values()];for(const job of jobs){job.controller.abort();job.child?.kill('SIGTERM');}this.pump();await Promise.allSettled(jobs.map(job=>job.promise));}
}
export async function stopDemandPlayback(dataDir?:string){await Promise.all([...managers].filter(([root])=>!dataDir||root===resolve(dataDir)).map(([,manager])=>manager.stop()));}
export function initializeDemandCache(dataDir:string){return managerFor(dataDir).cache.prune();}
export function playbackCacheLimit(dataDir:string){return managerFor(dataDir).cache.limit;}
export function clearPlaybackCache(dataDir:string,authorize:()=>void){return managerFor(dataDir).cache.clearUnused(authorize);}
