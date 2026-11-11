import { useEffect, useState, type RefObject } from 'react';

const ROTATION_DELAY = 8000;

// Restart a full reading interval after interaction or visibility changes.
export function useFeaturedRotation(ref: RefObject<HTMLElement | null>, count: number, activeId: number | undefined, advance: () => void) {
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const hero = ref.current;
    if (!hero || count < 2) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(preference.matches);
    let hovered = window.matchMedia('(hover: hover) and (pointer: fine)').matches && hero.matches(':hover');
    let visible = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => { clearTimeout(timer); timer = undefined; };
    const schedule = () => {
      clear();
      const focused = document.activeElement instanceof Element && document.activeElement.matches(':focus-visible')
        && (hero.contains(document.activeElement) || Boolean(document.activeElement.closest('.home-header')));
      if (!paused && !preference.matches && !document.hidden && visible && !hovered && !focused) timer = setTimeout(advance, ROTATION_DELAY);
    };
    const enter = (event: PointerEvent) => { if (event.pointerType === 'mouse' || event.pointerType === 'pen') { hovered = true; schedule(); } };
    const leave = () => { hovered = false; schedule(); };
    const motion = () => { setReducedMotion(preference.matches); schedule(); };
    const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting && entries[0].intersectionRatio >= 0.5; schedule(); }, { threshold: [0, 0.5] });
    observer.observe(hero);
    hero.addEventListener('pointerenter', enter); hero.addEventListener('pointerleave', leave);
    document.addEventListener('focusin', schedule); document.addEventListener('focusout', schedule);
    document.addEventListener('visibilitychange', schedule); preference.addEventListener('change', motion);
    return () => {
      clear(); observer.disconnect();
      hero.removeEventListener('pointerenter', enter); hero.removeEventListener('pointerleave', leave);
      document.removeEventListener('focusin', schedule); document.removeEventListener('focusout', schedule);
      document.removeEventListener('visibilitychange', schedule); preference.removeEventListener('change', motion);
    };
  }, [ref, count, activeId, advance, paused]);
  return { paused, setPaused, reducedMotion };
}
