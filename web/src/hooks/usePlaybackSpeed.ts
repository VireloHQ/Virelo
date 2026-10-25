import { useEffect, useState, type RefObject } from 'react';
import { PLAYBACK_SPEED_KEY, playbackSpeed } from '../utils/playback-speed';

export function usePlaybackSpeed(videoRef: RefObject<HTMLVideoElement | null>, audioRef: RefObject<HTMLAudioElement | null>, mediaId: number, audioSource: string) {
  const [speed, setSpeed] = useState(() => {
    try { return playbackSpeed(localStorage.getItem(PLAYBACK_SPEED_KEY)); } catch { return 1; }
  });
  useEffect(() => {
    const elements = [videoRef.current, audioRef.current].filter((element): element is HTMLMediaElement => element !== null);
    const apply = () => elements.forEach(element => {
      element.preservesPitch = true;
      element.defaultPlaybackRate = speed;
      element.playbackRate = speed;
    });
    apply();
    elements.forEach(element => element.addEventListener('loadedmetadata', apply));
    return () => elements.forEach(element => element.removeEventListener('loadedmetadata', apply));
  }, [speed, mediaId, audioSource, videoRef, audioRef]);
  const changeSpeed = (value: number) => {
    const next = playbackSpeed(value);
    setSpeed(next);
    try { localStorage.setItem(PLAYBACK_SPEED_KEY, String(next)); } catch { /* Playback also works without persistent storage. */ }
  };
  return { speed, changeSpeed };
}
