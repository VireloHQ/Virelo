import { playVideo } from '../utils/media-playback';
import { needsSeekWindow } from '../utils/playback-seek';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api } from '../api';
import type { MediaItem } from '../types';

type FallbackState = 'idle' | 'starting' | 'active' | 'error';
type HlsInstance = InstanceType<(typeof import('hls.js/light'))['default']>;

export function useHlsFallback(item: MediaItem, videoRef: RefObject<HTMLVideoElement | null>, playIntent?: RefObject<boolean>, sourceTransition?: RefObject<boolean>) {
  const hlsRef = useRef<HlsInstance|null>(null);
  const fallbackTimer = useRef<number|null>(null);
  const restoreToken = useRef(0);
  const restoreCleanupRef = useRef<(()=>void)|null>(null);
  const stateRef = useRef<FallbackState>('idle');
  const variantRef = useRef<number|null>(null);
  const windowStartRef=useRef(0);
  const [fallback, setFallbackState] = useState<FallbackState>('idle');
  const [activeAudioStream, setActiveAudioStream] = useState<number|null>(null);
  const [error, setError] = useState('');

  const setState = useCallback((value: FallbackState) => {
    stateRef.current = value;
    setFallbackState(value);
  }, []);

  const stopCurrent = useCallback(() => {
    restoreToken.current++;
    restoreCleanupRef.current?.();
    restoreCleanupRef.current=null;
    hlsRef.current?.destroy();
    hlsRef.current = null;
    if (fallbackTimer.current !== null) window.clearTimeout(fallbackTimer.current);
    fallbackTimer.current = null;
  }, []);

  useEffect(() => {
    stopCurrent();
    variantRef.current = null;
    windowStartRef.current=0;
    setActiveAudioStream(null);
    setState('idle');
    setError('');
    return stopCurrent;
  }, [item.id, setState, stopCurrent]);

  const attachHls = useCallback(async (url: string, audioStream: number|null, resumeAt: number, shouldPlay: boolean) => {
    const video = videoRef.current;
    if (!video) return;
    stopCurrent();
    if(sourceTransition)sourceTransition.current=true;
    const attachToken=restoreToken.current;
    let restored=false;
    let manifestReady=false;
    let positionRestored=false;
    let cleanupRestore=()=>{};
    const restorePlayback = () => {
      if (restored||!manifestReady||attachToken!==restoreToken.current||video.readyState<HTMLMediaElement.HAVE_METADATA)return;
      if(!positionRestored){try{video.currentTime=resumeAt;positionRestored=true;}catch{return;}}
      if(video.seeking||video.readyState<HTMLMediaElement.HAVE_FUTURE_DATA)return;
      restored=true;
      cleanupRestore();
      setActiveAudioStream(audioStream);
      if(sourceTransition)sourceTransition.current=false;
      setState('active');
      void playVideo(video,()=>attachToken===restoreToken.current&&(playIntent?.current ?? shouldPlay));
    };
    cleanupRestore=()=>{
      if(fallbackTimer.current!==null)window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current=null;
      video.removeEventListener('loadedmetadata',restorePlayback);
      video.removeEventListener('durationchange',restorePlayback);
      video.removeEventListener('canplay',restorePlayback);
      video.removeEventListener('seeked',restorePlayback);
      video.removeEventListener('loadeddata',restorePlayback);
      if(restoreCleanupRef.current===cleanupRestore)restoreCleanupRef.current=null;
    };
    restoreCleanupRef.current=cleanupRestore;
    video.addEventListener('loadedmetadata',restorePlayback);
    video.addEventListener('durationchange',restorePlayback);
    video.addEventListener('canplay',restorePlayback);
    video.addEventListener('seeked',restorePlayback);
    video.addEventListener('loadeddata',restorePlayback);
    fallbackTimer.current=window.setTimeout(()=>{cleanupRestore();setState('error');setError('Compatible playback could not start.');},20000);
    try {
      const { default: Hls } = await import('hls.js/light');
      if(attachToken!==restoreToken.current)return;
      if (!Hls.isSupported()) {
        if (!video.canPlayType('application/vnd.apple.mpegurl')) throw new Error('This browser cannot play HLS.');
        video.src=url;
        manifestReady=true;
        video.load();
        return;
      }
      const hls = new Hls({ enableWorker: true, lowLatencyMode: false, maxBufferLength: 20, startPosition:resumeAt });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED,()=>{manifestReady=true;restorePlayback();});
      hls.on(Hls.Events.FRAG_BUFFERED,restorePlayback);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        cleanupRestore();
        setError('Compatible playback failed.');
        setState('error');
      });
    } catch (reason) {
      if(attachToken!==restoreToken.current)return;
      cleanupRestore();
      setError(reason instanceof Error ? reason.message : 'This browser cannot play HLS.');
      setState('error');
    }
  }, [setState, stopCurrent, videoRef, playIntent, sourceTransition]);

  const startFallback = useCallback(async (audioStream?: number, resumeAt?: number, shouldPlay?: boolean, force=false) => {
    const requestedStream = audioStream ?? null;
    if (!force&&stateRef.current === 'starting' && variantRef.current === requestedStream) return;
    if (!force&&stateRef.current === 'active' && variantRef.current === requestedStream) return;
    const video = videoRef.current;
    const position = resumeAt ?? video?.currentTime ?? 0;
    const resumePlayback = shouldPlay ?? Boolean(video && !video.paused);
    stopCurrent();
    const token=restoreToken.current;
    variantRef.current = requestedStream;
    setState('starting');
    setError('');
    try {
      let start = await api.startTranscode(item.id, audioStream,position);
      const startTime=start.startTime??0;
      if (start.status === 'error') throw new Error(start.error || 'Compatible playback is unavailable.');
      for(let attempt=0;attempt<1200;attempt++){
        if(token!==restoreToken.current)return;
        if(start.status==='error')throw new Error(start.error||'Compatible playback failed.');
        if(start.status==='ready'&&(start.complete||(start.bufferedUntil??0)>=position+6)){
          windowStartRef.current=startTime;
          await attachHls(start.playlist,requestedStream,position,resumePlayback);
          return;
        }
        await new Promise((resolve)=>window.setTimeout(resolve,250));
        if(token!==restoreToken.current)return;
        start=await api.transcodeStatus(item.id,audioStream,startTime);
      }
      throw new Error('Compatible playback did not become ready.');
    } catch (reason) {
      if(token!==restoreToken.current)return;
      setState('error');
      setError(reason instanceof Error ? reason.message : 'Compatible playback failed.');
    }
  }, [attachHls, item.id, setState, stopCurrent, videoRef]);

  const release=useCallback(()=>{
    stopCurrent();variantRef.current=null;setState('idle');setActiveAudioStream(null);
  },[setState,stopCurrent]);

  const needsSeek=(position:number)=>stateRef.current==='starting'||(stateRef.current==='active'&&Boolean(videoRef.current)&&needsSeekWindow(position,windowStartRef.current,videoRef.current!.seekable));
  return { fallback, error, startFallback, activeAudioStream, release,needsSeek };
}
