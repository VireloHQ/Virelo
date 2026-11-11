import { t, useLocale } from '../i18n';
import { CaretLeft, CaretRight } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { MediaItem } from '../types';
import { MediaCard } from './MediaCard';
import { useRowWheel } from '../hooks/useRowWheel';

export function MediaRow({title,items,playDirect=false,poster=false,short=false,seriesTitles=false,action}:{
  title:string;items:MediaItem[];playDirect?:boolean;poster?:boolean;short?:boolean;seriesTitles?:boolean;action?:ReactNode;
}) {
  useLocale();
  const ref=useRef<HTMLDivElement>(null);
  const hoverTimer=useRef<number|null>(null);
  const [activeId,setActiveId]=useState<number|null>(null);
  const [edges,setEdges]=useState({left:false,right:false});
  const posterLayout=poster&&!playDirect&&items.some(item=>item.poster_path);
  const scrollRow=useRowWheel(ref,items.length);
  useEffect(()=>{
    const row=ref.current;if(!row)return;
    const update=()=>{
      const next={left:row.scrollLeft>2,right:row.scrollLeft+row.clientWidth<row.scrollWidth-2};
      setEdges(current=>current.left===next.left&&current.right===next.right?current:next);
    };
    const resize=new ResizeObserver(update);resize.observe(row);row.addEventListener('scroll',update,{passive:true});update();
    return ()=>{resize.disconnect();row.removeEventListener('scroll',update);};
  },[items.length,posterLayout,short]);
  useEffect(()=>{
    const row=ref.current;if(!row)return;
    const observer=new IntersectionObserver(entries=>{if(!entries.some(entry=>entry.isIntersecting))setActiveId(null);});
    observer.observe(row);return ()=>observer.disconnect();
  },[items.length]);
  useEffect(()=>()=>{if(hoverTimer.current!==null)clearTimeout(hoverTimer.current);},[]);
  if(!items.length)return null;
  const scroll=(direction:number)=>{
    if(ref.current)scrollRow(direction*Math.min(ref.current.clientWidth*.86,1000));
  };
  const hover=(id:number)=>(on:boolean)=>{
    if(hoverTimer.current!==null)clearTimeout(hoverTimer.current);
    if(on)hoverTimer.current=window.setTimeout(()=>setActiveId(id),160);
    else setActiveId(current=>current===id?null:current);
  };
  return <section className="media-section">
    <div className="section-heading"><h2>{title}</h2><div className="home-row-actions">{action}
      {(edges.left||edges.right)&&<div className="row-controls">
        <button disabled={!edges.left} onClick={()=>scroll(-1)} aria-label={t("Scroll {value0} left", { value0: title })}><CaretLeft/></button>
        <button disabled={!edges.right} onClick={()=>scroll(1)} aria-label={t("Scroll {value0} right", { value0: title })}><CaretRight/></button>
      </div>}
    </div></div>
    <div className={'media-row'+(posterLayout?' poster-row':'')+(short?' shorts-row':'')} ref={ref} role="region" aria-label={t("{value0} titles", { value0: title })} tabIndex={0}
      onKeyDown={event=>{if(event.target===event.currentTarget&&(event.key==='ArrowRight'||event.key==='ArrowLeft')){event.preventDefault();scroll(event.key==='ArrowRight'?1:-1);}}}>
      {items.map(item=><MediaCard key={item.id} item={seriesTitles?{...item,title:item.series_title||item.title}:item}
        layout={posterLayout?'poster':'landscape'} short={short} playDirect={playDirect} preview={!short&&activeId===item.id} onHoverChange={!short?hover(item.id):undefined}/>)}
    </div>
  </section>;
}
