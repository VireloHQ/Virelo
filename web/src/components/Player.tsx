import { useEffect, useRef, useState } from 'react';
import { ArrowsOut, Gear, FastForward, Pause, PictureInPicture, Play, Repeat, Rewind, SkipBack, SkipForward, SpeakerHigh, SpeakerSlash, SpinnerGap } from '@phosphor-icons/react';
import { api } from '../api';
import { useHlsFallback } from '../hooks/useHlsFallback';
import { useAdaptiveQuality } from '../hooks/useAdaptiveQuality';
import { playVideo } from '../utils/media-playback';
import { qualityLabel, readQualityPreference, resolvePreferredQuality, saveQualityPreference, type QualityPreference } from '../utils/playback-quality';
import { hasPlaybackTrackPreference, resolvePlaybackTrackSelection, savePlaybackTrackSelection } from '../utils/playback-tracks';
import { toggleFullscreen } from '../utils/fullscreen';
import { DraggableCaption, HiddenSubtitleTrack } from './DraggableCaption';
import { FavoriteButton } from './FavoriteButton';
import { useAccount } from './AccountSession';
import { PlaybackSettingsMenu } from './PlaybackSettingsMenu';
import { ShortsContextMenu, ShortsPlayerControls, type ShortsPlaybackOptions } from './ShortsPlayerControls';
import { PlayerActionMenu } from './PlayerActionMenu';
import { type RepeatMode } from '../utils/playback-repeat';
import { useBackgroundPlayback } from '../hooks/useBackgroundPlayback';
import { usePlaybackVolume } from '../hooks/usePlaybackVolume';
import { useVideoPresentation } from '../hooks/useVideoPresentation';
import { VideoSettingsPanel } from './VideoSettingsPanel';
import type { MediaItem, PlaybackInfo } from '../types';
import '../player-ui.css';
import '../video-settings.css';

interface PlayerProps {
  item: MediaItem;
  queue?: MediaItem[];
  queueIndex?: number;
  onEnded?: () => void;
  onNext?: () => void;
  onPrev?: () => void;
  canGoNext?: boolean;
  canGoPrev?: boolean;
  autoPlay?: boolean;
  shorts?: ShortsPlaybackOptions;
  repeatMode?: RepeatMode;
  onRepeatChange?: (mode:RepeatMode) => void;
}

const DIRECT_AUDIO_CODECS=new Set(['aac','flac','mp3','opus','vorbis']);
type HlsInstance=InstanceType<(typeof import('hls.js/light'))['default']>;

