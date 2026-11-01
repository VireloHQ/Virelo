import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { readLevelingPreference, saveLevelingPreference, subscribeLeveling, canLevelAudio } from '../utils/volume-leveling';
import { VolumeLeveler } from '../utils/volume-leveler';

export function useVolumeLeveling(videoRef: RefObject<HTMLVideoElement | null>, audioRef: RefObject<HTMLAudioElement | null>, source: string,
  controls:{volume:number;muted:boolean;setVolume:(value:number)=>void;setMuted:(value:boolean)=>void}) {
  const enabled = useSyncExternalStore(subscribeLeveling, readLevelingPreference);
  const [error, setError] = useState('');
  const current = useRef<VolumeLeveler | null>(null);
  const levelingSupported = canLevelAudio();
  useLayoutEffect(() => {
    if (!levelingSupported) { setError('Volume leveling is unavailable in this browser. Original audio is used.'); return; }
    if (!enabled && !current.current) return;
    let active = true;
    const video = videoRef.current;
    const elements = [video, audioRef.current].filter((element): element is HTMLMediaElement => element !== null);
    setError('');
    let leveler: VolumeLeveler;
    try {
      leveler = current.current ??= new VolumeLeveler();
      leveler.bind(elements);
      for(const element of elements)leveler.volume(element,controls.volume,controls.muted||Boolean(source&&element===video));
      leveler.enable(enabled);
    } catch {
      current.current?.enable(false);
      setError('Volume leveling is unavailable in this browser.');
      return;
    }
    const start = () => {
      if (!active) return;
      leveler.enable(enabled);
      void leveler.resume().then(()=>{if(active)setError('');}).catch(() => {
        if (active) { leveler.enable(false); setError('Volume leveling is unavailable. Original audio is playing.'); }
      });
    };
    start();
    window.addEventListener('pointerdown', start); window.addEventListener('keydown', start);
    elements.forEach(element => element.addEventListener('play', start));
    return () => {
      active = false;
      window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start);
      elements.forEach(element => element.removeEventListener('play', start));
      const leveler = current.current;
      queueMicrotask(() => { if (leveler && !videoRef.current?.isConnected) { leveler.dispose(); if (current.current === leveler) current.current = null; } });
    };
  }, [enabled, source, videoRef, audioRef, levelingSupported]);
  useLayoutEffect(()=>{
    const video=videoRef.current,audio=audioRef.current;
    for(const element of [video,audio]){
      if(!element)continue;
      const muted=controls.muted||Boolean(source&&element===video);
      if(current.current?.has(element))current.current.volume(element,controls.volume,muted);
      else{element.volume=controls.volume;element.muted=muted;}
    }
  },[controls.volume,controls.muted,source,enabled,videoRef,audioRef]);
  const onVolumeChange=(element:HTMLMediaElement)=>{
    if(element!==(source?audioRef.current:videoRef.current))return;
    const owned=current.current?.has(element);
    if(!owned||element.volume!==1){
      const volume=element.volume;
      controls.setVolume(volume);
      if(owned)current.current!.volume(element,volume,element.muted);
    }
    controls.setMuted(element.muted);
  };
  return { leveling: enabled && levelingSupported && !error, setLeveling: saveLevelingPreference, levelingError: error, levelingSupported, onVolumeChange };
}
