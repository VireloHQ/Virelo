import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { CaretLeft, CaretRight, Check, DotsThree, Gauge, Gear, MonitorPlay, Repeat, SlidersHorizontal, SpeakerHigh, Subtitles, Waveform } from '@phosphor-icons/react';
import { PLAYBACK_SPEEDS, speedLabel } from '../utils/playback-speed';
import type { PlaybackQuality, PlaybackTrack } from '../types';
import type { QualityPreference } from '../utils/playback-quality';
import { repeatLabels, type RepeatMode } from '../utils/playback-repeat';
import { sidePopoverPlacement } from '../utils/context-menu';

type Setting = 'settings'|'quality'|'audio'|'subtitles'|'video'|'repeat'|'speed';
type FocusRequest = 'first'|'last'|'selected'|Setting;

interface PlaybackSettingsMenuProps {
  audioTracks: PlaybackTrack[];
  subtitleTracks: PlaybackTrack[];
  selectedAudio: number|null;
  selectedSubtitle: number|null;
  busy?: boolean;
  qualityOptions: PlaybackQuality[];
  selectedQuality: number|null;
  qualityPreference: QualityPreference;
  activeQuality?: number|null;
  allowAutoQuality?: boolean;
  allowConversion?: boolean;
  unified?: boolean;
  context?: boolean;
  pictureControls?: ReactNode;
  repeatMode?: RepeatMode;
  hasQueue?: boolean;
  onRepeatChange?: (mode: RepeatMode) => void;
  speed?: number;
  onSpeedChange?: (speed: number) => void;
  onSelectAudio: (stream: number) => void;
  onSelectSubtitle: (stream: number|null) => void;
  onSelectQuality: (preference: QualityPreference) => void;
}

const titles: Record<Setting,string> = { settings:'Settings', quality:'Quality', audio:'Audio', subtitles:'Subtitles', video:'Picture', repeat:'Repeat', speed:'Playback speed' };

