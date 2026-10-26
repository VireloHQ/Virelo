import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { readLevelingPreference,saveLevelingPreference,subscribeLeveling,canLevelAudio } from '../utils/volume-leveling';
import { VolumeLeveler } from '../utils/volume-leveler';

export function useVolumeLeveling(videoRef:RefObject<HTMLVideoElement|null>,audioRef:RefObject<HTMLAudioElement|null>,source:string) {
  const enabled=useSyncExternalStore(subscribeLeveling,readLevelingPreference);
  const [error,setError]=useState('');
  const current=useRef<VolumeLeveler|null>(null);
  const levelingSupported=canLevelAudio();
  useEffect(()=>{
    if(!levelingSupported){setError('Volume leveling is unavailable in this browser. Original audio is used.');return;}
    let active=true,timer:number|undefined,ready=false;
    const video=videoRef.current;
    setError('');
    const start=()=>{
      if(!active||!enabled&&!current.current||ready&&current.current?.context.state==='running')return;
      try{
        const leveler=current.current??=new VolumeLeveler();
        void leveler.resume().then(()=>{
          if(!active||ready)return;
          if(!enabled){leveler.enable(false);return;}
          leveler.bind([videoRef.current,audioRef.current].filter((element):element is HTMLMediaElement=>element!==null));
          leveler.enable(true);ready=true;setError('');
          timer=window.setInterval(()=>leveler.tick(),250);
        }).catch(()=>{if(active){current.current?.enable(false);setError('Volume leveling is unavailable. Original audio is playing.');}});
      }catch{if(active)setError('Volume leveling is unavailable in this browser.');}
    };
    const elements=[videoRef.current,audioRef.current].filter((element):element is HTMLMediaElement=>element!==null);
    if(!enabled)current.current?.enable(false);
    if(enabled||current.current){start();window.addEventListener('pointerdown',start);window.addEventListener('keydown',start);elements.forEach(element=>element.addEventListener('play',start));}
    return()=>{
      active=false;window.clearInterval(timer);window.removeEventListener('pointerdown',start);window.removeEventListener('keydown',start);
      elements.forEach(element=>element.removeEventListener('play',start));
      current.current?.enable(false);
      const leveler=current.current;
      queueMicrotask(()=>{if(leveler&&!video?.isConnected){leveler.dispose();if(current.current===leveler)current.current=null;}});
    };
  },[enabled,source,videoRef,audioRef,levelingSupported]);
  return {leveling:enabled&&levelingSupported,setLeveling:saveLevelingPreference,levelingError:error,levelingSupported};
}
