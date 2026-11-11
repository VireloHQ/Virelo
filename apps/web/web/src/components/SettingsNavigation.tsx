import { t, useLocale } from '../i18n';
import { CaretRight, type Icon } from '@phosphor-icons/react';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { cssTimeToMilliseconds } from '../utils/motion-time';

interface SettingsSection {
  id: string;
  label: string;
  description: string;
  icon: Icon;
}

export function SettingsNavigation({ sections, activeSection, detailOpen, onSelect }: {
  sections: readonly SettingsSection[];
  activeSection: string;
  detailOpen: boolean;
  onSelect: (id: string) => void;
}) {
  useLocale();
  const sidebar = useRef<HTMLElement>(null), selection = useRef<HTMLSpanElement>(null);
  const pointerSelection = useRef(false);
  const animations = useRef<{ selection?: Animation; panel?: Animation }>({});
  useLayoutEffect(() => {
    const nav = sidebar.current, marker = selection.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !marker || !active) return;
    const tokens = getComputedStyle(document.documentElement);
    const duration = cssTimeToMilliseconds(tokens.getPropertyValue('--dur-short'));
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animate = pointerSelection.current && !reduced;
    pointerSelection.current = false;
    const move = (animate: boolean) => {
      if (!nav.getClientRects().length) return;
      const target = `translateY(${active.offsetTop}px) scaleY(${active.offsetHeight})`;
      if (marker.style.transform === target) return;
      const current = getComputedStyle(marker).transform, ready = nav.dataset.selectionReady === 'true';
      animations.current.selection?.cancel();
      marker.style.transform = target;
      nav.dataset.selectionReady = 'true';
      if (animate && ready) {
        animations.current.selection = marker.animate([{ transform: current }, { transform: target }],
          { duration, easing: tokens.getPropertyValue('--ease-in-out').trim() });
        void animations.current.selection.finished.catch(() => {});
      }
    };
    move(animate);
    animations.current.panel?.cancel();
    const panel = nav.parentElement?.querySelector<HTMLElement>('.settings-content > .settings-section');
    if (animate && panel) {
      animations.current.panel = panel.animate([{ opacity: 0 }, { opacity: 1 }],
        { duration, easing: tokens.getPropertyValue('--ease-out').trim() });
      void animations.current.panel.finished.catch(() => {});
    }
    const resize = new ResizeObserver(() => move(false));
    resize.observe(nav); resize.observe(active);
    return () => resize.disconnect();
  }, [activeSection, detailOpen]);
  useEffect(() => () => {
    animations.current.selection?.cancel();
    animations.current.panel?.cancel();
  }, []);

  return <nav ref={sidebar} className="settings-sidebar" aria-label={t("Settings sections")}>
    <span ref={selection} className="settings-selection" aria-hidden="true"/>
    {sections.map((section) => <button
      key={section.id}
      id={`settings-nav-${section.id}`}
      type="button"
      className={`settings-nav-item${activeSection === section.id ? ' active' : ''}`}
      aria-current={activeSection === section.id ? 'page' : undefined}
      aria-controls={activeSection === section.id ? `settings-panel-${section.id}` : undefined}
      onClick={event => { pointerSelection.current = event.detail > 0 && (section.id !== activeSection || !detailOpen); onSelect(section.id); }}
    >
      <section.icon className="settings-nav-icon" aria-hidden="true"/>
      <span className="settings-nav-copy"><strong>{t(section.label)}</strong><small>{t(section.description)}</small></span>
      <CaretRight className="settings-nav-chevron" aria-hidden="true"/>
    </button>)}
  </nav>;
}