export function PlaybackSettingsMenu({
  audioTracks, subtitleTracks, selectedAudio, selectedSubtitle, busy=false,
  qualityOptions, selectedQuality, qualityPreference, activeQuality=null, allowAutoQuality=false, allowConversion=true,
  unified=false, context=false, pictureControls, repeatMode='off', hasQueue=false, onRepeatChange, speed=1, onSpeedChange,
  onSelectAudio, onSelectSubtitle, onSelectQuality
}: PlaybackSettingsMenuProps) {
  const [menu,setMenu] = useState<{section:Setting;open:boolean}>({section:'settings',open:false});
  const open=menu.open?menu.section:null;
  const shown=menu.section;
  function setOpen(action:SetStateAction<Setting|null>) {
    setMenu(previous=>{
      const next=typeof action==='function'?action(previous.open?previous.section:null):action;
      return next?{section:next,open:true}:{...previous,open:false};
    });
  }
  const [animateOpen,setAnimateOpen] = useState(false);
  const [placement,setPlacement] = useState({left:0,top:0,width:280,maxHeight:320,anchor:140,side:'above'});
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusRequest = useRef<FocusRequest>('selected');
  const menuId = useId();

  function trigger(setting:Setting) {
    return rootRef.current?.querySelector<HTMLButtonElement>('[data-setting="' + (unified?'settings':setting) + '"]');
  }
  function closeMenu(returnFocus=false) {
    if(returnFocus&&open)trigger(open)?.focus({preventScroll:true});
    setOpen(null);
  }
  function focusOption(which:FocusRequest) {
    const options=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
    const requested=options.find(button=>button.dataset.setting===which);
    const selected=options.find(button=>button.getAttribute('aria-checked')==='true'||button.getAttribute('aria-pressed')==='true');
    const option=requested||(which==='last'?options.at(-1):which==='selected'?selected||options[0]:options[0]);
    (option||menuRef.current)?.focus({preventScroll:true});
  }
  function goBack() {
    focusRequest.current=open||'first';
    setOpen('settings');
  }

  useEffect(()=>{
    if(!open)return;
    const outside=(event:PointerEvent)=>{
      const target=event.target as Node;
      if(!rootRef.current?.contains(target)&&!menuRef.current?.contains(target))setOpen(null);
    };
    const escape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&!menuRef.current?.contains(event.target as Node)&&!rootRef.current?.contains(event.target as Node)){
        event.preventDefault();closeMenu(true);
      }
    };
    document.addEventListener('pointerdown',outside);
    document.addEventListener('keydown',escape);
    return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape);};
  },[open]);

  useLayoutEffect(()=>{
    if(!open)return;
    const controls=rootRef.current?.closest<HTMLElement>(context?'.player-action-menu':'.player-controls');
    const player=context?controls:rootRef.current?.closest<HTMLElement>('.player');
    if(!controls||!player)return;
    const position=()=>{
      const bounds=controls.getBoundingClientRect(), button=trigger(open)?.getBoundingClientRect();
      if(!button)return;
      const limit=open==='video'?440:320;
      const width=Math.min(open==='video'?300:280,context?window.innerWidth-32:bounds.width-16,window.innerWidth-16);
      const above=Math.max(0,button.top-22), below=Math.max(0,window.innerHeight-button.bottom-22);
      const content=menuRef.current?.querySelector<HTMLElement>('.video-settings-content,.playback-track-list');
      const desiredHeight=Math.min(limit,(content?.scrollHeight||0)
        +(menuRef.current?.querySelector<HTMLElement>('.playback-menu-heading')?.offsetHeight||36)+16);
      if(context) {
        const side=sidePopoverPlacement(button,{width,height:desiredHeight},{width:innerWidth,height:innerHeight});
        const next={...side,maxHeight:Math.min(limit,side.maxHeight)};
        setPlacement(previous=>Object.keys(next).every(key=>previous[key as keyof typeof previous]===next[key as keyof typeof next])?previous:next);
        return;
      }
      const placeAbove=above>=desiredHeight||above>=below;
      const maxHeight=Math.min(limit,placeAbove?above:below);
      const height=Math.min(desiredHeight,maxHeight);
      const left=Math.max(8,Math.min(button.left+button.width/2+28-width,window.innerWidth-width-8));
      const next={width,maxHeight,left,
        anchor:Math.max(24,Math.min(button.left+button.width/2-left,width-24)),
        side:placeAbove?'above':'below',
        top:placeAbove?Math.max(8,button.top-height-14):button.bottom+14};
      setPlacement(previous=>Object.keys(next).every(key=>previous[key as keyof typeof previous]===next[key as keyof typeof next])?previous:next);
    };
    position();
    focusOption(focusRequest.current);
    const resize=new ResizeObserver(position);
    resize.observe(player);resize.observe(controls);
    if(menuRef.current)resize.observe(menuRef.current);
    window.addEventListener('resize',position);
    window.addEventListener('scroll',position,true);
    document.addEventListener('fullscreenchange',position);
    return()=>{
      resize.disconnect();
      window.removeEventListener('resize',position);
      window.removeEventListener('scroll',position,true);
      document.removeEventListener('fullscreenchange',position);
    };
  },[open,unified,context]);

  function toggleMenu(setting:Setting,pointer:boolean) {
    focusRequest.current='selected';
    setAnimateOpen(pointer);
    setOpen(value=>(unified&&value)||value===setting?null:setting);
  }
  function select(action:()=>void) { closeMenu(true); action(); }
  function settingButton(setting:Setting,label:string,icon:ReactNode,detail?:string) {
    const expanded=unified?Boolean(open):open===setting;
    return <button type="button" role={context?'menuitem':undefined} data-setting={setting} className={expanded?'active':''}
      aria-label={label} title={detail?label+': '+detail:label} aria-haspopup="menu"
      aria-expanded={expanded} aria-controls={expanded?menuId:undefined}
      onClick={event=>toggleMenu(setting,event.detail>0)}
      onKeyDownCapture={()=>setAnimateOpen(false)}
      onKeyDown={event=>{
        if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();closeMenu(true);return;}
        if((context&&event.key==='ArrowRight')||(!context&&(event.key==='ArrowDown'||event.key==='ArrowUp'))){
          event.preventDefault();event.stopPropagation();
          setAnimateOpen(false);
          focusRequest.current=event.key==='ArrowUp'?'last':'first';
          if(open===setting)focusOption(focusRequest.current);else setOpen(setting);
        }
      }}>
      {icon}{!unified&&setting!=='quality'&&<span className="playback-setting-label">{label}</span>}
    </button>;
  }
  function sectionButton(setting:Setting,icon:ReactNode,detail:string) {
    return <button type="button" role="menuitem" aria-label={titles[setting]} data-setting={setting} aria-haspopup={setting==='video'?'dialog':'menu'}
      className="playback-setting-row" disabled={busy&&['quality','audio','subtitles'].includes(setting)}
      onClick={event=>{focusRequest.current='selected';setAnimateOpen(event.detail>0);setOpen(setting);}}>
      {icon}<span><strong>{titles[setting]}</strong><small>{detail}</small></span><CaretRight/>
    </button>;
  }

  const label=titles[shown];
  const displayedQuality=qualityPreference==='source'?'Original':qualityPreference==='auto'&&allowAutoQuality?'Auto':qualityLabel(selectedQuality??activeQuality??qualityOptions[0]?.height);
  const selectedAudioTrack=audioTracks.find(track=>track.index===selectedAudio);
  const selectedSubtitleTrack=subtitleTracks.find(track=>track.index===selectedSubtitle);
  const audioLabel=selectedAudioTrack?trackLabel(selectedAudioTrack,'Audio',selectedAudioTrack.typeIndex+1):'Default';
  const subtitleLabel=selectedSubtitleTrack?trackLabel(selectedSubtitleTrack,'Subtitle',selectedSubtitleTrack.typeIndex+1):'Off';

  return <div className={'playback-settings'+(context?' context-playback-settings':'')} ref={rootRef} onDoubleClick={event=>event.stopPropagation()}>
    {unified?settingButton('settings',context?'Settings':'Playback settings',context?<><Gear/><span>Settings</span><CaretRight/></>:<DotsThree/>):<>
      {qualityOptions.length>0&&settingButton('quality','Quality',<><MonitorPlay/><span className="playback-quality-label">{displayedQuality}</span></>,displayedQuality)}
      {allowConversion&&audioTracks.length>1&&settingButton('audio','Audio',<Waveform/>,audioLabel)}
      {subtitleTracks.length>0&&settingButton('subtitles','Subtitles',<Subtitles weight={selectedSubtitle===null?'regular':'fill'}/>,subtitleLabel)}
    </>}
    {createPortal(<div ref={menuRef} id={menuId} className={'playback-settings-menu'+(shown==='video'?' video-settings-menu':'')+(context?' context-popover context-settings-menu':'')}
      hidden={!open} inert={!open} aria-hidden={!open} role={shown==='video'?'dialog':'menu'} aria-label={label} tabIndex={-1}
      data-side={placement.side} data-animate={animateOpen}
      style={{left:placement.left,top:placement.top,width:placement.width,maxHeight:placement.maxHeight,
        '--popover-anchor-x':placement.anchor+'px','--popover-anchor-y':placement.anchor+'px'} as CSSProperties}
      onClick={event=>event.stopPropagation()} onDoubleClick={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}
      onKeyDownCapture={()=>setAnimateOpen(false)}
      onKeyDown={event=>{
        event.stopPropagation();
        if(event.key==='Escape'){event.preventDefault();setAnimateOpen(false);unified&&open!=='settings'?goBack():closeMenu(true);return;}
        if(event.key==='ArrowLeft'&&unified&&open!=='settings'&&!(event.target instanceof HTMLInputElement)){event.preventDefault();setAnimateOpen(false);goBack();return;}
        if(context&&event.key==='ArrowLeft'&&open==='settings'){event.preventDefault();setAnimateOpen(false);closeMenu(true);return;}
        if(event.key==='Tab'){
          if(open==='video'){
            const inputs=Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input')||[]);
            if((!event.shiftKey&&document.activeElement===inputs.at(-1))||(event.shiftKey&&document.activeElement===inputs[0])){event.preventDefault();closeMenu(true);}
          }else closeMenu(true);
          return;
        }
        if(open==='video'||!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
        event.preventDefault();
        const options=Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);
        if(!options.length)return;
        const current=options.indexOf(document.activeElement as HTMLButtonElement);
        const next=event.key==='Home'?0:event.key==='End'?options.length-1:(current+(event.key==='ArrowDown'?1:-1)+options.length)%options.length;
        options[next].focus({preventScroll:true});
      }}>
      <div key={shown} className="playback-menu-page">
      <div className="playback-menu-heading">
        {unified&&(shown!=='settings'||context)?<><button type="button" className="playback-menu-back" aria-label={context&&shown==='settings'?'Back to video actions':'Back to playback settings'} onClick={event=>{setAnimateOpen(event.detail>0);context&&shown==='settings'?closeMenu(true):goBack();}}><CaretLeft/></button><h3>{label}</h3></>
          :<h3>{shown==='settings'?<Gear/>:shown==='quality'?<MonitorPlay/>:shown==='audio'?<SpeakerHigh/>:shown==='speed'?<Gauge/>:<Subtitles/>}{label}</h3>}
      </div>
      {shown==='video'?pictureControls:<div className="playback-track-list">
        {shown==='settings'&&<>
          {qualityOptions.length>0&&sectionButton('quality',<MonitorPlay/>,displayedQuality)}
          {allowConversion&&audioTracks.length>1&&sectionButton('audio',<Waveform/>,audioLabel)}
          {subtitleTracks.length>0&&sectionButton('subtitles',<Subtitles/>,subtitleLabel)}
          {pictureControls&&sectionButton('video',<SlidersHorizontal/>,'Fit, rotation and color')}
          {onRepeatChange&&sectionButton('repeat',<Repeat/>,repeatLabels[repeatMode])}
          {onSpeedChange&&sectionButton('speed',<Gauge/>,speed===1?'1×':speedLabel(speed))}
        </>}
        {shown==='speed'&&PLAYBACK_SPEEDS.map(value=><button key={value} type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={speed===value} className={speed===value?'selected':''} onClick={()=>select(()=>onSpeedChange?.(value))}>
          <span><strong>{speedLabel(value)}</strong></span>{speed===value&&<Check weight="bold"/>}
        </button>)}
        {shown==='repeat'&&(['off','one',...(hasQueue?['queue']:[])] as RepeatMode[]).map(mode=><button key={mode} type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={repeatMode===mode} className={repeatMode===mode?'selected':''} onClick={()=>select(()=>onRepeatChange?.(mode))}>
          <span><strong>{repeatLabels[mode]}</strong></span>{repeatMode===mode&&<Check weight="bold"/>}
        </button>)}
        {shown==='quality'&&<button type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={qualityPreference==='source'} className={qualityPreference==='source'?'selected':''}
          disabled={busy} onClick={()=>select(()=>onSelectQuality('source'))}>
          <span><strong>Original Quality</strong><small>Uses each video's original resolution</small></span>
          {qualityPreference==='source'&&<Check weight="bold"/>}
        </button>}
        {shown==='quality'&&!allowConversion&&<p className="account-notice">Video conversion is disabled for this account.</p>}
        {shown==='quality'&&allowAutoQuality&&allowConversion&&<button type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={qualityPreference==='auto'} className={qualityPreference==='auto'?'selected':''}
          disabled={busy} onClick={()=>select(()=>onSelectQuality('auto'))}>
          <span><strong>Auto</strong><small>{activeQuality?`Playing at ${qualityLabel(activeQuality)}`:'Adjusts to your network'}</small></span>
          {qualityPreference==='auto'&&<Check weight="bold"/>}
        </button>}
        {shown==='quality'&&allowConversion&&qualityOptions.map((quality,index)=><button type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={typeof qualityPreference==='number'&&selectedQuality===quality.height} className={typeof qualityPreference==='number'&&selectedQuality===quality.height?'selected':''}
          disabled={busy} key={quality.height} onClick={()=>select(()=>onSelectQuality(quality.height))}>
          <span><strong>{quality.label}</strong><small>{index===0?'Highest available':formatBitrate(quality.bitrate)}</small></span>
          {typeof qualityPreference==='number'&&selectedQuality===quality.height&&<Check weight="bold"/>}
        </button>)}
        {shown==='audio'&&audioTracks.map(track=><button type="button" role="menuitemradio" tabIndex={-1}
          aria-checked={selectedAudio===track.index} className={selectedAudio===track.index?'selected':''}
          disabled={busy||!track.supported} key={track.index} onClick={()=>select(()=>onSelectAudio(track.index))}>
          <span><strong>{trackLabel(track,'Audio',track.typeIndex+1)}</strong><small>{track.supported?trackMeta(track):`${track.codec.toUpperCase()} · Unavailable`}</small></span>
          {selectedAudio===track.index&&<Check weight="bold"/>}
        </button>)}
        {shown==='subtitles'&&<>
          <button type="button" role="menuitemradio" tabIndex={-1} aria-checked={selectedSubtitle===null}
            className={selectedSubtitle===null?'selected':''} disabled={busy} onClick={()=>select(()=>onSelectSubtitle(null))}>
            <span><strong>Off</strong></span>{selectedSubtitle===null&&<Check weight="bold"/>}
          </button>
          {subtitleTracks.map(track=><button type="button" role="menuitemradio" tabIndex={-1}
            aria-checked={selectedSubtitle===track.index} className={selectedSubtitle===track.index?'selected':''}
            disabled={busy||!track.supported} key={track.index} onClick={()=>select(()=>onSelectSubtitle(track.index))}>
            <span><strong>{trackLabel(track,'Subtitle',track.typeIndex+1)}</strong><small>{track.supported?track.codec.toUpperCase():'Image subtitles are not supported'}</small></span>
            {selectedSubtitle===track.index&&<Check weight="bold"/>}
          </button>)}
        </>}
      </div>}
      </div>
    </div>,document.fullscreenElement||document.body)}
  </div>;
}

function qualityLabel(height:number|undefined){return !height?'Quality':height>=2160?'4K':`${height}p`;}
function formatBitrate(bitrate:number){return `${(bitrate/1_000_000).toFixed(bitrate>=1_000_000?1:2)} Mbps`;}
function trackLabel(track:PlaybackTrack,fallback:string,number:number){
  if(track.title)return track.title;
  if(track.language)return languageName(track.language);
  return `${fallback} ${number}`;
}
function trackMeta(track:PlaybackTrack){
  return [track.language?.toUpperCase(),track.codec.toUpperCase(),track.channelLayout||channelLabel(track.channels)].filter(Boolean).join(' · ');
}
function channelLabel(channels:number|null){
  if(channels===1)return 'Mono';
  if(channels===2)return 'Stereo';
  return channels?`${channels} channels`:'';
}
function languageName(code:string){
  try{return new Intl.DisplayNames(undefined,{type:'language'}).of(code)||code.toUpperCase();}
  catch{return code.toUpperCase();}
}
