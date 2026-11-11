import { statSync, type Stats } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runMediaProcessInSlot } from './media-process.js';
import { mediaScheduler } from './media-work.js';
import { resolveLibraryFile } from './media-files.js';
import type { VireloDB } from './db.js';
import type { CatalogScope } from './auth-types.js';
import type { MediaRecord, ScanStatus } from './types.js';

// Playlists can reference files outside the granted library even with file-only protocols.
const INPUT_RESTRICTIONS=['-protocol_whitelist','file,pipe','-format_whitelist','mov,matroska,webm,avi,asf,mpeg,mpegts,mpegvideo,flv,ogg'];

function validLoudness(integratedLufs:unknown,truePeakDb:unknown):boolean {
  return typeof integratedLufs==='number'&&Number.isFinite(integratedLufs)&&integratedLufs>=-100&&integratedLufs<=20
    &&typeof truePeakDb==='number'&&Number.isFinite(truePeakDb)&&truePeakDb>=-120&&truePeakDb<=20;
}

function reportNumber(value:unknown):number {
  return typeof value==='number'||typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value)?Number(value):NaN;
}

export function parseLoudnessReport(report:string) {
  // loudnorm emits its report at EOF; ignore earlier JSON embedded in input metadata.
  const start=[...report.matchAll(/\{\s*"input_i"\s*:/g)].at(-1)?.index;
  const json=start===undefined?undefined:report.slice(start).match(/^\{[\s\S]*?\}/)?.[0];
  if(!json)throw new Error('Audio analysis did not return a loudness measurement.');
  const data=JSON.parse(json);
  const integratedLufs=reportNumber(data.input_i),truePeakDb=reportNumber(data.input_tp);
  // Silence, below-gate audio and clips shorter than an integration block have no LUFS.
  if(data.input_i==='-inf'&&(data.input_tp==='-inf'||validLoudness(-70,truePeakDb)))return null;
  if(!validLoudness(integratedLufs,truePeakDb))
    throw new Error('Audio analysis returned an invalid loudness measurement.');
  return {integratedLufs,truePeakDb};
}

function currentAnalysis(media:MediaRecord) {
  if(typeof media.audio_loudness!=='string'||media.audio_loudness.length>65536)return false;
  try {
    const data=JSON.parse(media.audio_loudness);
    if(data?.version!==1||data.size!==media.size||data.mtime!==media.mtime||!Array.isArray(data.tracks)||data.tracks.length>64)return false;
    const indexes=new Set<number>();
    for(const track of data.tracks) {
      if(!track||!Number.isSafeInteger(track.index)||track.index<0||indexes.has(track.index))return false;
      indexes.add(track.index);
      if(track.loudness!==null&&(!track.loudness||!validLoudness(track.loudness.integratedLufs,track.loudness.truePeakDb)))return false;
    }
    return data.tracks.length===0?data.defaultAudioStream===null:indexes.has(data.defaultAudioStream);
  }catch{return false;}
}

export async function analyzeAudio(path:string,duration:number|null,dataDir:string,signal?:AbortSignal,verifySource?:()=>void) {
  signal?.throwIfAborted();
  path=resolve(path);
  const work={kind:'background' as const,owner:'scan',scope:resolve(dataDir),signal};
  const run=(command:string,args:string[],timeout:number)=>mediaScheduler.run(slotSignal=>{
    verifySource?.();slotSignal.throwIfAborted();
    return runMediaProcessInSlot(command,args,{signal:slotSignal,timeout});
  },work);
  let streams:Array<{index:number;disposition?:{default?:number}}>;
  try {
    const result=await run(process.env.FFPROBE_PATH||'ffprobe',[
      '-v','error','-threads','2',...INPUT_RESTRICTIONS,
      '-select_streams','a','-show_entries','stream=index:stream_disposition=default','-of','json',path
    ],30000);
    streams=JSON.parse(result.stdout.toString('utf8')).streams;
  }catch(error){
    if(signal?.aborted||error instanceof SourceChangedError)throw error;
    throw new Error('ffprobe is required for audio analysis.');
  }
  signal?.throwIfAborted();
  if(!Array.isArray(streams))throw new Error('Audio analysis returned an invalid loudness measurement.');
  const indexes=streams.map(track=>track?.index);
  if(indexes.length>64)throw new Error('Too many audio tracks to analyze.');
  if(indexes.some(index=>!Number.isSafeInteger(index)||index<0)||new Set(indexes).size!==indexes.length)
    throw new Error('Audio analysis returned an invalid loudness measurement.');
  const seconds=typeof duration==='number'&&Number.isFinite(duration)&&duration>0?duration:3600;
  const tracks=[];
  for(const index of indexes) {
    signal?.throwIfAborted();
    const result=await run(process.env.FFMPEG_PATH||'ffmpeg',[
      '-nostdin','-nostats','-hide_banner','-loglevel','info','-threads','2','-filter_threads','1',
      ...INPUT_RESTRICTIONS,'-i',path,'-map',`0:${index}`,'-vn','-sn','-dn',
      '-map_metadata','-1','-map_chapters','-1',
      '-af','loudnorm=I=-18:TP=-3:LRA=11:print_format=json','-threads','2','-f','null','-'
    ],Math.min(6*60*60*1000,Math.max(120000,seconds*4000)));
    signal?.throwIfAborted();
    tracks.push({index,loudness:parseLoudnessReport(result.stderr)});
  }
  return {defaultAudioStream:(streams.find(track=>track.disposition?.default===1)??streams[0])?.index??null,tracks};
}

class SourceChangedError extends Error {}
function sameSource(before:Stats,after:Stats):boolean {
  return after.isFile()&&after.size===before.size&&after.mtimeMs===before.mtimeMs&&after.ctimeMs===before.ctimeMs&&after.ino===before.ino&&after.dev===before.dev;
}

export async function scanAudioLoudness(db:VireloDB,dataDir:string,status:ScanStatus,scope?:CatalogScope,signal?:AbortSignal) {
  if(signal?.aborted||!db.getSettings().audioAnalysisEnabled)return;
  const pending:number[]=[];
  for(const library of db.visibleLibraries(scope)) {
    const rows=db.db.prepare('SELECT * FROM media WHERE library_id=? ORDER BY id').all(library.id) as unknown as MediaRecord[];
    for(const media of rows) {
      if(currentAnalysis(media))continue;
      const path=resolveLibraryFile(media.path,library.path);
      if(path&&db.libraryForPath(path)?.id===library.id)pending.push(media.id);
    }
  }
  status.audioTotal=pending.length;status.audioAnalyzed=0;
  for(const id of pending) {
    if(signal?.aborted||!db.getSettings().audioAnalysisEnabled)return;
    try {
      const media=db.getMedia(id,scope);
      if(!media||currentAnalysis(media))continue;
      const approvedLibrary=db.visibleLibraries(scope).find(item=>item.id===media.library_id);
      const path=approvedLibrary&&resolveLibraryFile(media.path,approvedLibrary.path);
      if(!path||db.libraryForPath(path)?.id!==media.library_id)continue;
      const before=await stat(path);
      if(signal?.aborted||!db.getSettings().audioAnalysisEnabled)return;
      if(!before.isFile()||before.size!==media.size||Math.trunc(before.mtimeMs)!==media.mtime)continue;
      status.message=`Analyzing audio · ${media.filename}`;
      const controller=new AbortController(),abort=()=>controller.abort();
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted||!db.getSettings().audioAnalysisEnabled)controller.abort();
      // Disabling the option also cancels a long-running measurement.
      const timer=setInterval(()=>{if(!db.getSettings().audioAnalysisEnabled)controller.abort();},250);
      const verifySource=()=>{
        const library=db.visibleLibraries(scope).find(item=>item.id===media.library_id);
        if(!library||resolveLibraryFile(media.path,library.path)!==path||db.libraryForPath(path)?.id!==media.library_id)
          throw new SourceChangedError();
        try { if(!sameSource(before,statSync(path)))throw new SourceChangedError(); }
        catch { throw new SourceChangedError(); }
      };
      let measurement;
      try { measurement=await analyzeAudio(path,media.duration,dataDir,controller.signal,verifySource); }
      finally { clearInterval(timer);signal?.removeEventListener('abort',abort); }
      if(controller.signal.aborted||signal?.aborted||!db.getSettings().audioAnalysisEnabled)continue;
      verifySource();
      if(!db.getMedia(media.id,scope))continue;
      db.db.prepare('UPDATE media SET audio_loudness=? WHERE id=? AND library_id=? AND path=? AND size=? AND mtime=?')
        .run(JSON.stringify({version:1,size:media.size,mtime:media.mtime,...measurement}),media.id,media.library_id,media.path,media.size,media.mtime);
    }catch(error) {
      if(signal?.aborted||!db.getSettings().audioAnalysisEnabled)return;
      if(!(error instanceof SourceChangedError))status.errors++;
    }finally { status.audioAnalyzed=(status.audioAnalyzed??0)+1; }
  }
}
