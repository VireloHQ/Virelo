import { t, useLocale } from '../i18n';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';

interface DraggableCaptionProps {
  text: string;
  controlsVisible: boolean;
  containerRef: RefObject<HTMLDivElement|null>;
  onDraggingChange?:(dragging:boolean)=>void;
}

interface Point { x:number; y:number }

interface HiddenSubtitleTrackProps {
  src:string;
  srcLang:string;
  label:string;
  onText:(text:string)=>void;
}

export function HiddenSubtitleTrack({src,srcLang,label,onText}:HiddenSubtitleTrackProps){
  const elementRef=useRef<HTMLTrackElement>(null);
  const callbackRef=useRef(onText);
  const [loaded,setLoaded]=useState(0);
  callbackRef.current=onText;
  useEffect(()=>{
    const track=elementRef.current?.track;
    if(!track)return;
    const update=()=>callbackRef.current(activeCueText(track));
    track.mode='hidden';
    track.addEventListener('cuechange',update);
    update();
    return()=>track.removeEventListener('cuechange',update);
  },[loaded,src]);
  return <track ref={elementRef} kind="subtitles" src={src} srcLang={srcLang} label={label} default onLoad={()=>setLoaded((value)=>value+1)}/>;
}

export function DraggableCaption({text,controlsVisible,containerRef,onDraggingChange}:DraggableCaptionProps) {
  useLocale();
  const [offset,setOffset]=useState<Point>({x:0,y:0});
  const [dragging,setDragging]=useState(false);
  const drag=useRef<{pointerId:number;startX:number;startY:number;origin:Point}|null>(null);

  function start(event:ReactPointerEvent<HTMLDivElement>){
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,origin:offset};
    setDragging(true);
    onDraggingChange?.(true);
  }
  function move(event:ReactPointerEvent<HTMLDivElement>){
    const active=drag.current;
    const bounds=containerRef.current?.getBoundingClientRect();
    if(!active||active.pointerId!==event.pointerId||!bounds)return;
    event.stopPropagation();
    const maxX=Math.max(0,bounds.width*.44);
    const minY=-Math.max(0,bounds.height*.7);
    setOffset({
      x:clamp(active.origin.x+event.clientX-active.startX,-maxX,maxX),
      y:clamp(active.origin.y+event.clientY-active.startY,minY,0)
    });
  }
  function end(event:ReactPointerEvent<HTMLDivElement>){
    if(drag.current?.pointerId!==event.pointerId)return;
    event.stopPropagation();
    drag.current=null;
    setDragging(false);
    onDraggingChange?.(false);
  }
  function reset(event:ReactPointerEvent<HTMLDivElement>){event.stopPropagation();setOffset({x:0,y:0});}

  if(!text)return null;
  const style={transform:`translate3d(calc(-50% + ${offset.x}px),${offset.y}px,0)`} as CSSProperties;
  return <div
    className={`player-caption${dragging?' dragging':''}`}
    style={style}
    role="group"
    aria-label={t("Subtitles. Drag to reposition.")}
    data-controls-visible={controlsVisible?'true':'false'}
    onPointerDown={start}
    onPointerMove={move}
    onPointerUp={end}
    onPointerCancel={end}
    onDoubleClick={reset}
  >{text}</div>;
}

function clamp(value:number,min:number,max:number){return Math.min(max,Math.max(min,value));}
function activeCueText(track:TextTrack){return Array.from(track.activeCues||[]).map((cue)=>'text' in cue?String((cue as VTTCue).text):'').filter(Boolean).join('\n').replace(/<[^>]+>/g,'').trim();}
