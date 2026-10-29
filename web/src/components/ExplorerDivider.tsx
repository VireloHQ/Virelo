import { useLayoutEffect, useRef, useState } from 'react';
import { t, useLocale } from '../i18n';

const key='virelo.explorer-width', minimum=160, maximum=720, initial=230;
function savedWidth() {
  try { const value=Number(localStorage.getItem(key));return Number.isFinite(value)&&value>=minimum&&value<=maximum?value:initial; }
  catch { return initial; }
}
export function ExplorerDivider() {
  useLocale();
  const [initialWidth]=useState(savedWidth);
  const node=useRef<HTMLDivElement>(null),preferred=useRef(initialWidth),current=useRef(initialWidth),limit=useRef(maximum);
  const drag=useRef<{id:number;x:number;width:number}|null>(null);
  const [size,setSize]=useState({width:current.current,max:maximum}),[dragging,setDragging]=useState(false);
  const apply=(value:number)=>{
    const width=Math.round(Math.max(minimum,Math.min(limit.current,value)));
    current.current=width;
    node.current?.parentElement?.style.setProperty('--explorer-sidebar-width',width+'px');
    setSize(previous=>previous.width===width&&previous.max===limit.current?previous:{width,max:limit.current});
  };
  const save=()=>{
    preferred.current=current.current;
    try { localStorage.setItem(key,String(preferred.current)); } catch { /* Keep the width for this visit when storage is unavailable. */ }
  };
  const finish=()=>{
    const active=drag.current;if(!active)return;
    drag.current=null;setDragging(false);save();
    if(node.current?.hasPointerCapture(active.id))node.current.releasePointerCapture(active.id);
  };
  useLayoutEffect(()=>{
    const parent=node.current?.parentElement;if(!parent)return;
    let previousWidth=0;
    const resize=()=>{
      const width=parent.clientWidth;if(width===previousWidth)return;
      previousWidth=width;limit.current=Math.max(minimum,Math.min(maximum,width-328));apply(preferred.current);
    };
    resize();const observer=new ResizeObserver(resize);observer.observe(parent);
    return()=>observer.disconnect();
  },[]);
  return <div ref={node} className="explorer-divider" role="separator" aria-label={t('Folders')} aria-orientation="vertical" aria-controls="library-explorer-folders"
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((size.width-minimum)/Math.max(1,size.max-minimum)*100)} tabIndex={0} data-dragging={dragging||undefined}
    onPointerDown={event=>{if(event.button!==0||!event.isPrimary)return;event.preventDefault();node.current?.focus({preventScroll:true});drag.current={id:event.pointerId,x:event.clientX,width:current.current};event.currentTarget.setPointerCapture(event.pointerId);setDragging(true);}}
    onPointerMove={event=>{const active=drag.current;if(active?.id===event.pointerId)apply(active.width+event.clientX-active.x);}}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={()=>{apply(initial);save();}}
    onKeyDown={event=>{
      if(event.altKey||event.ctrlKey||event.metaKey)return;
      const step=event.shiftKey?48:16;
      const value=event.key==='ArrowLeft'?current.current-step:event.key==='ArrowRight'?current.current+step:event.key==='Home'?minimum:event.key==='End'?limit.current:null;
      if(value!==null){event.preventDefault();event.stopPropagation();apply(value);save();}
    }}/>
}

