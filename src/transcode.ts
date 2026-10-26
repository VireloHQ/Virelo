import { readFile, rename, rm, stat } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import { hasFfmpeg, type PlaybackQuality } from './ffmpeg.js';
import { runMediaProcess } from './media-process.js';
import { demandStatus, startDemand, stopDemandPlayback } from './demand-playback.js';
import { prepareGeneratedFile } from './image-files.js';

export interface TranscodeOptions { audioStream?:number;copyVideo?:boolean;startTime?:number;duration?:number|null; }
export interface AdaptiveTranscodeOptions extends TranscodeOptions {hasAudio:boolean;sourceWidth:number;sourceHeight:number;qualities:PlaybackQuality[];}
export type TranscodeState=ReturnType<typeof demandStatus>;
export type AdaptiveTranscodeState=TranscodeState;
export type AudioTranscodeState=TranscodeState;
export function hlsDir(dataDir:string,id:number){return join(dataDir,'cache','hls',String(id));}
export function hlsVariantDir(dataDir:string,id:number,audioStream?:number,startTime=0){return join(hlsDir(dataDir,id),...(startTime>0?['seek',String(startTime)]:[]),audioStream===undefined?'default':`audio-${audioStream}`);}
export function hlsPlaylist(dataDir:string,id:number,audioStream?:number,startTime=0){return join(hlsVariantDir(dataDir,id,audioStream,startTime),'index.m3u8');}
export function transcodeStatus(dataDir:string,id:number,audioStream?:number,_startTime=0){return demandStatus(dataDir,id,'compatible',audioStream);}
export function adaptiveTranscodeStatus(dataDir:string,id:number,audioStream:number|undefined,_qualities:PlaybackQuality[],_startTime=0){return demandStatus(dataDir,id,'adaptive',audioStream);}
export function audioTranscodeStatus(dataDir:string,id:number,audioStream:number){return demandStatus(dataDir,id,'audio',audioStream);}
export function startHlsTranscode(dataDir:string,id:number,source:string,options:TranscodeOptions={}){return startDemand(dataDir,id,source,{...options,mode:'compatible'});}
export function startAdaptiveTranscode(dataDir:string,id:number,source:string,options:AdaptiveTranscodeOptions){return startDemand(dataDir,id,source,{...options,mode:'adaptive'});}
export function startAudioTranscode(dataDir:string,id:number,source:string,audioStream:number,duration?:number|null){return startDemand(dataDir,id,source,{mode:'audio',audioStream,duration});}

// Text subtitles are small, independent of the short video segment cache.
const subtitleJobs=new Map<string,Promise<void>>();
export async function extractSubtitleVtt(dataDir:string,id:number,source:string,subtitleStream:number,owner='system') {
  const info=await stat(source),stamp=createHash('sha256').update(`${source}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0,16);
  const target=join(hlsDir(dataDir,id),'subtitles',stamp,`${subtitleStream}.vtt`);
  let job=subtitleJobs.get(target);
  if(!job){
    job=(async()=>{
      await prepareGeneratedFile(target,join(dataDir,'cache'));
      if((await readFile(target,'utf8').catch(()=>'')).startsWith('WEBVTT'))return;
      if(!(await hasFfmpeg()))throw Error('FFmpeg is not installed or not available in PATH.');
      const temporary=`${target}.${randomUUID()}.tmp`;
      try{
        await runMediaProcess(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','warning','-threads','2','-i',source,'-map',`0:${subtitleStream}`,'-c:s','webvtt','-f','webvtt','-y',temporary],{kind:'video',owner,scope:resolve(dataDir),timeout:60000});
        if(!(await readFile(temporary,'utf8')).startsWith('WEBVTT'))throw Error('Subtitle conversion failed.');
        await prepareGeneratedFile(target,join(dataDir,'cache'));await rename(temporary,target);
      }finally{await rm(temporary,{force:true}).catch(()=>{});}
    })();
    subtitleJobs.set(target,job);
  }
  try{await job;}finally{if(subtitleJobs.get(target)===job)subtitleJobs.delete(target);}
  return {path:target,url:`/hls/${id}/subtitles/${stamp}/${subtitleStream}.vtt`};
}
export function stopAllTranscodes(dataDir?:string){return stopDemandPlayback(dataDir);}
