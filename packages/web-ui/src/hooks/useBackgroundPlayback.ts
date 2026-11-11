import { useEffect, useRef, type RefObject } from 'react';

interface BackgroundPlaybackOptions {
  active?: boolean;
  transition?: RefObject<boolean>;
  resume: () => void;
  play: () => void;
  pause: () => void;
}

export function useBackgroundPlayback(
  mediaId:number,
  videoRef:RefObject<HTMLVideoElement|null>,
  intent:RefObject<boolean>,
  options:BackgroundPlaybackOptions
){
  const suspended=useRef(false);
  const latest=useRef(options);
  latest.current=options;
  const active=options.active??true;

  useEffect(()=>{
    suspended.current=false;
    if(!active)return;
    const foreground=()=>{
      const video=videoRef.current;
      if(document.hidden||!suspended.current||!intent.current||!video||video.ended||latest.current.transition?.current)return;
      latest.current.resume();
    };
    const session=navigator.mediaSession;
    // Explicit media-key pauses must not be mistaken for browser background suspension.
    if(session){
      session.setActionHandler('play',()=>latest.current.play());
      session.setActionHandler('pause',()=>{latest.current.pause();suspended.current=false;});
    }
    document.addEventListener('visibilitychange',foreground);
    window.addEventListener('pageshow',foreground);
    return()=>{
      document.removeEventListener('visibilitychange',foreground);
      window.removeEventListener('pageshow',foreground);
      suspended.current=false;
      if(session){session.setActionHandler('play',null);session.setActionHandler('pause',null);}
    };
  },[mediaId,active,videoRef,intent]);

  function handlePause(video:HTMLVideoElement){
    if(active&&document.hidden&&intent.current&&!options.transition?.current&&!video.ended){
      suspended.current=true;
      return true;
    }
    return false;
  }
  function audioIsClock(){
    return suspended.current&&intent.current&&!options.transition?.current;
  }
  return {suspended,handlePause,audioIsClock};
}
