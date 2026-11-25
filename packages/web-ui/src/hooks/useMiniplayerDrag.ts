import { useEffect, useRef, useState, type PointerEvent } from 'react';

type Corner = `${'top'|'bottom'}-${'left'|'right'}`;
type Grab = { node:HTMLElement; id:number; x:number; y:number; corner:Corner; start:DOMRect;
  anchor:DOMRect; min:DOMRect; max:DOMRect; moved:boolean };

function host(surface:HTMLElement) {
  // Live TV's same-origin frame keeps playing while its outer dock moves.
  const frame = surface.ownerDocument.defaultView?.frameElement;
  return (frame ?? surface).closest<HTMLElement>('.playback-dock[data-minimized="true"]');
}
function point(event:PointerEvent<HTMLElement>) {
  const frame = event.currentTarget.ownerDocument.defaultView?.frameElement?.getBoundingClientRect();
  return {x:event.clientX+(frame?.left ?? 0),y:event.clientY+(frame?.top ?? 0)};
}
const clamp = (value:number, min:number, max:number) => Math.min(Math.max(value,min),Math.max(min,max));

export function useMiniplayerDrag() {
  const grab=useRef<Grab|null>(null), animation=useRef<Animation|null>(null);
  const [revealed,setRevealed]=useState(false);
  useEffect(()=>()=>{
    grab.current?.node.style.removeProperty('transform');
    animation.current?.cancel();
  },[]);

  function snap(node:HTMLElement, corner:Corner) {
    const from=node.getBoundingClientRect();
    animation.current?.cancel();
    node.style.removeProperty('transform');
    node.dataset.corner=corner;
    if (node.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const to=node.getBoundingClientRect();
    if (from.x!==to.x || from.y!==to.y) {
      animation.current=node.animate(
        [{transform:`translate(${from.x-to.x}px,${from.y-to.y}px)`},{transform:'none'}],
        {duration:200,easing:'cubic-bezier(.18,.8,.28,1)'}
      );
    }
  }
  function finish(event:PointerEvent<HTMLElement>, cancel=false) {
    const drag=grab.current;
    if(!drag || drag.id!==event.pointerId) return;
    grab.current=null;
    delete event.currentTarget.dataset.dragging;
    const rect=drag.node.getBoundingClientRect();
    const corner:Corner=cancel || !drag.moved ? drag.corner
      : `${rect.y<=(drag.min.y+drag.max.y)/2?'top':'bottom'}-${rect.x<=(drag.min.x+drag.max.x)/2?'left':'right'}`;
    snap(drag.node,corner);
    if(drag.moved) setRevealed(false);
    else if(!cancel && (event.pointerType!=='mouse' || !window.matchMedia('(hover:hover)').matches)) setRevealed(open=>!open);
  }
  return {
    'data-revealed':revealed || undefined,
    onPointerDown(event:PointerEvent<HTMLElement>) {
      if(event.button!==0 || !event.isPrimary || grab.current || (event.target as Element).closest('button')) return;
      const node=host(event.currentTarget);
      if(!node) return;
      const start=node.getBoundingClientRect(), {x,y}=point(event);
      const corner=(node.dataset.corner || 'bottom-right') as Corner;
      animation.current?.cancel();
      // Resolve the CSS anchors once, including safe areas and sidebar offsets.
      node.dataset.corner='top-left';const min=node.getBoundingClientRect();
      node.dataset.corner='bottom-right';const max=node.getBoundingClientRect();
      node.dataset.corner=corner;const anchor=node.getBoundingClientRect();
      node.style.transform=`translate(${start.x-anchor.x}px,${start.y-anchor.y}px)`;
      grab.current={node,id:event.pointerId,x,y,corner,start,anchor,min,max,moved:false};
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    onPointerMove(event:PointerEvent<HTMLElement>) {
      const drag=grab.current;
      if(!drag || drag.id!==event.pointerId) return;
      const {x,y}=point(event), dx=x-drag.x, dy=y-drag.y;
      if(!drag.moved && Math.hypot(dx,dy)<6) return;
      drag.moved=true;event.currentTarget.dataset.dragging='true';
      const left=clamp(drag.start.x+dx,drag.min.x,drag.max.x), top=clamp(drag.start.y+dy,drag.min.y,drag.max.y);
      drag.node.style.transform=`translate(${left-drag.anchor.x}px,${top-drag.anchor.y}px)`;
    },
    onPointerUp:finish,
    onPointerCancel:(event:PointerEvent<HTMLElement>)=>finish(event,true),
    onLostPointerCapture:(event:PointerEvent<HTMLElement>)=>finish(event,true),
    onKeyDown(event:React.KeyboardEvent<HTMLElement>) {
      if(grab.current || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
      const node=host(event.currentTarget);
      if(!node) return;
      const [y,x]=(node.dataset.corner || 'bottom-right').split('-') as ['top'|'bottom','left'|'right'];
      event.preventDefault();
      snap(node,`${event.key==='ArrowUp'?'top':event.key==='ArrowDown'?'bottom':y}-${event.key==='ArrowLeft'?'left':event.key==='ArrowRight'?'right':x}`);
    }
  };
}
