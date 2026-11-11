import { t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { useVolumeLeveling } from '../hooks/useVolumeLeveling';
import { audioMeasurement } from '../utils/volume-leveling';
import { ArrowsOut, FastForward, Pause, PictureInPicture, Play, Repeat, Rewind, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { LoadingSpinner } from './LoadingSpinner';
import { api } from '../api';
import { prepareBrowserAudio, prepareBrowserQuality, prepareBrowserSubtitle, probeBrowserPlayback } from '../browser-transcode';
import { useLocalMediaUrl } from '../hooks/useLocalMediaUrl';
import { playVideo } from '../utils/media-playback';
import { readQualityPreference, resolvePreferredQuality, saveQualityPreference, type QualityPreference } from '../utils/playback-quality';
import { resolvePlaybackTrackSelection, savePlaybackTrackSelection } from '../utils/playback-tracks';
import { toggleFullscreen } from '../utils/fullscreen';
import { DraggableCaption, HiddenSubtitleTrack } from './DraggableCaption';
import { FavoriteButton } from './FavoriteButton';
import { PlaybackSettingsMenu } from './PlaybackSettingsMenu';
import { ShortsContextMenu, ShortsPlayerControls, type ShortsPlaybackOptions } from './ShortsPlayerControls';
import { PlayerActionMenu } from './PlayerActionMenu';
import { type RepeatMode } from '../utils/playback-repeat';
import { useBackgroundPlayback } from '../hooks/useBackgroundPlayback';
import { usePlaybackVolume } from '../hooks/usePlaybackVolume';
import { usePlaybackSpeed } from '../hooks/usePlaybackSpeed';
import { PlayerControls } from './PlayerControls';
import { useVideoPresentation } from '../hooks/useVideoPresentation';
import { VideoSettingsPanel } from './VideoSettingsPanel';
import type { MediaItem, PlaybackInfo } from '../types';
import '../player-ui.css';
import '../video-settings.css';

interface PlayerProps {
  item: MediaItem;
  queue?: MediaItem[];
  queueIndex?: number;
  shuffled?: boolean;
  onShuffle?: () => void;
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

export function Player({item,queue,queueIndex,shuffled,onShuffle,onEnded,onNext,onPrev,canGoNext=true,canGoPrev=true,autoPlay,shorts,repeatMode,onRepeatChange}:PlayerProps) {
  useLocale();
  const aviSource = /\.avi$/i.test(item.filename);
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
  const touchRevealOnly = useRef(false);
  const audioPreparationToken = useRef(0);
  const subtitlePreparationToken = useRef(0);
  const qualityPreparationToken = useRef(0);
  const audioPreparationAbort = useRef<AbortController | null>(null);
  const qualityPreparationAbort = useRef<AbortController | null>(null);
  const qualityBlocked = useRef(true);
  const audioRetryTimer = useRef<number|null>(null);
  const audioRetryCount = useRef(0);
  const pendingAudio = useRef<{token:number;position:number;shouldPlay:boolean}|null>(null);
  const pendingQuality = useRef<{token:number;position:number;shouldPlay:boolean;restoreExternalAudio:boolean;url:string|null}|null>(null);
  const initialPositionApplied = useRef(false);
  const source = useLocalMediaUrl(item.id);
  const [mediaFile,setMediaFile] = useState<File|null>(null);
  const [playbackInfo,setPlaybackInfo] = useState<PlaybackInfo|null>(null);
  const [selectedAudio,setSelectedAudio] = useState<number|null>(null);
  const latestAudio = useRef<number|null>(null);
  useEffect(() => { latestAudio.current = selectedAudio; }, [selectedAudio]);
  const [selectedSubtitle,setSelectedSubtitle] = useState<number|null>(null);
  const [activeCaption,setActiveCaption] = useState('');
  const [externalAudioUrl,setExternalAudioUrl] = useState('');
  const [qualityUrl,setQualityUrl] = useState('');
  const [selectedQuality,setSelectedQuality] = useState<number|null>(null);
  const [qualityPreference,setQualityPreference] = useState(()=>readQualityPreference(false));
  const [subtitleUrl,setSubtitleUrl] = useState('');
  const [preparing,setPreparing] = useState<'audio'|'subtitles'|'quality'|null>(null);
  const [preparationProgress,setPreparationProgress] = useState(0);
  const [playbackError,setPlaybackError] = useState('');
  const [playbackReady,setPlaybackReady] = useState(false);
  const [playing,setPlaying] = useState(false);
  const [current,setCurrent] = useState(0);
  const [duration,setDuration] = useState(item.duration || 0);
  const volumeControls = usePlaybackVolume();
  const {volume,setVolume,muted,setMuted} = volumeControls;
  const {speed,changeSpeed} = usePlaybackSpeed(videoRef,audioRef,item.id,externalAudioUrl);
  const measurement=audioMeasurement(item.audio_loudness,item.size,item.mtime,playbackItemId.current===item.id?selectedAudio:null);
  const {leveling,setLeveling,levelingError,levelingSupported,onVolumeChange}=useVolumeLeveling(videoRef,audioRef,externalAudioUrl,volumeControls,measurement);
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
    wantsPlayback.current=Boolean(autoPlay);
    setPlayRequested(Boolean(autoPlay));
    playbackItemId.current=item.id;
    setContextPosition(null);
    audioPreparationToken.current++;
    subtitlePreparationToken.current++;
    qualityPreparationToken.current++;
    qualityBlocked.current=true;
    pendingAudio.current=null;
    pendingQuality.current=null;
    initialPositionApplied.current=false;
    audioRef.current?.pause();
    if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);
    audioRetryTimer.current=null;
    audioRetryCount.current=0;
    lastProgress.current=0;
    setMediaFile(null);
    setPlaybackInfo(null);
    setSelectedAudio(null);
    setSelectedSubtitle(null);
    setActiveCaption('');
    setExternalAudioUrl('');
    setQualityUrl('');
    setSelectedQuality(null);
    setSubtitleUrl('');
    setPreparing(null);
    setPreparationProgress(0);
    setPlaybackError('');
    setPlaybackReady(false);
    setPlaying(false);
    setCurrent(0);
    setDuration(item.duration||0);
  },[item.id]);

  useEffect(()=>{
    let current=true;
    api.mediaFile(item.id).then(async(file)=>{
      if(!current)return;
      setMediaFile(file);
      const info=await probeBrowserPlayback(file);
      if(!current)return;
      setPlaybackInfo(info);
      if(info.duration)setDuration(info.duration);
      const audio=resolvePlaybackTrackSelection('audio',info.audioTracks,info.defaultAudioStream);
      setSelectedAudio(audio);
      const subtitle=resolvePlaybackTrackSelection('subtitles',info.subtitleTracks,null);
      if(subtitle!==null)void prepareSubtitle(subtitle,file,true);
      const preference=readQualityPreference(false);
      setQualityPreference(preference);
      const height=resolvePreferredQuality(info.qualityOptions,preference);
      setSelectedQuality(height);
      if(height!==null&&(height!==info.qualityOptions[0]?.height||info.requiresVideoTranscode)){
        await prepareQuality(height,audio,file,info,true);
        return;
      }
      qualityBlocked.current=false;
      if(audio!==null&&(audio!==info.defaultAudioStream||info.requiresAudioTranscode)){
        const resume=item.progress_position||0;
        const position=initialPositionApplied.current?(videoRef.current?.currentTime||0):resume>5&&(!item.duration||resume<item.duration*.92)?resume:0;
        await prepareAudio(audio,file,info,true,position);
      }
      else{
        setPlaybackReady(true);
        if(wantsPlayback.current)requestVideoPlayback();
      }
    }).catch((reason)=>{
      if(!current)return;
      if(aviSource||typeof readQualityPreference(false)==='number'){
        qualityBlocked.current=true;
        sourceTransition.current=true;videoRef.current?.pause();audioRef.current?.pause();
        setPlaybackReady(false);
        setPlaybackError(reason instanceof Error?reason.message:'The selected quality could not be prepared.');
        return;
      }
      qualityBlocked.current=false;
      setPlaybackReady(true);
      if(wantsPlayback.current)requestVideoPlayback();
    });
    return()=>{current=false;audioPreparationToken.current++;subtitlePreparationToken.current++;qualityPreparationToken.current++;audioPreparationAbort.current?.abort();qualityPreparationAbort.current?.abort();};
  },[autoPlay,item.id]);

  useEffect(()=>{setActiveCaption('');},[item.id,selectedSubtitle]);

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

  useEffect(()=>()=>{if(controlsTimer.current!==null)window.clearTimeout(controlsTimer.current);},[]);

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
    touchRevealOnly.current=!shorts&&event.pointerType==='touch'&&!controlsVisible&&event.target===videoRef.current;
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
  function scheduleControlsHide(delay=2400){
    if(shorts)return;
    if(controlsTimer.current!==null)window.clearTimeout(controlsTimer.current);
    const video=videoRef.current;
    if(!video||video.paused){controlsTimer.current=null;return;}
    controlsTimer.current=window.setTimeout(()=>{
      const keyboardFocus=containerRef.current?.querySelector(':focus-visible');
      if(keyboardFocus||document.querySelector('.player-action-menu')||containerRef.current?.querySelector('[aria-haspopup][aria-expanded="true"]')){scheduleControlsHide();return;}
      setControlsVisible(false);
      controlsTimer.current=null;
    },delay);
  }

  function syncExternalAudio(play=false,audio=audioRef.current){
    const video=videoRef.current;
    if(!video||!audio||!externalAudioUrl||background.audioIsClock())return;
    if(audio.readyState>=HTMLMediaElement.HAVE_METADATA&&Math.abs(audio.currentTime-video.currentTime)>.18){
      try{audio.currentTime=video.currentTime;}catch{/* wait for the selected track to become seekable */}
    }
    audio.playbackRate=video.playbackRate;
    if(play)requestExternalAudioPlayback(audio);
  }
  function requestExternalAudioPlayback(audio=audioRef.current){
    const video=videoRef.current;
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
        requestExternalAudioPlayback(audio);
      },150);
    });
  }
  function requestVideoPlayback(){
    const video=videoRef.current;
    const requestItemId=item.id;
    if(!video||qualityBlocked.current)return;
    void playVideo(video,()=>wantsPlayback.current&&!qualityBlocked.current&&playbackItemId.current===requestItemId,()=>{
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
    if(!video||!wantsPlayback.current||!playbackReady||qualityBlocked.current||sourceTransition.current)return;
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
    const preparingPlayback=preparing==='audio'||preparing==='quality';
    const next=preparingPlayback||background.suspended.current?!wantsPlayback.current:video.paused;
    wantsPlayback.current=next;
    setPlayRequested(next);
    if(next){audioRetryCount.current=0;requestVideoPlayback();}
    else {pausePlayback();}
  }
  function handleVideoClick(){
    if(longPressTriggered.current){longPressTriggered.current=false;return;}
    const revealOnly=touchRevealOnly.current||(!shorts&&usesTouchControls()&&!controlsVisible);
    touchRevealOnly.current=false;
    if(revealOnly){revealControls();scheduleControlsHide();return;}
    toggle();revealControls();
  }
  function seek(value:number){
    const video=videoRef.current;if(!video)return;
    if(playbackInfo?.requiresVideoTranscode&&pendingQuality.current&&selectedQuality!==null){
      setCurrent(value);void prepareQuality(selectedQuality,latestAudio.current,mediaFile,playbackInfo,false,value);return;
    }
    video.currentTime=value;
    const audio=audioRef.current;
    if(audio&&externalAudioUrl&&audio.readyState>=HTMLMediaElement.HAVE_METADATA){try{audio.currentTime=value;}catch{/* retry on seeked */}}
    setCurrent(value);
  }
  function seekBy(seconds:number){const v=videoRef.current;if(!v)return;seek(Math.max(0,Math.min(v.duration || duration,current + seconds)));}
  function toggleMute(){setMuted(value=>!value);}
  function setVol(value:number){setMuted(false);setVolume(value);}
  async function fullscreen(){const container=containerRef.current;const video=videoRef.current;if(!container||!video)return;await toggleFullscreen(container,video);}
  async function togglePip(){const v=videoRef.current;if(!v||!pipSupported)return;if(document.pictureInPictureElement)await document.exitPictureInPicture();else await v.requestPictureInPicture().catch(()=>{});}
  async function prepareAudio(stream:number,file=mediaFile,info=playbackInfo,initial=false,resumeAt?:number){
    if(!file||!info)return;
    if(!initial&&selectedAudio===stream)return;
    const token=++audioPreparationToken.current;
    audioPreparationAbort.current?.abort();
    const controller = new AbortController(); audioPreparationAbort.current = controller;
    const video=videoRef.current;
    const shouldResume=wantsPlayback.current;
    const position=resumeAt??(video?.currentTime||0);
    setSelectedAudio(stream);
    const track=info.audioTracks.find((candidate)=>candidate.index===stream);
    const canUseOriginal=!qualityUrl&&stream===info.defaultAudioStream&&track?.supported&&['aac','flac','mp3','opus','vorbis'].includes(track.codec);
    if(canUseOriginal){
      const audio=audioRef.current;
      audio?.pause();
      audio?.removeAttribute('src');
      audio?.load();
      pendingAudio.current=null;
      sourceTransition.current=false;
      setExternalAudioUrl('');
      setPreparing(null);
      setPlaybackReady(true);
      if(video)video.currentTime=position;
      if(shouldResume)queueMicrotask(()=>{if(token===audioPreparationToken.current&&wantsPlayback.current)requestVideoPlayback();});
      return;
    }
    sourceTransition.current=true;
    video?.pause();
    audioRef.current?.pause();
    pendingAudio.current={token,position,shouldPlay:shouldResume};
    setPlaybackReady(false);
    setPreparing('audio');setPreparationProgress(0);setPlaybackError('');
    try{
      const url=await prepareBrowserAudio(file,stream,(progress)=>{if(token===audioPreparationToken.current)setPreparationProgress(progress);}, {
        position, duration: item.duration || video?.duration || duration, signal: controller.signal, getElement: () => audioRef.current,
        onSeek: target => { if(token===audioPreparationToken.current) void prepareAudio(stream,file,info,true,target); },
        onError: error => { if(token===audioPreparationToken.current){pendingAudio.current=null;setPreparing(null);setPlaybackReady(false);setPlaybackError(error.message);} }
      });
      if(token!==audioPreparationToken.current)return;
      setExternalAudioUrl(url);
      if(audioRef.current?.currentSrc===url)finishPreparedAudio(audioRef.current);
    }catch(reason){if(token===audioPreparationToken.current){pendingAudio.current=null;setPlaybackReady(false);setPlaybackError(reason instanceof Error?reason.message:'The selected audio track could not be prepared.');}}
    finally{if(token===audioPreparationToken.current&&!pendingAudio.current)setPreparing(null);}
  }
  async function prepareQuality(height:number,audioStream=selectedAudio,file=mediaFile,info=playbackInfo,initial=false,seekAt?:number){
    if(!file||!info||(!initial&&seekAt===undefined&&!qualityBlocked.current&&selectedQuality===height&&audioStream===selectedAudio))return;
    const originalHeight=info.qualityOptions[0]?.height;
    if(!originalHeight)return;
    const token=++qualityPreparationToken.current;
    qualityPreparationAbort.current?.abort();
    const controller = new AbortController(); qualityPreparationAbort.current = controller;
    audioPreparationToken.current++; audioPreparationAbort.current?.abort(); pendingAudio.current = null;
    const video=videoRef.current;
    const position=seekAt??(initial?(item.progress_position||0):(video?.currentTime||0));
    const shouldPlay=wantsPlayback.current;
    sourceTransition.current=true;
    qualityBlocked.current=true;
    video?.pause();audioRef.current?.pause();
    setSelectedQuality(height);
    setPlaybackReady(false);setPlaybackError('');setPreparing('quality');setPreparationProgress(0);
    const selectedTrack=info.audioTracks.find((track)=>track.index===audioStream);
    const directOriginalAudio=audioStream===info.defaultAudioStream&&selectedTrack?.supported&&['aac','flac','mp3','opus','vorbis'].includes(selectedTrack.codec);
    pendingQuality.current={token,position,shouldPlay,restoreExternalAudio:height===originalHeight&&!info.requiresVideoTranscode&&!directOriginalAudio&&audioStream!==null,url:null};
    try{
      if(height===originalHeight&&!info.requiresVideoTranscode){
        pendingQuality.current.url=source.url;
        setExternalAudioUrl('');
        setQualityUrl('');
        if(video&&video.currentSrc===source.url)handleLoadedMetadata(video);
      }else{
        const url=await prepareBrowserQuality(file,height,audioStream,(progress)=>{if(token===qualityPreparationToken.current)setPreparationProgress(progress);}, {
          position, duration: info.duration || item.duration || video?.duration || duration, signal: controller.signal, getElement: () => videoRef.current,
          onSeek: target => { if(token===qualityPreparationToken.current) void prepareQuality(height,latestAudio.current,file,info,false,target); },
          onError: error => { if(token===qualityPreparationToken.current){pendingQuality.current=null;qualityBlocked.current=true;sourceTransition.current=true;videoRef.current?.pause();audioRef.current?.pause();setPreparing(null);setPlaybackReady(false);setPlaybackError(error.message);} }
        });
        if(token!==qualityPreparationToken.current)return;
        pendingQuality.current!.url=url;
        setExternalAudioUrl('');
        setQualityUrl(url);
        if(video&&video.currentSrc===url)handleLoadedMetadata(video);
      }
    }catch(reason){
      if(token===qualityPreparationToken.current){
        pendingQuality.current=null;setPlaybackReady(false);
        setPlaybackError((reason instanceof Error?reason.message:'The selected quality could not be prepared.')+' Choose another quality to continue; your quality limit has been kept.');
      }
    }finally{if(token===qualityPreparationToken.current&&!pendingQuality.current)setPreparing(null);}
  }
  function selectQuality(preference:QualityPreference) {
    if(!playbackInfo)return;
    saveQualityPreference(preference);
    setQualityPreference(preference);
    const height=resolvePreferredQuality(playbackInfo.qualityOptions,preference);
    if(height!==null)void prepareQuality(height);
  }
  function handleLoadedMetadata(video:HTMLVideoElement){
    playbackItemId.current=item.id;setDuration(video.duration||item.duration||0);
    const quality=pendingQuality.current;
    if(quality&&quality.token===qualityPreparationToken.current){
      if(!quality.url||video.currentSrc!==quality.url)return;
      video.currentTime=quality.position;
      pendingQuality.current=null;
      setPreparing(null);
      sourceTransition.current=false;
      qualityBlocked.current=false;
      if(quality.restoreExternalAudio&&selectedAudio!==null){
        void prepareAudio(selectedAudio,mediaFile,playbackInfo,true);
      }else{
        setPlaybackReady(true);
        if(wantsPlayback.current)requestVideoPlayback();
      }
      return;
    }
    if(initialPositionApplied.current)return;
    initialPositionApplied.current=true;
    const resume=item.progress_position||0;
    if(resume>5&&(!video.duration||resume<video.duration*.92))video.currentTime=resume;
  }
  function selectAudio(stream:number){
    if(!playbackInfo||!savePlaybackTrackSelection('audio',playbackInfo.audioTracks,stream))return;
    if(stream===selectedAudio)return;
    setSelectedAudio(stream);
    if(playbackInfo.requiresVideoTranscode&&selectedQuality!==null){void prepareQuality(selectedQuality,stream);return;}
    if(qualityBlocked.current){
      if(selectedQuality===null)return;
      void prepareQuality(selectedQuality,stream);
      return;
    }
    void prepareAudio(stream);
  }
  function finishPreparedAudio(audio:HTMLAudioElement){
    const pending=pendingAudio.current;
    const video=videoRef.current;
    if(!pending||pending.token!==audioPreparationToken.current||!video||audio.readyState<HTMLMediaElement.HAVE_METADATA)return;
    try{audio.currentTime=pending.position;}catch{return;}
    video.currentTime=pending.position;
    audio.playbackRate=video.playbackRate;
    pendingAudio.current=null;
    setPreparing(null);
    sourceTransition.current=false;
    setPlaybackReady(true);
    if(wantsPlayback.current){
      const result=video.play();
      if(result)void result.then(()=>requestExternalAudioPlayback(audio)).catch(()=>{});
    }
  }
  function selectSubtitle(stream:number|null){
    if(playbackInfo&&savePlaybackTrackSelection('subtitles',playbackInfo.subtitleTracks,stream))void prepareSubtitle(stream);
  }
  async function prepareSubtitle(stream:number|null,file=mediaFile,initial=false){
    const token=++subtitlePreparationToken.current;
    setSelectedSubtitle(stream);setPlaybackError('');
    setSubtitleUrl('');
    if(stream===null||!file)return;
    if(!initial){setPreparing('subtitles');setPreparationProgress(0);}
    try{
      const url=await prepareBrowserSubtitle(file,stream);
      if(token===subtitlePreparationToken.current)setSubtitleUrl(url);
    }
    catch(reason){if(token===subtitlePreparationToken.current)setPlaybackError(reason instanceof Error?reason.message:'The selected subtitles could not be prepared.');}
    finally{if(!initial&&token===subtitlePreparationToken.current)setPreparing(null);}
  }

  const pauseAction=playing||(playRequested&&(preparing==='audio'||preparing==='quality'));
  const playbackSettings=(context=false)=><PlaybackSettingsMenu key={item.id} context={context}
    audioTracks={playbackInfo?.audioTracks??[]}
    subtitleTracks={playbackInfo?.subtitleTracks??[]}
    selectedAudio={selectedAudio}
    selectedSubtitle={selectedSubtitle}
    qualityOptions={playbackInfo?.qualityOptions??[]}
    selectedQuality={selectedQuality}
    qualityPreference={qualityPreference}
    busy={preparing!==null}
    unified={!shorts}
    pictureControls={!shorts&&<VideoSettingsPanel settings={presentation.settings} onChange={presentation.update} onReset={presentation.reset}/>}
    repeatMode={repeat} hasQueue={Boolean(queue?.length)} onRepeatChange={changeRepeat}
    speed={speed} onSpeedChange={changeSpeed}
    leveling={leveling} onLevelingChange={setLeveling} levelingError={levelingError} levelingAvailable={levelingSupported}
    onSelectAudio={selectAudio}
    onSelectSubtitle={selectSubtitle}
    onSelectQuality={selectQuality}
  />;
  return <div className={`player${shorts?' short-player':''}${queue?.length?' has-queue':''}${controlsVisible?' controls-visible':''}`} ref={containerRef} tabIndex={0} aria-label={t("{value0} player", { value0: item.title })}
    onContextMenu={event=>{event.preventDefault();event.stopPropagation();revealControls();setContextPosition({x:event.clientX,y:event.clientY});}}
    onDoubleClick={()=>void fullscreen()} onPointerMove={(event)=>{clearLongPress();if(event.pointerType==='mouse'){revealControls();scheduleControlsHide();}}} onPointerDown={startLongPress} onPointerUp={()=>{clearLongPress();scheduleControlsHide();}} onPointerCancel={()=>{touchRevealOnly.current=false;clearLongPress();scheduleControlsHide();}} onPointerLeave={()=>scheduleControlsHide(300)} onFocusCapture={revealControls} onBlurCapture={()=>scheduleControlsHide(300)}
    onKeyDown={event=>{revealControls();scheduleControlsHide();if(shorts&&(event.target===event.currentTarget||event.target===videoRef.current)&&[' ','k','Enter'].includes(event.key)){event.preventDefault();event.stopPropagation();toggle();return;}if(event.target===event.currentTarget&&(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))){event.preventDefault();const bounds=event.currentTarget.getBoundingClientRect();setContextPosition({x:bounds.left+24,y:bounds.top+24,keyboard:true});}}}>
    <video
      className={shorts?'video-presentation short-video':'video-presentation'}
      tabIndex={shorts?0:undefined}
      aria-label={shorts?t('{value0}. Press Space to play or pause.',{value0:item.title}):undefined}
      style={presentation.style}
      ref={videoRef}
      src={qualityUrl||((!aviSource||playbackInfo?.requiresVideoTranscode===false)?source.url:undefined)||undefined}
      playsInline
      loop={!shorts&&(repeat==='one'||(repeat==='queue'&&queue?.length===1))}
      preload={typeof readQualityPreference(false)==='number'?'none':autoPlay?'auto':'metadata'}
      autoPlay={false}
      onClick={handleVideoClick}
      onVolumeChange={event=>onVolumeChange(event.currentTarget)}
      onPlay={()=>{if(qualityBlocked.current){videoRef.current?.pause();return;}sourceTransition.current=false;setPlaying(true);syncExternalAudio(true);requestExternalAudioPlayback();revealControls();scheduleControlsHide();}}
      onPlaying={()=>syncExternalAudio(true)}
      onWaiting={()=>{if(!background.audioIsClock())audioRef.current?.pause();}}
      onSeeking={()=>audioRef.current?.pause()}
      onSeeked={()=>syncExternalAudio(!videoRef.current?.paused)}
      onPause={(e)=>{if(background.handlePause(e.currentTarget)){requestExternalAudioPlayback();return;}if(!sourceTransition.current&&!(shorts&&e.currentTarget.ended)){wantsPlayback.current=false;setPlayRequested(false);}audioRef.current?.pause();if(audioRetryTimer.current!==null)window.clearTimeout(audioRetryTimer.current);audioRetryTimer.current=null;audioRetryCount.current=0;setPlaying(false);revealControls();const v=e.currentTarget;void api.progress(playbackItemId.current,v.currentTime,v.duration||duration);}}
      onLoadedMetadata={(e)=>handleLoadedMetadata(e.currentTarget)}
      onCanPlay={(e)=>{if(wantsPlayback.current&&playbackReady&&e.currentTarget.paused&&!pendingQuality.current&&!pendingAudio.current)requestVideoPlayback();}}
      onTimeUpdate={(e)=>{
        if(background.audioIsClock()&&externalAudioUrl)return;
        const v=e.currentTarget;setCurrent(v.currentTime);syncExternalAudio(!v.paused);
        if(Math.abs(v.currentTime-lastProgress.current)>5){lastProgress.current=v.currentTime;void api.progress(playbackItemId.current,v.currentTime,v.duration||duration);}
      }}
      onRateChange={()=>syncExternalAudio(false)}
      onEnded={(e)=>{audioRef.current?.pause();void api.progress(playbackItemId.current,e.currentTarget.duration,e.currentTarget.duration);if(shorts){lastProgress.current=0;seek(0);if(wantsPlayback.current)requestVideoPlayback();}else onEnded?.();}}
      onError={()=>setPlaybackError('This browser cannot play this video format or codec.')}
    >
      {subtitleUrl&&selectedSubtitle!==null&&<HiddenSubtitleTrack
        key={subtitleUrl}
        src={subtitleUrl}
        srcLang={playbackInfo?.subtitleTracks.find((track)=>track.index===selectedSubtitle)?.language||'und'}
        label={playbackInfo?.subtitleTracks.find((track)=>track.index===selectedSubtitle)?.title||t("Subtitles")}
        onText={setActiveCaption}
      />}
    </video>
    <audio key={externalAudioUrl||'native-audio'} ref={audioRef} src={externalAudioUrl||undefined} preload="auto" onVolumeChange={event=>onVolumeChange(event.currentTarget)} onTimeUpdate={event=>reportBackgroundAudio(event.currentTarget)} onLoadedMetadata={(event)=>finishPreparedAudio(event.currentTarget)} onCanPlay={(event)=>finishPreparedAudio(event.currentTarget)}/>
    <DraggableCaption key={`${item.id}:${selectedSubtitle}`} text={activeCaption} controlsVisible={controlsVisible} containerRef={containerRef} onDraggingChange={(dragging)=>{if(dragging)revealControls();else window.setTimeout(scheduleControlsHide,0);}}/>
    {source.loading && <div className="player-status"><LoadingSpinner/><strong>{t("Opening video…")}</strong><span>{t("Reading the selected local file.")}</span></div>}
    {aviSource&&!playbackInfo&&!source.loading&&!source.error&&!playbackError&&<div className="player-status"><LoadingSpinner/><strong>{t("Preparing AVI playback…")}</strong></div>}
    {preparing&&preparing!=='subtitles'&&playRequested&&!playing&&<div className="player-status"><LoadingSpinner/><strong>{preparing==='audio'?t("Preparing audio…"):preparing==='quality'?t("Preparing {value0}…", { value0: selectedQuality&&selectedQuality>=2160?'4K':`${selectedQuality}p` }):t("Preparing subtitles…")}</strong>{preparationProgress>0&&<span>{Math.round(preparationProgress*100)}%</span>}</div>}
    {preparing==='subtitles'&&<span className="sr-only" role="status">{t("Preparing subtitles…")}</span>}
    {(source.error || playbackError) && <div className="player-status error"><strong>{t("Playback unavailable")}</strong><span>{source.error || playbackError}</span></div>}
    {shorts?<ShortsPlayerControls item={item} current={current} duration={duration} muted={muted} pip={pip}
      pipSupported={pipSupported} onSeek={seek} onMute={toggleMute} onPip={()=>void togglePip()} onNext={shorts.onNext}>
      {playbackSettings()}
    </ShortsPlayerControls>:<PlayerControls current={current} duration={duration} paused={!pauseAction}
      busy={preparing==='audio'||preparing==='quality'}
      volume={volume} muted={muted} pip={pip} pipSupported={pipSupported}
      canGoPrev={canGoPrev} canGoNext={canGoNext} hasQueue={Boolean(queue?.length)}
      queuePosition={queue&&queueIndex!==undefined?`${queueIndex+1} / ${queue.length}`:undefined}
      shuffled={shuffled} onShuffle={onShuffle} repeat={repeat} onRepeat={changeRepeat}
      onToggle={toggle} onSeek={seek} onSeekBy={seekBy} onPrev={onPrev} onNext={onNext}
      onVolume={setVol} onMute={toggleMute} onFullscreen={()=>void fullscreen()} onPip={()=>void togglePip()}
      favorite={<FavoriteButton item={item} iconOnly/>} settings={playbackSettings()}/>}
    {contextPosition&&shorts&&<ShortsContextMenu item={item} position={contextPosition} returnFocus={videoRef.current}
      onPlay={()=>{wantsPlayback.current=true;setPlayRequested(true);requestVideoPlayback();}}
      onDetails={shorts.onDetails} onClose={()=>setContextPosition(null)} />}
    {contextPosition&&!shorts&&<PlayerActionMenu label={t("Video actions")} position={contextPosition} returnFocus={containerRef.current} onClose={()=>setContextPosition(null)}
      actions={[
        {label:pauseAction?'Pause':'Play',icon:pauseAction?<Pause/>:<Play/>,action:toggle},
        {label:t("Rewind 10 seconds"),icon:<Rewind/>,action:()=>seekBy(-10)},
        {label:t("Fast-forward 30 seconds"),icon:<FastForward/>,action:()=>seekBy(30)},
        {label:muted?'Unmute':'Mute',icon:muted?<SpeakerSlash/>:<SpeakerHigh/>,action:toggleMute},
        {label:t("Repeat video"),icon:<Repeat/>,checked:repeat==='one',action:()=>changeRepeat(repeat==='one'?'off':'one')},
        {label:t("Settings"),content:playbackSettings(true)},
        ...(pipSupported?[{label:pip?'Exit Picture in Picture':'Picture in Picture',icon:<PictureInPicture/>,action:()=>void togglePip()}]:[]),
        {label:t("Fullscreen"),icon:<ArrowsOut/>,action:()=>void fullscreen()}
      ]}/>}
  </div>;
}
