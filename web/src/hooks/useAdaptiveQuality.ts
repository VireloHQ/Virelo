import { playVideo } from '../utils/media-playback';
import { boundedQualityLevel } from '../utils/playback-quality';
import { needsSeekWindow } from '../utils/playback-seek';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { api, type QualityTranscodeState } from '../api';
import type { MediaItem, PlaybackQuality } from '../types';

type AdaptiveState='idle'|'starting'|'active'|'error';
type HlsInstance=InstanceType<(typeof import('hls.js/light'))['default']>;
let sessionBandwidth=1_000_000;

export function useAdaptiveQuality(item:MediaItem,videoRef:RefObject<HTMLVideoElement|null>,releasePreviousSource?:()=>void,playIntent?:RefObject<boolean>,sourceTransition?:RefObject<boolean>){
  const hlsRef=useRef<HlsInstance|null>(null);
  const requestToken=useRef(0);
  const restoreToken=useRef(0);
  const restoreCleanupRef=useRef<(()=>void)|null>(null);
  const variantsRef=useRef<QualityTranscodeState['variants']>([]);
  const selectedRef=useRef<number|null>(null);
  const windowStartRef=useRef(0);
  const playbackBlocked=useRef(false);
  const [state,setState]=useState<AdaptiveState>('idle');
  const [error,setError]=useState('');
  const [selectedQuality,setSelectedQualityState]=useState<number|null>(null);
  const [activeQuality,setActiveQuality]=useState<number|null>(null);
  const [qualityOptions,setQualityOptions]=useState<PlaybackQuality[]>([]);

  const destroy=useCallback(()=>{
    restoreToken.current++;
    restoreCleanupRef.current?.();
    restoreCleanupRef.current=null;
    hlsRef.current?.destroy();
    hlsRef.current=null;
  },[]);
  useEffect(()=>{
    requestToken.current++;
    destroy();
    variantsRef.current=[];
    windowStartRef.current=0;
    selectedRef.current=null;
    playbackBlocked.current=false;
    setState('idle');
    setError('');
    setSelectedQualityState(null);
    setActiveQuality(null);
    setQualityOptions([]);
    return()=>{requestToken.current++;destroy();};
  },[destroy,item.id]);

  const applyHlsLevel=useCallback((height:number|null)=>{
    const hls=hlsRef.current;
    if(!hls)return;
    const level=height===null?-1:boundedQualityLevel(hls.levels,height);
    hls.autoLevelCapping=level;
    hls.startLevel=level;
    // loadLevel accepts -1 for Auto and retains already buffered playback.
    hls.loadLevel=level;
    if(level>=0&&hls.currentLevel>=0&&hls.currentLevel!==level){
      if(sourceTransition)sourceTransition.current=true;
      hls.currentLevel=level;
    }
  },[sourceTransition]);

  const attach=useCallback(async(result:QualityTranscodeState,resumeAt:number,shouldPlay:boolean)=>{
    const video=videoRef.current;
    if(!video)return false;
    const previousSource=video.currentSrc||video.src;
    if(sourceTransition)sourceTransition.current=true;
    variantsRef.current=result.variants;
    windowStartRef.current=result.startTime??0;
    setQualityOptions(result.variants);
    destroy();
    releasePreviousSource?.();
    const attachToken=restoreToken.current;
    let restored=false;
    let positionRestored=false;
    let manifestReady=false;
    let finishAttach:(ready:boolean)=>void=()=>{};
    let failAttach:(error:Error)=>void=()=>{};
    const attached=new Promise<boolean>((resolve,reject)=>{finishAttach=resolve;failAttach=reject;});
    const timeout=window.setTimeout(()=>{cleanupRestore();failAttach(new Error('The selected quality could not start.'));},20000);
    let cleanupRestore=()=>{};
    const restore=()=>{
      if(restored||!manifestReady||attachToken!==restoreToken.current||video.readyState<HTMLMediaElement.HAVE_METADATA)return;
      if(!positionRestored){try{video.currentTime=resumeAt;positionRestored=true;}catch{return;}}
      if(video.seeking||video.readyState<HTMLMediaElement.HAVE_FUTURE_DATA)return;
      restored=true;
      cleanupRestore();
      if(sourceTransition)sourceTransition.current=false;
      playbackBlocked.current=false;
      setState('active');
      void playVideo(video,()=>attachToken===restoreToken.current&&(playIntent?.current ?? shouldPlay));
      finishAttach(true);
    };
    cleanupRestore=()=>{
      window.clearTimeout(timeout);
      video.removeEventListener('loadedmetadata',restore);
      video.removeEventListener('durationchange',restore);
      video.removeEventListener('canplay',restore);
      video.removeEventListener('seeked',restore);
      video.removeEventListener('loadeddata',restore);
      if(restoreCleanupRef.current===cancelRestore)restoreCleanupRef.current=null;
    };
    const cancelRestore=()=>{cleanupRestore();finishAttach(false);};
    restoreCleanupRef.current=cancelRestore;
    video.addEventListener('loadedmetadata',restore);
    video.addEventListener('durationchange',restore);
    video.addEventListener('canplay',restore);
    video.addEventListener('seeked',restore);
    video.addEventListener('loadeddata',restore);
    try{
      const {default:Hls}=await import('hls.js/light');
      if(attachToken!==restoreToken.current){cancelRestore();return false;}
      if(Hls.isSupported()){
        const hls=new Hls({
          enableWorker:true,
          lowLatencyMode:false,
          maxBufferLength:20,
          startPosition:resumeAt,
          startLevel:-1,
          autoStartLoad:false,
          abrEwmaDefaultEstimate:sessionBandwidth
        });
        hlsRef.current=hls;
        hls.loadSource(result.playlist);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED,()=>{
          try{applyHlsLevel(selectedRef.current);manifestReady=true;hls.startLoad(resumeAt);restore();}
          catch(reason){cleanupRestore();failAttach(reason instanceof Error?reason:new Error('The selected quality is unavailable.'));}
        });
        hls.on(Hls.Events.FRAG_BUFFERED,()=>{
          if(Number.isFinite(hls.bandwidthEstimate)&&hls.bandwidthEstimate>0)sessionBandwidth=hls.bandwidthEstimate;
          restore();
        });
        hls.on(Hls.Events.LEVEL_SWITCHED,(_event,data)=>{
          const level=hls.levels[data.level];
          setActiveQuality(level?Math.min(level.width||level.height,level.height||level.width)||null:null);
        });
        hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal){
          playbackBlocked.current=selectedRef.current!==null;
          if(playbackBlocked.current){if(sourceTransition)sourceTransition.current=true;video.pause();hls.stopLoad();}
          cleanupRestore();failAttach(new Error('Adaptive playback failed.'));setError('Adaptive playback failed.');setState('error');
        }});
        return await attached;
      }
      if(video.canPlayType('application/vnd.apple.mpegurl')){
        const selected=selectedRef.current;
        const variant=selected===null?undefined:result.variants.filter(variant=>variant.height<=selected).sort((a,b)=>b.height-a.height)[0];
        if(selected!==null&&!variant)throw new Error('The selected quality is unavailable.');
        const url=selected===null?result.playlist:variant!.url;
        video.src=url;
        manifestReady=true;
        video.load();
        setActiveQuality(selected);
        return await attached;
      }
      throw new Error('This browser cannot play adaptive HLS video.');
    }catch(reason){
      if(attachToken!==restoreToken.current)return false;
      cleanupRestore();
      destroy();
      // A failed handoff must not leave a previously playable original blank.
      playbackBlocked.current=selectedRef.current!==null;
      video.pause();
      if(!playbackBlocked.current&&previousSource&&!previousSource.startsWith('blob:')){
        const recoveryToken=restoreToken.current;
        const recover=()=>{
          if(recoveryToken!==restoreToken.current)return;
          cleanupRecovery();
          video.currentTime=resumeAt;
          void playVideo(video,()=>recoveryToken===restoreToken.current&&(playIntent?.current ?? shouldPlay));
        };
        const cleanupRecovery=()=>{
          video.removeEventListener('loadedmetadata',recover);
          if(restoreCleanupRef.current===cleanupRecovery)restoreCleanupRef.current=null;
        };
        restoreCleanupRef.current=cleanupRecovery;
        video.addEventListener('loadedmetadata',recover);
        video.src=previousSource;
        video.load();
      }
      setError(reason instanceof Error?reason.message:'Adaptive playback failed.');
      if(sourceTransition)sourceTransition.current=playbackBlocked.current||Boolean(previousSource&&!previousSource.startsWith('blob:'));
      setState('error');
      return false;
    }
  },[applyHlsLevel,destroy,releasePreviousSource,videoRef,playIntent,sourceTransition]);

  const start=useCallback(async(audioStream:number|undefined,resumeAt:number,shouldPlay:boolean,keepPlaying=false)=>{
    const token=++requestToken.current;
    const video=videoRef.current;
    playbackBlocked.current=selectedRef.current!==null;
    if(!keepPlaying){if(sourceTransition)sourceTransition.current=true;video?.pause();}
    setState('starting');
    setError('');
    try{
      let result=await api.startQualityTranscode(item.id,audioStream,resumeAt);
      const startTime=result.startTime??0;
      if(result.status==='error')throw new Error(result.error||'Adaptive playback could not start.');
      for(let attempt=0;attempt<600;attempt++){
        if(token!==requestToken.current)return false;
        const position=keepPlaying?video?.currentTime??resumeAt:resumeAt;
        if(result.status==='ready'&&(result.complete||(result.bufferedUntil??0)>=position+6)){
          return await attach(result,position,keepPlaying?Boolean(video&&!video.paused):shouldPlay);
        }
        await new Promise((resolve)=>window.setTimeout(resolve,250));
        if(token!==requestToken.current)return false;
        result=await api.qualityTranscodeStatus(item.id,audioStream,startTime);
        if(result.status==='error')throw new Error(result.error||'Adaptive playback failed.');
      }
      throw new Error('Adaptive playback did not become ready in time.');
    }catch(reason){
      if(token!==requestToken.current)return false;
      setError(reason instanceof Error?reason.message:'Adaptive playback failed.');
      setState('error');
      if(playbackBlocked.current){if(sourceTransition)sourceTransition.current=true;video?.pause();}
      return false;
    }
  },[attach,item.id,videoRef,sourceTransition]);

  const setQuality=useCallback((height:number|null)=>{
    selectedRef.current=height;
    setSelectedQualityState(height);
    if(hlsRef.current){
      try{applyHlsLevel(height);playbackBlocked.current=false;}
      catch(reason){
        playbackBlocked.current=true;
        if(sourceTransition)sourceTransition.current=true;
        videoRef.current?.pause();hlsRef.current.stopLoad();
        setError(reason instanceof Error?reason.message:'The selected quality is unavailable.');setState('error');
      }
      return;
    }
    const video=videoRef.current;
    const variants=variantsRef.current;
    if(!video||!variants.length)return;
    const currentTime=video.currentTime;
    const shouldPlay=!video.paused;
    const url=height===null?variants[0].url.replace(/\d+\/index\.m3u8$/,'master.m3u8'):variants.filter(variant=>variant.height<=height).sort((a,b)=>b.height-a.height)[0]?.url;
    if(!url){
      playbackBlocked.current=true;
      if(sourceTransition)sourceTransition.current=true;
      video.pause();setError('The selected quality is unavailable.');setState('error');return;
    }
    if(sourceTransition)sourceTransition.current=true;
    restoreToken.current++;
    restoreCleanupRef.current?.();
    const token=restoreToken.current;
    playbackBlocked.current=height!==null;
    const restore=()=>{
      if(token!==restoreToken.current)return;
      cleanup();
      video.currentTime=currentTime;
      if(sourceTransition)sourceTransition.current=false;
      playbackBlocked.current=false;
      void playVideo(video,()=>token===restoreToken.current&&(playIntent?.current ?? shouldPlay));
    };
    const cleanup=()=>{video.removeEventListener('loadedmetadata',restore);if(restoreCleanupRef.current===cleanup)restoreCleanupRef.current=null;};
    restoreCleanupRef.current=cleanup;
    video.addEventListener('loadedmetadata',restore,{once:true});
    video.src=url;
    video.load();
    setActiveQuality(height);
  },[applyHlsLevel,videoRef,playIntent,sourceTransition]);

  const release=useCallback(()=>{
    requestToken.current++;destroy();variantsRef.current=[];playbackBlocked.current=false;
    setQualityOptions([]);setActiveQuality(null);setState('idle');setError('');
  },[destroy]);

  const needsSeek=(position:number)=>state==='starting'||(state==='active'&&Boolean(videoRef.current)&&needsSeekWindow(position,windowStartRef.current,videoRef.current!.seekable));
  return {state,error,start,selectedQuality,activeQuality,qualityOptions,setQuality,destroy,release,playbackBlocked,needsSeek};
}
