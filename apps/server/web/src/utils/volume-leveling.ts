export const LEVELING_KEY='virelo-volume-leveling:v1';
export const LEVELING_MAX_BOOST_DB=0;
export function supportsVolumeLeveling(userAgent:string,platform='',touches=0){
  // Native WebKit HLS cannot reliably feed MediaElementAudioSourceNode (WebKit bug 306493).
  return !(/AppleWebKit/.test(userAgent)&&(!/(?:Chrome|Chromium|Edg|OPR)\//.test(userAgent)||/iP(?:hone|ad|od)/.test(userAgent)||platform==='MacIntel'&&touches>1));
}
export function canLevelAudio(){return typeof AudioContext!=='undefined'&&supportsVolumeLeveling(navigator.userAgent,navigator.platform,navigator.maxTouchPoints);}
let preference:boolean|undefined;
const listeners=new Set<()=>void>();
export function readLevelingPreference(){
  if(preference!==undefined)return preference;
  try{return preference=localStorage.getItem(LEVELING_KEY)==='true';}catch{return preference=false;}
}
export function saveLevelingPreference(value:boolean){
  preference=value;
  try{localStorage.setItem(LEVELING_KEY,String(value));}catch{/* Keep the current device-session preference. */}
  for(const listener of listeners)listener();
}
function storage(event:StorageEvent){if(event.key===LEVELING_KEY){preference=undefined;for(const listener of listeners)listener();}}
export function subscribeLeveling(listener:()=>void){
  if(!listeners.size)window.addEventListener('storage',storage);
  listeners.add(listener);
  return()=>{listeners.delete(listener);if(!listeners.size)window.removeEventListener('storage',storage);};
}
// The live detector only attenuates; measured recordings use one constant gain.
export function levelingGainDb(level:number,peak?:number):number|null {
  if(!Number.isFinite(level)||peak!==undefined&&!Number.isFinite(peak)||level < -55)return null;
  return Math.max(-24,Math.min(LEVELING_MAX_BOOST_DB,-18-level,peak===undefined?Infinity:-3-peak));
}

export interface AudioLoudness { integratedLufs:number; truePeakDb:number; }
export interface AudioLoudnessAnalysis {
  version:1;
  size:number;
  mtime:number;
  defaultAudioStream:number|null;
  tracks:Array<{index:number;loudness:AudioLoudness|null}>;
}

export function measuredLevelingGainDb(value?:AudioLoudness|null):number|null {
  if(!value||!Number.isFinite(value.integratedLufs)||!Number.isFinite(value.truePeakDb)
    ||value.integratedLufs < -100||value.integratedLufs > 20||value.truePeakDb < -120||value.truePeakDb > 20)return null;
  return Math.min(0,-18-value.integratedLufs,-3-value.truePeakDb);
}

export function readAudioAnalysis(value:unknown,size:number,mtime:number):AudioLoudnessAnalysis|null {
  if(typeof value!=='string'||value.length>65536)return null;
  try {
    const data=JSON.parse(value) as AudioLoudnessAnalysis;
    if(data?.version!==1||data.size!==size||data.mtime!==mtime||!Array.isArray(data.tracks)||data.tracks.length>64
      ||!data.tracks.every(track=>track&&Number.isSafeInteger(track.index)&&track.index>=0&&(track.loudness===null||measuredLevelingGainDb(track.loudness)!==null))
      ||new Set(data.tracks.map(track=>track.index)).size!==data.tracks.length
      ||(data.tracks.length?!data.tracks.some(track=>track.index===data.defaultAudioStream):data.defaultAudioStream!==null))return null;
    return data;
  }catch{return null;}
}

export function audioMeasurement(value:unknown,size:number,mtime:number,stream?:number|null):AudioLoudness|null {
  const data=readAudioAnalysis(value,size,mtime);
  return data?.tracks.find(track=>track.index===(stream??data.defaultAudioStream))?.loudness??null;
}