export function Player({item,queue,queueIndex,onEnded,onNext,onPrev,canGoNext=true,canGoPrev=true,autoPlay,shorts,repeatMode,onRepeatChange}:PlayerProps) {
  const canTranscode=useAccount()?.user.permissions.transcode!==false;
  const localPlayback=isLocalPlaybackHost();
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceTransition = useRef(false);
  const wantsPlayback = useRef(Boolean(autoPlay));
  const [playRequested, setPlayRequested] = useState(Boolean(autoPlay));
  const audioRef = useRef<HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const presentation = useVideoPresentation(item.id, containerRef);
  const lastProgress = useRef(0);
  const playbackItemId = useRef(item.id);
  const controlsTimer = useRef<number | null>(null);
  const longPressTimer = useRef<number | null>(null);
  const longPressTriggered = useRef(false);
  const audioToken = useRef(0);
  const audioSourceToken = useRef(0);
  const audioHlsRef = useRef<HlsInstance|null>(null);
  const resumeAfterAudio = useRef(false);
  const audioResumeAt = useRef<number|null>(null);
  const audioRetryTimer = useRef<number|null>(null);
  const audioRetryCount = useRef(0);
  const initialResumeItem = useRef<number|null>(null);
  const videoFallbackRequested = useRef(false);
  const qualityRequested = useRef(true);
  const autoBufferTimer = useRef<number|null>(null);
  const seekTarget=useRef<number|null>(null);
  const seekTimer=useRef<number|null>(null);
  const seekToken=useRef(0);
  const [seekingPosition,setSeekingPosition]=useState<number|null>(null);
  const { fallback, error, startFallback, release:releaseFallback,needsSeek:needsFallbackSeek } = useHlsFallback(item, videoRef, wantsPlayback, sourceTransition);
  const {state:qualityState,error:qualityError,start:startQuality,selectedQuality,activeQuality,qualityOptions,setQuality,playbackBlocked,release:releaseQuality,needsSeek:needsQualitySeek}=useAdaptiveQuality(item,videoRef,releaseFallback,wantsPlayback,sourceTransition);
  const [qualitySelectionError,setQualitySelectionError] = useState('');
  const [qualityPreference,setQualityPreference] = useState(()=>readQualityPreference(!localPlayback,canTranscode));
  const [playbackInfo,setPlaybackInfo] = useState<PlaybackInfo|null>(null);
  const [selectedAudio,setSelectedAudio] = useState<number|null>(null);
  const [selectedSubtitle,setSelectedSubtitle] = useState<number|null>(null);
  const [activeCaption,setActiveCaption] = useState('');
  const [externalAudioUrl,setExternalAudioUrl] = useState('');
  const [audioPreparing,setAudioPreparing] = useState(false);
  const [audioError,setAudioError] = useState('');
  const [playbackReady,setPlaybackReady] = useState(false);
  const [playing,setPlaying] = useState(false);
  const [buffering,setBuffering] = useState(false);
  const [current,setCurrent] = useState(0);
  const [duration,setDuration] = useState(item.duration || 0);
  const {volume,setVolume,muted,setMuted} = usePlaybackVolume();
  const [pip,setPip] = useState(false);
  const [pipSupported,setPipSupported] = useState(false);
  const [singleRepeat,setSingleRepeat] = useState<RepeatMode>('off');
  const repeat=repeatMode??singleRepeat;
  const changeRepeat=onRepeatChange??setSingleRepeat;
  const [contextPosition,setContextPosition]=useState<{x:number;y:number;keyboard?:boolean}|null>(null);
  const [controlsVisible,setControlsVisible] = useState(true);
  useEffect(()=>{
    const player=containerRef.current, controls=player?.querySelector<HTMLElement>('.player-controls');
    if(!player||!controls||shorts)return;
    const update=()=>player.style.setProperty('--player-controls-height',`${controls.offsetHeight+14}px`);
    const observer=new ResizeObserver(update);observer.observe(controls);update();
    return()=>observer.disconnect();
  },[]);

  const background=useBackgroundPlayback(item.id,videoRef,wantsPlayback,{
    transition:sourceTransition,
    resume:resumeFromBackground,
    play:()=>{wantsPlayback.current=true;setPlayRequested(true);resumeFromBackground();},
    pause:pausePlayback
  });

  useEffect(()=>{
    sourceTransition.current=true;
    seekToken.current++;
    seekTarget.current=null;
    setSeekingPosition(null);
    if(seekTimer.current!==null)window.clearTimeout(seekTimer.current);
    seekTimer.current=null;
    wantsPlayback.current=Boolean(autoPlay);
    setPlayRequested(Boolean(autoPlay));
    playbackItemId.current=item.id;
    setContextPosition(null);
    audioToken.current++;
    audioSourceToken.current++;
    videoFallbackRequested.current=false;
    qualityRequested.current=true;
    playbackBlocked.current=typeof readQualityPreference(!localPlayback,canTranscode)==='number';
    setQualitySelectionError('');
    if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);
    autoBufferTimer.current=null;
    audioRef.current?.pause();
    if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);
    audioRetryTimer.current=null;
    audioRetryCount.current=0;
    resumeAfterAudio.current=false;
    audioResumeAt.current=null;
    initialResumeItem.current=null;
    lastProgress.current=0;
    setPlaybackInfo(null);
    setSelectedAudio(null);
    setSelectedSubtitle(null);
    setActiveCaption('');
    setExternalAudioUrl('');
    setAudioPreparing(false);
    setAudioError('');
    setPlaybackReady(false);
    setPlaying(false);
    setBuffering(false);
    setCurrent(0);
    setDuration(item.duration||0);
  },[item.id]);

  useEffect(()=>{
    let alive=true;
    if(wantsPlayback.current&&!hasPlaybackTrackPreference('audio'))requestVideoPlayback();
    api.playbackInfo(item.id).then(async(info)=>{
      if(!alive)return;
      setPlaybackInfo(info);
      const audio=canTranscode?resolvePlaybackTrackSelection('audio',info.audioTracks,info.defaultAudioStream):info.defaultAudioStream;
      setSelectedAudio(audio);
      setSelectedSubtitle(resolvePlaybackTrackSelection('subtitles',info.subtitleTracks,null));
      const preference=readQualityPreference(!localPlayback,canTranscode);
      setQualityPreference(preference);
      const preferredQuality=resolvePreferredQuality(info.qualityOptions,preference);
      setQuality(preferredQuality);
      const directPlayback=!info.qualityOptions.length||preferredQuality===null||preferredQuality===info.qualityOptions[0]?.height;
      if(directPlayback){
        playbackBlocked.current=false;
        qualityRequested.current=false;
        const video=videoRef.current;
        const original=new URL(`/api/media/${item.id}/stream`,window.location.href).href;
        // Destroying the previous HLS instance can clear src after React sets the next file.
        if(video&&video.src!==original){sourceTransition.current=true;video.src=original;video.load();}
        if(info.requiresTranscode||videoRef.current?.error){
          videoFallbackRequested.current=true;
          const video=videoRef.current;
          const position=video?.currentTime||item.progress_position||0;
          sourceTransition.current=true;
          video?.pause();
          await startFallback(audio??undefined,position,wantsPlayback.current);
        }else if(audio!==null&&audio!==info.defaultAudioStream){
          const resume=item.progress_position||0;
          const position=initialResumeItem.current===item.id?(video?.currentTime||0):resume>5&&(!item.duration||resume<item.duration*.92)?resume:0;
          await prepareAudio(audio,info,true,true,position);
        }else{
          setPlaybackReady(true);
          if(wantsPlayback.current)requestVideoPlayback();
        }
        return;
      }
      const adaptiveReady=await startQuality(audio??undefined,item.progress_position||0,wantsPlayback.current);
      if(!alive)return;
      if(adaptiveReady){
        setPlaybackReady(true);
        return;
      }
      // Manual quality failures stay paused. Never resume the higher-resolution original.
      setPlaybackReady(false);
    }).catch((reason)=>{
      if(!alive)return;
      if(typeof readQualityPreference(!localPlayback,canTranscode)==='number'){
        playbackBlocked.current=true;
        sourceTransition.current=true;
        videoRef.current?.pause();
        audioRef.current?.pause();
        setPlaybackReady(false);
        setQualitySelectionError(reason instanceof Error?reason.message:'The selected quality could not be prepared.');
        return;
      }
      qualityRequested.current=false;
      setPlaybackReady(true);
      if(wantsPlayback.current)requestVideoPlayback();
    });
    return()=>{alive=false;audioToken.current++;};
  },[autoPlay,item.id,localPlayback,setQuality,startQuality,startFallback,canTranscode]);

  useEffect(()=>{
    if(qualityState!=='active')return;
    sourceTransition.current=false;
    audioRef.current?.pause();
    setExternalAudioUrl('');
    setPlaybackReady(true);
  },[qualityState]);

  useEffect(()=>{if(fallback==='active'){sourceTransition.current=false;setPlaybackReady(true);}},[fallback]);

  useEffect(()=>{setActiveCaption('');},[item.id,selectedSubtitle]);

  useEffect(()=>{
    const video=videoRef.current;
    const audio=audioRef.current;
    if(!video)return;
    video.muted=externalAudioUrl?true:muted;
    video.volume=volume;
    if(audio){audio.volume=volume;audio.muted=muted;}
  },[externalAudioUrl,muted,volume]);

  useEffect(()=>{
    const audio=audioRef.current;
    const sourceToken=++audioSourceToken.current;
    audioHlsRef.current?.destroy();
    audioHlsRef.current=null;
    if(!audio)return;
    let disposed=false;
    let ready=false;
    const handleReady=()=>{
      if(disposed||sourceToken!==audioSourceToken.current||audio.readyState<HTMLMediaElement.HAVE_METADATA)return;
      const video=videoRef.current;
      const pendingPosition=audioResumeAt.current;
      syncExternalAudio(false,pendingPosition??undefined);
      if(pendingPosition!==null)audioResumeAt.current=null;
      if(!ready){
        ready=true;
        sourceTransition.current=false;
        setPlaybackReady(true);
      }
      if(video&&!video.paused){
        syncExternalAudio(true);
      }else if(resumeAfterAudio.current&&wantsPlayback.current){
        resumeAfterAudio.current=false;
        queueMicrotask(()=>{
          if(disposed||sourceToken!==audioSourceToken.current||!wantsPlayback.current)return;
          const playPromise=videoRef.current?.play();
          if(playPromise)void playPromise.then(()=>requestExternalAudioPlayback()).catch(()=>{resumeAfterAudio.current=true;});
        });
      }
    };
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    audio.addEventListener('loadedmetadata',handleReady);
    audio.addEventListener('canplay',handleReady);
    if(!externalAudioUrl)return()=>{
      disposed=true;
      audio.removeEventListener('loadedmetadata',handleReady);
      audio.removeEventListener('canplay',handleReady);
    };
    if(audio.canPlayType('application/vnd.apple.mpegurl')){
      audio.src=externalAudioUrl;
      audio.load();
      return()=>{
        disposed=true;
        audio.removeEventListener('loadedmetadata',handleReady);
        audio.removeEventListener('canplay',handleReady);
      };
    }
    void import('hls.js/light').then(({default:Hls})=>{
      if(disposed||sourceToken!==audioSourceToken.current)return;
      if(!Hls.isSupported())throw new Error('This browser cannot play converted audio.');
      const hls=new Hls({enableWorker:true,lowLatencyMode:false,maxBufferLength:40});
      audioHlsRef.current=hls;
      hls.loadSource(externalAudioUrl);
      hls.attachMedia(audio);
      hls.on(Hls.Events.FRAG_BUFFERED,handleReady);
      hls.on(Hls.Events.ERROR,(_event,data)=>{if(data.fatal)setAudioError('Converted audio playback failed.');});
    }).catch((reason)=>{if(!disposed)setAudioError(reason instanceof Error?reason.message:'Converted audio playback failed.');});
    return()=>{
      disposed=true;
      audio.removeEventListener('loadedmetadata',handleReady);
      audio.removeEventListener('canplay',handleReady);
      audioRetryCount.current=0;
      if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);
      audioRetryTimer.current=null;
      audioHlsRef.current?.destroy();
      audioHlsRef.current=null;
    };
  },[externalAudioUrl]);

  useEffect(()=>{
    const video=videoRef.current;
    setPipSupported(Boolean(video && document.pictureInPictureEnabled && typeof video.requestPictureInPicture==='function'));
    if (!video) return;
    const handleEnterPip=()=>{setPip(true);shorts?.onPipChange(true);};
    const handleLeavePip=()=>{setPip(false);shorts?.onPipChange(false);};
    let disposed=false,attempts=0;
    let followTimer:number|undefined;
    const followPip=()=>{
      if(disposed||!shorts?.pipOn||!document.pictureInPictureEnabled||video.readyState<2||typeof video.requestPictureInPicture!=='function'||attempts>=4)return;
      if(document.pictureInPictureElement===video)return;
      attempts++;
      void video.requestPictureInPicture().catch(()=>{if(!disposed)followTimer=window.setTimeout(followPip,300);});
    };
    if(shorts?.pipOn){video.addEventListener('loadeddata',followPip);followPip();}
    video.addEventListener('enterpictureinpicture',handleEnterPip);
    video.addEventListener('leavepictureinpicture',handleLeavePip);
    return ()=>{
      disposed=true;
      window.clearTimeout(followTimer);
      video.removeEventListener('loadeddata',followPip);
      video.removeEventListener('enterpictureinpicture',handleEnterPip);
      video.removeEventListener('leavepictureinpicture',handleLeavePip);
    };
  },[]);

  useEffect(()=>()=>{
    if(controlsTimer.current!==null)window.clearTimeout(controlsTimer.current);
    if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);
    if(seekTimer.current!==null)window.clearTimeout(seekTimer.current);
    seekToken.current++;
  },[]);

  useEffect(()=>{
    const video=videoRef.current;
    if(!buffering||!video||!wantsPlayback.current||video.paused||video.seeking||localPlayback||qualityPreference!=='auto'||selectedQuality!==null||!playbackReady||qualityState!=='idle')return;
    autoBufferTimer.current=window.setTimeout(()=>{
      autoBufferTimer.current=null;
      if(!wantsPlayback.current||video.paused||video.seeking||video.readyState>=HTMLMediaElement.HAVE_FUTURE_DATA)return;
      qualityRequested.current=true;
      void startQuality(selectedAudio??undefined,video.currentTime,true,true).then((ready)=>{
        if(!ready)qualityRequested.current=false;
      });
    },1500);
    return()=>{
      if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);
      autoBufferTimer.current=null;
    };
  },[buffering,playRequested,localPlayback,playbackReady,qualityState,qualityPreference,selectedAudio,selectedQuality,startQuality]);

  function handleWaiting(){
    if(!background.audioIsClock())audioRef.current?.pause();
    if(wantsPlayback.current&&!videoRef.current?.paused)setBuffering(true);
  }
  function handlePlaying(){
    setBuffering(false);
    if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);
    autoBufferTimer.current=null;
    syncExternalAudio(true);
  }

  useEffect(()=>{
    if(!shorts)return;
    const video=videoRef.current;
    return()=>{
      wantsPlayback.current=false;
      clearLongPress();
      if(video){
        void api.progress(item.id,video.currentTime,Number.isFinite(video.duration)?video.duration:item.duration||0);
        video.pause();
      }
      audioRef.current?.pause();
    };
  },[item.id,Boolean(shorts)]);

  function clearLongPress(){
    if(longPressTimer.current!==null)window.clearTimeout(longPressTimer.current);
    longPressTimer.current=null;
  }
  function startLongPress(event:React.PointerEvent<HTMLDivElement>){
    revealControls();
    if(!shorts||event.pointerType!=='touch'||(event.target instanceof Element&&event.target.closest('input,button,[role="menu"],.player-caption')))return;
    clearLongPress();
    longPressTriggered.current=false;
    longPressTimer.current=window.setTimeout(()=>{
      longPressTriggered.current=true;
      setContextPosition({x:event.clientX,y:event.clientY});
    },520);
  }

  function usesTouchControls(){return window.matchMedia('(hover: none), (pointer: coarse)').matches;}
  function revealControls(){
    if(controlsTimer.current!==null){window.clearTimeout(controlsTimer.current);controlsTimer.current=null;}
    setControlsVisible(true);
  }
  function scheduleControlsHide(){
    if(shorts)return;
    if(controlsTimer.current!==null)window.clearTimeout(controlsTimer.current);
    const video=videoRef.current;
    if(!video||video.paused){controlsTimer.current=null;return;}
    controlsTimer.current=window.setTimeout(()=>{
      const keyboardFocus=containerRef.current?.querySelector(':focus-visible');
      if(keyboardFocus||document.querySelector('.player-action-menu')||containerRef.current?.querySelector('.playback-settings button[aria-expanded="true"]')){scheduleControlsHide();return;}
      setControlsVisible(false);
      controlsTimer.current=null;
    },2400);
  }

  function syncExternalAudio(play=false,targetTime?:number){
    const video=videoRef.current;const audio=audioRef.current;
    if(!video||!audio||!externalAudioUrl||background.audioIsClock())return;
    if(seekTarget.current!==null&&Math.abs(video.currentTime-seekTarget.current)>.65)return;
    const position=targetTime??video.currentTime;
    if(Number.isFinite(position)&&(!Number.isFinite(audio.currentTime)||Math.abs(audio.currentTime-position)>.2)){
      try{audio.currentTime=position;}catch{/* wait for metadata before seeking */}
    }
    try{audio.playbackRate=video.playbackRate;}catch{/* the audio source is still loading */}
    if(play)requestExternalAudioPlayback();
  }
  function requestExternalAudioPlayback(){
    const video=videoRef.current;const audio=audioRef.current;
    if(!video||!audio||!externalAudioUrl||(video.paused&&!background.audioIsClock())||!wantsPlayback.current||audio.readyState<HTMLMediaElement.HAVE_METADATA)return;
    if(!audio.paused)return;
    const result=audio.play();
    if(!result)return;
    void result.then(()=>{
      audioRetryCount.current=0;
      if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);
      audioRetryTimer.current=null;
    }).catch(()=>{
      if(videoRef.current!==video||audioRef.current!==audio||(video.paused&&!background.audioIsClock())||!wantsPlayback.current||!externalAudioUrl)return;
      if(audioRetryCount.current>=8)return;
      audioRetryCount.current++;
      if(audioRetryTimer.current!==null)return;
      audioRetryTimer.current=window.setTimeout(()=>{
        audioRetryTimer.current=null;
        requestExternalAudioPlayback();
      },150);
    });
  }
  function requestVideoPlayback(){
    const video=videoRef.current;
    const requestItemId=item.id;
    if(!video||playbackBlocked.current)return;
    void playVideo(video,()=>wantsPlayback.current&&!playbackBlocked.current&&playbackItemId.current===requestItemId,()=>{
      setMuted(true);
      if(audioRef.current)audioRef.current.muted=true;
    }).then(()=>{if(playbackItemId.current===requestItemId)requestExternalAudioPlayback();});
  }
  function pausePlayback(){
    const video=videoRef.current, audio=audioRef.current;
    if(background.audioIsClock()&&video&&audio&&externalAudioUrl&&Number.isFinite(audio.currentTime)){
      video.currentTime=audio.currentTime;
    }
    wantsPlayback.current=false;
    background.suspended.current=false;
    setPlayRequested(false);
    setPlaying(false);
    videoRef.current?.pause();
    audioRef.current?.pause();
  }
  function resumeFromBackground(){
    const video=videoRef.current, audio=audioRef.current;
    if(!video||!wantsPlayback.current||!playbackReady||playbackBlocked.current||sourceTransition.current)return;
    // A hidden video can be suspended while the separate soundtrack keeps playing.
    if(background.audioIsClock()&&externalAudioUrl&&audio&&!audio.paused&&Number.isFinite(audio.currentTime)){
      video.currentTime=audio.currentTime;
    }
    background.suspended.current=false;
    requestVideoPlayback();
  }
  function reportBackgroundAudio(audio:HTMLAudioElement){
    if(!background.audioIsClock()||!externalAudioUrl)return;
    setCurrent(audio.currentTime);
    if(Math.abs(audio.currentTime-lastProgress.current)>5){
      lastProgress.current=audio.currentTime;
      void api.progress(playbackItemId.current,audio.currentTime,duration);
    }
  }
  function toggle(){
    const video=videoRef.current;
    if(!video)return;
    const preparingPlayback=seekingPosition!==null||audioPreparing||qualityState==='starting'||fallback==='starting';
    const next=preparingPlayback||background.suspended.current?!wantsPlayback.current:video.paused;
    wantsPlayback.current=next;
    setPlayRequested(next);
    if(next){audioRetryCount.current=0;requestVideoPlayback();}
    else {pausePlayback();setBuffering(false);}
  }
  function handleVideoClick(){if(longPressTriggered.current){longPressTriggered.current=false;return;}if(!shorts&&usesTouchControls()&&!controlsVisible){revealControls();return;}toggle();revealControls();}
  function seek(value:number){
    const video=videoRef.current;
    if(!video||!Number.isFinite(value))return;
    const position=Math.max(0,Math.min(value,Math.max(0,fullDuration(item.duration,duration,video.duration)-.2)));
    const token=++seekToken.current;
    if(seekTimer.current!==null)window.clearTimeout(seekTimer.current);
    seekTimer.current=null;
    seekTarget.current=position;
    setSeekingPosition(position);
    setCurrent(position);
    initialResumeItem.current=item.id;
    background.suspended.current=false;
    if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);
    autoBufferTimer.current=null;
    const qualitySeek=needsQualitySeek(position),fallbackSeek=needsFallbackSeek(position);
    if(qualitySeek||fallbackSeek){
      sourceTransition.current=true;
      video.pause();audioRef.current?.pause();setBuffering(false);
      // Dragging across the range must not spawn an encoder for every pixel.
      seekTimer.current=window.setTimeout(()=>{
        seekTimer.current=null;
        if(token!==seekToken.current)return;
        if(qualitySeek)void startQuality(selectedAudio??undefined,position,wantsPlayback.current);
        else void startFallback(selectedAudio??undefined,position,wantsPlayback.current,true);
      },180);
      return;
    }
    video.currentTime=position;
    if(audioRef.current&&externalAudioUrl){
      audioResumeAt.current=position;
      try{audioRef.current.currentTime=position;audioResumeAt.current=null;}catch{/* apply when metadata arrives */}
    }
  }
  function acceptSeekPosition(video:HTMLVideoElement){
    if(seekTarget.current===null)return true;
    if(video.seeking||sourceTransition.current||Math.abs(video.currentTime-seekTarget.current)>.65)return false;
    seekTarget.current=null;setSeekingPosition(null);return true;
  }
  function seekBy(seconds:number){seek(Math.max(0,Math.min(fullDuration(item.duration,duration), (seekTarget.current??current)+seconds)));}
  function toggleMute(){setMuted((value)=>!value);}
  function setVol(value:number){setMuted(false);setVolume(value);}
  async function fullscreen(){const container=containerRef.current;const video=videoRef.current;if(!container||!video)return;await toggleFullscreen(container,video);}
  async function togglePip(){const v=videoRef.current;if(!v||!pipSupported)return;if(document.pictureInPictureElement)await document.exitPictureInPicture();else await v.requestPictureInPicture().catch(()=>{});}

  async function prepareAudio(stream:number,info=playbackInfo,initial=false,skipAdaptive=false,resumeAt?:number){
    if(!info||(videoFallbackRequested.current&&fallback!=='active'))return;
    if(!initial&&selectedAudio===stream&&!audioPreparing)return;
    const video=videoRef.current;
    const token=++audioToken.current;
    const shouldResume=wantsPlayback.current;
    const position=resumeAt??(video&&Number.isFinite(video.currentTime)?video.currentTime:current);
    const track=info.audioTracks.find((candidate)=>candidate.index===stream);
    const canUseOriginal=stream===info.defaultAudioStream&&Boolean(track&&DIRECT_AUDIO_CODECS.has(track.codec));
    setSelectedAudio(stream);
    setAudioError('');
    sourceTransition.current=true;
    video?.pause();
    audioRef.current?.pause();

    if(!skipAdaptive&&info.qualityOptions.length&&(qualityState==='active'||playbackBlocked.current)){
      qualityRequested.current=true;
      resumeAfterAudio.current=false;
      audioResumeAt.current=null;
      setExternalAudioUrl('');
      setPlaybackReady(false);
      const ready=await startQuality(stream,position,shouldResume);
      if(token!==audioToken.current)return;
      if(ready){sourceTransition.current=false;setPlaybackReady(true);return;}
      if(selectedQuality!==null){setPlaybackReady(false);return;}
      qualityRequested.current=false;
    }

    if(fallback==='active'){
      resumeAfterAudio.current=false;
      audioResumeAt.current=null;
      setExternalAudioUrl('');
      void startFallback(stream,position,shouldResume);
      return;
    }
    if(canUseOriginal){
      resumeAfterAudio.current=false;
      audioResumeAt.current=null;
      setExternalAudioUrl('');
      setAudioPreparing(false);
      sourceTransition.current=false;
      setPlaybackReady(true);
      if(shouldResume)window.setTimeout(()=>{
        if(token!==audioToken.current||!wantsPlayback.current)return;
        const nextVideo=videoRef.current;
        if(nextVideo){nextVideo.muted=muted;nextVideo.volume=volume;void nextVideo.play().catch(()=>{});}
      },0);
      return;
    }

    resumeAfterAudio.current=shouldResume;
    audioResumeAt.current=position;
    setPlaybackReady(false);
    setAudioPreparing(true);
    try{
      const url=await waitForAudio(item.id,stream,()=>token!==audioToken.current);
      if(token!==audioToken.current)return;
      setExternalAudioUrl(url);
    }catch(reason){
      if(token!==audioToken.current)return;
      setAudioError(reason instanceof Error?reason.message:'The selected audio track could not be prepared.');
    }finally{
      if(token===audioToken.current)setAudioPreparing(false);
    }
  }

  function selectAudio(stream:number){
    if(canTranscode&&playbackInfo&&savePlaybackTrackSelection('audio',playbackInfo.audioTracks,stream))void prepareAudio(stream);
  }
  function selectSubtitle(stream:number|null){
    if(playbackInfo&&savePlaybackTrackSelection('subtitles',playbackInfo.subtitleTracks,stream))setSelectedSubtitle(stream);
  }

  async function selectQuality(preference:QualityPreference){
    if(!canTranscode&&preference!=='source')return;
    const video=videoRef.current;
    const position=video?.currentTime||current;
    saveQualityPreference(preference);
    setQualityPreference(preference);
    const height=resolvePreferredQuality(playbackInfo?.qualityOptions??qualityOptions,preference);
    setQualitySelectionError('');
    const original=preference==='source'||(height!==null&&height===playbackInfo?.qualityOptions[0]?.height);
    if(!original){
      setQuality(height);
      if(qualityState==='active'||qualityState==='starting')return;
    }
    if(original||height===null){
      releaseQuality();
      setQuality(height);
      qualityRequested.current=false;
      playbackBlocked.current=false;
      setPlaybackReady(true);
      if(playbackInfo?.requiresTranscode||fallback==='active'){
        sourceTransition.current=true;
        videoFallbackRequested.current=true;
        void startFallback(selectedAudio??undefined,position,wantsPlayback.current);
      }else if(video&&(video.src!==new URL(`/api/media/${item.id}/stream`,window.location.href).href||video.error)){
        sourceTransition.current=true;
        video.addEventListener('loadedmetadata',()=>{
          if(playbackItemId.current!==item.id)return;
          video.currentTime=position;
          sourceTransition.current=false;
          if(selectedAudio!==null&&selectedAudio!==playbackInfo?.defaultAudioStream)void prepareAudio(selectedAudio,playbackInfo,true,true);
          else if(wantsPlayback.current)requestVideoPlayback();
        },{once:true});
        video.src=`/api/media/${item.id}/stream`;video.load();
      }else{
        sourceTransition.current=false;
        if(wantsPlayback.current)requestVideoPlayback();
      }
      return;
    }
    const shouldResume=wantsPlayback.current;
    qualityRequested.current=true;
    sourceTransition.current=true;
    video?.pause();
    setPlaybackReady(false);
    const ready=await startQuality(selectedAudio??undefined,video?.currentTime||current,shouldResume);
    if(playbackItemId.current!==item.id)return;
    if(ready){sourceTransition.current=false;setPlaybackReady(true);return;}
    setPlaybackReady(false);
  }

  function prepareCompatibleVideo(){
    if(qualityRequested.current||qualityState==='starting'||qualityState==='active'||fallback!=='idle'||videoFallbackRequested.current)return;
    videoFallbackRequested.current=true;
    const video=videoRef.current;
    const shouldPlay=wantsPlayback.current;
    audioToken.current++;
    audioRef.current?.pause();
    setExternalAudioUrl('');
    setAudioPreparing(false);
    setAudioError('');
    void startFallback(selectedAudio??undefined,video?.currentTime||current,shouldPlay);
  }

  const pauseAction=playing||(playRequested&&(seekingPosition!==null||audioPreparing||qualityState==='starting'||fallback==='starting'));
  const playbackSettings=<PlaybackSettingsMenu key={item.id}
    audioTracks={playbackInfo?.audioTracks??[]}
    subtitleTracks={playbackInfo?.subtitleTracks??[]}
    selectedAudio={selectedAudio}
    selectedSubtitle={selectedSubtitle}
    qualityOptions={qualityOptions.length?qualityOptions:playbackInfo?.qualityOptions??[]}
    selectedQuality={selectedQuality}
    qualityPreference={qualityPreference}
    activeQuality={activeQuality}
    allowAutoQuality={!localPlayback}
    allowConversion={canTranscode}
    busy={audioPreparing||fallback==='starting'||qualityState==='starting'}
    unified={!shorts}
    pictureControls={!shorts&&<VideoSettingsPanel settings={presentation.settings} onChange={presentation.update} onReset={presentation.reset}/>}
    repeatMode={repeat} hasQueue={Boolean(queue?.length)} onRepeatChange={changeRepeat}
    pip={pip} onPip={pipSupported?()=>void togglePip():undefined}
    onSelectAudio={selectAudio}
    onSelectSubtitle={selectSubtitle}
    onSelectQuality={(height)=>void selectQuality(height)}
  />;
  return <div className={`player${shorts?' short-player':''}${queue?.length?' has-queue':''}${controlsVisible?' controls-visible':''}`} ref={containerRef} tabIndex={0} aria-label={item.title+' player'}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();revealControls();setContextPosition({x:event.clientX,y:event.clientY});}}
    onDoubleClick={()=>void fullscreen()} onPointerMove={(event)=>{clearLongPress();if(event.pointerType==='mouse'){revealControls();scheduleControlsHide();}}} onPointerDown={startLongPress} onPointerUp={()=>{clearLongPress();scheduleControlsHide();}} onPointerCancel={()=>{clearLongPress();scheduleControlsHide();}} onPointerLeave={scheduleControlsHide} onFocusCapture={revealControls} onBlurCapture={scheduleControlsHide}
    onKeyDown={event=>{revealControls();scheduleControlsHide();if(shorts&&(event.target===event.currentTarget||event.target===videoRef.current)&&[' ','k','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();toggle();return;}if(event.target===event.currentTarget&&(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect();setContextPosition({x:bounds.left+24,y:bounds.top+24,keyboard:true});}}}>
    <video
      className={shorts?'video-presentation short-video':'video-presentation'}
      tabIndex={shorts?0:undefined}
      aria-label={shorts?`${item.title}. Press Space to play or pause.`:undefined}
      style={presentation.style}
      ref={videoRef}
      src={`/api/media/${item.id}/stream`}
      playsInline
      loop={!shorts&&(repeat==='one'||(repeat==='queue'&&queue?.length===1))}
      preload={typeof readQualityPreference(!localPlayback,canTranscode)==='number'?'none':autoPlay?'auto':'metadata'}
      autoPlay={false}
      crossOrigin="anonymous"
      onClick={handleVideoClick}
      onVolumeChange={(event)=>{if(!externalAudioUrl){setMuted(event.currentTarget.muted);setVolume(event.currentTarget.volume);}}}
      onPlay={()=>{if(playbackBlocked.current){videoRef.current?.pause();return;}sourceTransition.current=false;setPlaying(true);syncExternalAudio(true);requestExternalAudioPlayback();revealControls();scheduleControlsHide();}}
      onPlaying={handlePlaying}
      onWaiting={handleWaiting}
      onSeeking={()=>audioRef.current?.pause()}
      onSeeked={(event)=>{if(acceptSeekPosition(event.currentTarget))syncExternalAudio(!event.currentTarget.paused);}}
      onPause={(e)=>{if(background.handlePause(e.currentTarget)){requestExternalAudioPlayback();return;}if(!sourceTransition.current&&!(shorts&&e.currentTarget.ended)){wantsPlayback.current=false;setPlayRequested(false);}audioRef.current?.pause();if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);audioRetryTimer.current=null;audioRetryCount.current=0;setPlaying(false);setBuffering(false);if(autoBufferTimer.current!==null)window.clearTimeout(autoBufferTimer.current);autoBufferTimer.current=null;revealControls();const v=e.currentTarget;void api.progress(playbackItemId.current,v.currentTime,fullDuration(v.duration,item.duration,duration));}}
      onLoadedMetadata={(e)=>{
        const v=e.currentTarget;playbackItemId.current=item.id;setDuration(fullDuration(v.duration,item.duration));
        if(initialResumeItem.current!==item.id){
          initialResumeItem.current=item.id;
          const resume=item.progress_position||0;
          if(resume>5 && (!v.duration || resume < v.duration*.92)) v.currentTime=resume;
        }
      }}
      onDurationChange={(e)=>setDuration(fullDuration(e.currentTarget.duration,item.duration,duration))}
      onCanPlay={(e)=>{
        if(!e.currentTarget.paused)syncExternalAudio(true);
        else if(wantsPlayback.current&&playbackReady&&fallback==='idle'&&qualityState==='idle'&&!audioPreparing)requestVideoPlayback();
      }}
      onTimeUpdate={(e)=>{
        if(background.audioIsClock()&&externalAudioUrl)return;
        const v=e.currentTarget;if(!acceptSeekPosition(v))return;setCurrent(v.currentTime);syncExternalAudio(!v.paused);
        if(Math.abs(v.currentTime-lastProgress.current)>5){lastProgress.current=v.currentTime;void api.progress(playbackItemId.current,v.currentTime,fullDuration(v.duration,item.duration,duration));}
      }}
      onRateChange={()=>syncExternalAudio(false)}
      onEnded={(e)=>{audioRef.current?.pause();const total=fullDuration(e.currentTarget.duration,item.duration,duration);void api.progress(playbackItemId.current,total,total);if(shorts){lastProgress.current=0;seek(0);if(wantsPlayback.current)requestVideoPlayback();}else onEnded?.();}}
      onError={prepareCompatibleVideo}
    >
      {selectedSubtitle!==null&&<HiddenSubtitleTrack
        key={selectedSubtitle}
        src={api.subtitleUrl(item.id,selectedSubtitle)}
        srcLang={playbackInfo?.subtitleTracks.find((track)=>track.index===selectedSubtitle)?.language||'und'}
        label={playbackInfo?.subtitleTracks.find((track)=>track.index===selectedSubtitle)?.title||'Subtitles'}
        onText={setActiveCaption}
      />}
    </video>
    <audio ref={audioRef} preload="auto" onTimeUpdate={event=>reportBackgroundAudio(event.currentTarget)}/>
    <DraggableCaption key={`${item.id}:${selectedSubtitle}`} text={activeCaption} controlsVisible={controlsVisible} containerRef={containerRef} onDraggingChange={(dragging)=>{if(dragging)revealControls();else window.setTimeout(scheduleControlsHide,0);}}/>
    {qualityState==='starting'&&playRequested&&(!playing||buffering)&&<div className="player-status"><SpinnerGap className="spin"/><strong>{seekingPosition!==null?'Seeking…':selectedQuality===null?'Buffering…':`Switching to ${qualityLabel(selectedQuality)}…`}</strong></div>}
    {audioPreparing&&playRequested&&<div className="player-status"><SpinnerGap className="spin"/><strong>Preparing audio…</strong><span>Only the audio track is being converted. The cached result will be reused.</span></div>}
    {fallback==='starting'&&playRequested&&(!playing||buffering) && <div className="player-status"><SpinnerGap className="spin"/><strong>{seekingPosition!==null?'Seeking…':playbackInfo?.requiresVideoTranscode?'Preparing video…':'Preparing audio…'}</strong></div>}
    {(qualitySelectionError||fallback==='error'||audioError||(qualityState==='error'&&qualityRequested.current&&!playing)) && <div className="player-status error"><strong>Playback unavailable</strong><span>{qualitySelectionError||audioError||error||qualityError}{playbackBlocked.current&&!qualitySelectionError?' Choose another quality to continue; your quality limit has been kept.':''}</span></div>}
    {!shorts&&<div className="player-gradient"/>}
    {shorts?<ShortsPlayerControls item={item} current={current} duration={duration} muted={muted} pip={pip}
      pipSupported={pipSupported} onSeek={seek} onMute={toggleMute} onPip={()=>void togglePip()} onNext={shorts.onNext}>
      {playbackSettings}
    </ShortsPlayerControls>:<div className="player-controls" onDoubleClick={event=>event.stopPropagation()}>
      <input className="player-seek" style={{'--range-fill':`${Math.min(100, duration > 0 ? current/duration*100 : 0)}%`} as React.CSSProperties} aria-label="Seek" type="range" min="0" max={Math.max(duration,1)} step="0.1" value={Math.min(current,Math.max(duration,1))} onChange={(e)=>seek(Number(e.target.value))}/>
      <div className="player-toolbar">
        <div className="player-transport">
        {onPrev && <button className="queue-previous" onClick={onPrev} aria-label="Previous video" disabled={!canGoPrev}><SkipBack weight="fill"/></button>}
        <button className="skip-button" onClick={()=>seekBy(-10)} aria-label="Rewind 10 seconds"><Rewind weight="bold"/></button>
        <button onClick={toggle} aria-label={pauseAction?'Pause':'Play'} aria-busy={audioPreparing}>{pauseAction?<Pause weight="fill"/>:<Play weight="fill"/>}</button>
        <button className="skip-button" onClick={()=>seekBy(10)} aria-label="Fast-forward 10 seconds"><FastForward weight="bold"/></button>
        {onNext && <button className="queue-next" onClick={onNext} aria-label="Next video" disabled={!canGoNext}><SkipForward weight="fill"/></button>}
        <button onClick={toggleMute} aria-label={muted?'Unmute':'Mute'}>{muted?<SpeakerSlash weight="fill"/>:<SpeakerHigh weight="fill"/>}</button>
        <input className="volume-slider" style={{'--range-fill':`${muted ? 0 : volume*100}%`} as React.CSSProperties} aria-label="Volume" type="range" min="0" max="1" step="0.05" value={muted?0:volume} onChange={(e)=>setVol(Number(e.target.value))}/>
        <span className="player-time">{time(current)} / {time(duration)}</span>
        {queue && queueIndex!==undefined && <span className="player-queue">{queueIndex+1} / {queue.length}</span>}
        </div>
        <div className="player-tools">
        <FavoriteButton item={item} iconOnly />
        {playbackSettings}
        <button onClick={()=>void fullscreen()} aria-label="Fullscreen"><ArrowsOut/></button>
        </div>
      </div>
    </div>}
    {contextPosition&&shorts&&<ShortsContextMenu item={item} position={contextPosition} returnFocus={videoRef.current}
      onPlay={()=>{wantsPlayback.current=true;setPlayRequested(true);requestVideoPlayback();}}
      onDetails={shorts.onDetails} onClose={()=>setContextPosition(null)} />}
    {contextPosition&&!shorts&&<PlayerActionMenu label="Video actions" position={contextPosition} returnFocus={containerRef.current} onClose={()=>setContextPosition(null)}
      actions={[
        {label:pauseAction?'Pause':'Play',icon:pauseAction?<Pause/>:<Play/>,action:toggle},
        {label:'Rewind 10 seconds',icon:<Rewind/>,action:()=>seekBy(-10)},
        {label:'Fast-forward 10 seconds',icon:<FastForward/>,action:()=>seekBy(10)},
        {label:muted?'Unmute':'Mute',icon:muted?<SpeakerSlash/>:<SpeakerHigh/>,action:toggleMute},
        {label:'Repeat video',icon:<Repeat/>,checked:repeat==='one',action:()=>changeRepeat(repeat==='one'?'off':'one')},
        {label:'Settings',icon:<Gear/>,action:()=>containerRef.current?.querySelector<HTMLButtonElement>('[data-setting="settings"]')?.click()},
        ...(pipSupported?[{label:pip?'Exit Picture in Picture':'Picture in Picture',icon:<PictureInPicture/>,action:()=>void togglePip()}]:[]),
        {label:'Fullscreen',icon:<ArrowsOut/>,action:()=>void fullscreen()}
      ]}/>}
  </div>;
}

async function waitForAudio(mediaId:number,audioStream:number,cancelled:()=>boolean){
  const started=await api.startAudioTranscode(mediaId,audioStream);
  if(started.status==='error')throw new Error(started.error||'Audio conversion failed.');
  if(started.status==='ready')return started.url;
  for(let attempt=0;attempt<1200;attempt++){
    await new Promise((resolve)=>window.setTimeout(resolve,250));
    if(cancelled())throw new DOMException('Audio preparation was cancelled.','AbortError');
    const status=await api.audioTranscodeStatus(mediaId,audioStream);
    if(status.status==='ready')return status.url;
    if(status.status==='error')throw new Error(status.error||'Audio conversion failed.');
  }
  throw new Error('Audio conversion did not finish in time.');
}

function time(value:number){if(!Number.isFinite(value))return '0:00';const h=Math.floor(value/3600);const m=Math.floor(value%3600/60);const s=Math.floor(value%60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${m}:${String(s).padStart(2,'0')}`;}
function fullDuration(...values:Array<number|null|undefined>){return Math.max(0,...values.filter((value):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0));}
function isLocalPlaybackHost(){return ['localhost','127.0.0.1','::1','[::1]'].includes(window.location.hostname.toLowerCase());}
