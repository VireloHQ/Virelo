export interface PlaybackVolume { volume:number; muted:boolean; }
const STORAGE_KEY='virelo-playback-volume:v1';
let session:PlaybackVolume|undefined;
const listeners=new Set<()=>void>();

// Web Live TV runs in a same-origin frame with a separate module instance.
if(typeof window!=='undefined')window.addEventListener?.('storage',event=>{
  if(event.storageArea!==window.localStorage||(event.key!==STORAGE_KEY&&event.key!==null))return;
  session=undefined;
  for(const listener of listeners)listener();
});

export function readPlaybackVolume():PlaybackVolume {
  if(session)return session;
  try {
    const saved=JSON.parse(window.localStorage.getItem(STORAGE_KEY)||'null');
    if(saved&&typeof saved.volume==='number'&&Number.isFinite(saved.volume)&&typeof saved.muted==='boolean') {
      return session={volume:Math.max(0,Math.min(1,saved.volume)),muted:saved.muted};
    }
  } catch { /* Blocked storage or old invalid data: use a safe default. */ }
  return session={volume:1,muted:false};
}

export function savePlaybackVolume(update:Partial<PlaybackVolume>) {
  const previous=readPlaybackVolume();
  const volume=update.volume===undefined?previous.volume:Math.max(0,Math.min(1,update.volume));
  if(!Number.isFinite(volume))return;
  const muted=update.muted??previous.muted;
  if(previous.volume===volume&&previous.muted===muted)return;
  session={volume,muted};
  try { window.localStorage.setItem(STORAGE_KEY,JSON.stringify(session)); }
  catch { /* Keep the session choice even when storage is blocked. */ }
  for(const listener of listeners)listener();
}

export function subscribePlaybackVolume(listener:()=>void) {
  listeners.add(listener);
  return ()=>{listeners.delete(listener);};
}
