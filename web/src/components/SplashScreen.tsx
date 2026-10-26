import { t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { cssTimeToMilliseconds } from '../utils/motion-time';

export function SplashScreen({ onDone }: { onDone: () => void }) {
  useLocale();
  const [leaving, setLeaving] = useState(false);
  const screen = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = screen.current;
    if (!element) return;
    const logo = element.querySelector('img')!;
    let cancelled = false, started = false;
    let logoTimer: number | undefined, leaveTimer: number | undefined;
    let finishTimer: number | undefined;
    const begin = () => {
      if (cancelled || started) return;
      started = true;
      window.clearTimeout(logoTimer);
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration = reduced ? 0 : cssTimeToMilliseconds(getComputedStyle(element).getPropertyValue('--splash-exit-duration'));
      leaveTimer = window.setTimeout(() => {
        setLeaving(true);
        finishTimer = window.setTimeout(onDone, duration);
      }, 600);
    };
    // Nonblocking startup CSS can keep the mounted app hidden.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      if (logo.complete) begin();
      else {
        logo.addEventListener('load', begin, { once: true });
        logo.addEventListener('error', begin, { once: true });
        logoTimer = window.setTimeout(begin, 1500);
      }
    });
    observer.observe(element);
    return () => {
      cancelled = true;
      observer.disconnect();
      logo.removeEventListener('load', begin);
      logo.removeEventListener('error', begin);
      window.clearTimeout(logoTimer);
      window.clearTimeout(leaveTimer);
      window.clearTimeout(finishTimer);
    };
  }, [onDone]);

  return <div ref={screen} className={`splash-screen${leaving ? ' splash-phase-leaving' : ''}`} role="status" aria-label={t("Virelo")}>
    <div className="splash-content">
      <div className="splash-logo" aria-hidden="true"><img src="/virelo-icon.png?v=transparent-1" alt="" width="512" height="512" fetchPriority="high" /></div>
      <div className="splash-wordmark" aria-hidden="true">{t("Virelo")}</div>
    </div>
  </div>;
}
