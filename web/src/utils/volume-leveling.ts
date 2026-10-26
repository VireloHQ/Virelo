export const LEVELING_KEY='virelo-volume-leveling:v1';
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
// shortcut: live stereo estimation; use full-file EBU R128 analysis when exact integrated LUFS is needed.
export function levelingGainDb(level:number,peak:number):number|null {
  if(!Number.isFinite(level)||!Number.isFinite(peak)||level < -55)return null;
  return Math.max(-24,Math.min(12,-18-level,-3-peak));
}
export function signalLevel(channels:Float32Array[],volume=1) {
  let energy=0,peak=0;
  for(const samples of channels){let sum=0;for(const sample of samples){sum+=sample*sample;peak=Math.max(peak,Math.abs(sample));}energy+=sum/Math.max(1,samples.length);}
  const manual=Math.max(.001,volume);
  return {level:-.691+10*Math.log10(energy/(manual*manual)),peak:20*Math.log10(peak/manual)};
}
