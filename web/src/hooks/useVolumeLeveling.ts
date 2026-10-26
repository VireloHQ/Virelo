import { useLayoutEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import { readLevelingPreference, saveLevelingPreference, subscribeLeveling, canLevelAudio } from '../utils/volume-leveling';
import { VolumeLeveler } from '../utils/volume-leveler';

export function useVolumeLeveling(videoRef: RefObject<HTMLVideoElement | null>, audioRef: RefObject<HTMLAudioElement | null>, source: string) {
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
      leveler.enable(enabled);
    } catch {
      current.current?.enable(false);
      setError('Volume leveling is unavailable in this browser.');
      return;
    }
    const start = () => {
      if (!active) return;
      void leveler.resume().catch(() => {
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
  return { leveling: enabled && levelingSupported, setLeveling: saveLevelingPreference, levelingError: error, levelingSupported };
}
