import { useCallback, useEffect, useRef, type RefObject } from 'react';

export function useRowWheel(ref: RefObject<HTMLElement | null>, itemCount=0, enabled=true) {
  const cancelWheel=useRef<()=>void>(()=>{});
  const scrollBy=useCallback((left:number, behavior?:ScrollBehavior)=>{
    cancelWheel.current();
    ref.current?.scrollBy({
      left,
      behavior:behavior??(window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth')
    });
  },[ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
    let animationFrame = 0;
    let target = el.scrollLeft;
    let lastFrameTime = 0;
    let lastWheelTime = 0;
    let wheelDirection = 0;

    const clamp = (value:number)=>Math.max(0,Math.min(Math.max(0,el.scrollWidth-el.clientWidth),value));
    const cancel = () => {
      if(animationFrame)cancelAnimationFrame(animationFrame);
      animationFrame=0;lastFrameTime=0;wheelDirection=0;target=el.scrollLeft;
    };
    cancelWheel.current=cancel;

    const animate = (time:number) => {
      animationFrame=0;
      target=clamp(target);
      const current=el.scrollLeft;
      const elapsed=lastFrameTime?Math.min(time-lastFrameTime,32):16;
      lastFrameTime=time;
      const next=current+(target-current)*(1-Math.exp(-elapsed/65));
      // Pixel rounding or a resized rail must never leave an endless loop
      // that fights the next button, keyboard or native trackpad operation.
      if(Math.abs(target-current)<=1||Math.abs(next-current)<.5||time-lastWheelTime>800){
        el.scrollTo({left:target,behavior:'instant'});
        lastFrameTime=0;return;
      }
      el.scrollTo({left:next,behavior:'instant'});
      animationFrame=requestAnimationFrame(animate);
    };

    const onWheel = (event:WheelEvent) => {
      if(event.ctrlKey||Math.abs(event.deltaY)<=Math.abs(event.deltaX)){
        cancel();return; // Preserve pinch zoom and native horizontal trackpad input.
      }
      if(el.scrollWidth<=el.clientWidth+1){cancel();return;}
      const scale=event.deltaMode===WheelEvent.DOM_DELTA_LINE?16:
        event.deltaMode===WheelEvent.DOM_DELTA_PAGE?el.clientWidth:1;
      const delta=event.deltaY*scale;
      if(!Number.isFinite(delta)||delta===0)return;
      const current=el.scrollLeft,maxScroll=el.scrollWidth-el.clientWidth;
      if((current<=1&&delta<0)||(current>=maxScroll-1&&delta>0)){
        cancel();return; // At the edge, let the page scroll normally.
      }
      const direction=Math.sign(delta);
      if(!animationFrame||direction!==wheelDirection){
        // A new wheel gesture takes over any browser smooth-scroll animation.
        el.scrollTo({left:current,behavior:'instant'});
        target=current;
        lastFrameTime=0;
      }
      wheelDirection=direction;
      target=clamp(target+delta);
      lastWheelTime=performance.now();
      event.preventDefault();
      if(reducedMotion.matches){
        const next=target;cancel();el.scrollTo({left:next,behavior:'instant'});return;
      }
      if(!animationFrame)animationFrame=requestAnimationFrame(animate);
    };

    el.addEventListener('wheel',onWheel,{passive:false});
    el.addEventListener('pointerdown',cancel,{passive:true});
    el.addEventListener('keydown',cancel);
    return () => {
      el.removeEventListener('wheel',onWheel);
      el.removeEventListener('pointerdown',cancel);
      el.removeEventListener('keydown',cancel);
      cancel();
      cancelWheel.current=()=>{};
    };
  },[ref,itemCount,enabled]);
  return scrollBy;
}
