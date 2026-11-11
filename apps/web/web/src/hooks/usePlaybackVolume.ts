import { useSyncExternalStore } from 'react';
import { readPlaybackVolume, savePlaybackVolume, subscribePlaybackVolume } from '../utils/playback-volume';

const setVolume=(volume:number)=>savePlaybackVolume({volume});
const setMuted=(value:boolean|((muted:boolean)=>boolean))=>savePlaybackVolume({
  muted:typeof value==='function'?value(readPlaybackVolume().muted):value
});

export function usePlaybackVolume() {
  const preference=useSyncExternalStore(subscribePlaybackVolume,readPlaybackVolume);
  return {...preference,setVolume,setMuted};
}
