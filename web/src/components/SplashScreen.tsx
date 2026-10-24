import { useEffect, useState } from 'react';
import { cssTimeToMilliseconds } from '../utils/motion-time';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const duration = reduced ? 0 : cssTimeToMilliseconds(getComputedStyle(document.documentElement).getPropertyValue('--dur-long'));
    let finishTimer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      setLeaving(true);
      finishTimer = window.setTimeout(onDone, duration);
    });
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(finishTimer); };
  }, [onDone]);

  return <div className={`splash-screen${leaving ? ' splash-phase-leaving' : ''}`} role="status" aria-label="Virelo">
    <div className="splash-content">
      <div className="splash-logo" aria-hidden="true"><img src="/virelo-icon.png?v=transparent-1" alt="" /></div>
      <div className="splash-wordmark" aria-hidden="true">Virelo</div>
    </div>
  </div>;
}
