import { useEffect, type RefObject } from 'react';
import type { PlaybackActivity } from '../../../src/auth-types';

let readPlayback:(()=>PlaybackActivity)|null=null;
export const playbackActivity=()=>readPlayback?.()??{mediaId:null,state:'idle' as const,position:0};
export function usePlaybackActivity(mediaId:number,playing:boolean,video:RefObject<HTMLVideoElement|null>) {
  useEffect(()=>{
    const read=():PlaybackActivity=>video.current?.ended?{mediaId:null,state:'idle',position:0}:{mediaId,state:playing?'playing':'paused',position:Math.max(0,video.current?.currentTime??0)};
    readPlayback=read;window.dispatchEvent(new Event('virelo-activity-change'));
    return ()=>{if(readPlayback===read){readPlayback=null;window.dispatchEvent(new Event('virelo-activity-change'));}};
  },[mediaId,playing,video]);
}
