import { t, useLocale } from '../i18n';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Check, Heart, Info, Play } from '@phosphor-icons/react';
import { useContextMenuPlacement } from '../hooks/useContextMenuPlacement';
import type { ContextMenuPosition } from '../utils/context-menu';
import type { MediaItem } from '../types';

type MenuPosition = ContextMenuPosition;

export function MediaContextMenu({
  item,
  position,
  favorite,
  onFavorite,
  onPlay,
  onDetails,
  returnFocus,
  onClose
}: {
  item: MediaItem;
  position: MenuPosition;
  favorite: boolean;
  onFavorite: () => void;
  onPlay: () => void;
  onDetails: () => void;
  onClose: () => void;
  returnFocus?: HTMLElement|null;
}) {
  useLocale();
  const menuRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement|null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const placement = useContextMenuPlacement(menuRef, position, returnFocus);

  useEffect(() => {
    previousFocusRef.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    firstItemRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        previousFocusRef.current?.focus({ preventScroll: true });
        closeRef.current();
      }
    };
    const scrollAtOpen = { x: window.scrollX, y: window.scrollY };
    const onViewportChange = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      if (event.type === 'scroll' && event.target === document && window.scrollX === scrollAtOpen.x && window.scrollY === scrollAtOpen.y) return;
      closeRef.current();
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onViewportChange, true);
    window.addEventListener('resize', onViewportChange);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onViewportChange, true);
      window.removeEventListener('resize', onViewportChange);
    };
  }, []);

  const choose = (action: () => void) => {
    if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    onClose();
    action();
  };

  return createPortal(
    <div
      ref={menuRef}
      className="media-context-menu context-popover"
      data-side={placement.side} data-animate={placement.animate}
      role="menu"
      aria-label={t("{value0} actions", { value0: item.title })}
      style={placement.style}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Escape' || event.key === 'Tab') {
          if (event.key === 'Escape') event.preventDefault();
          if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
          closeRef.current();
        }
        if (next !== undefined) { event.preventDefault(); items[next]?.focus(); }
      }}
    >
      <div className="context-popover-content">
      <div className="media-context-menu-title" title={item.title}>
        <span>{item.title}</span>
      </div>
      <div className="media-context-menu-divider" />
      <MenuItem
        ref={firstItemRef}
        icon={<Heart weight={favorite ? 'fill' : 'regular'} />}
        end={favorite && <Check className="media-context-menu-check" weight="bold" />}
        onClick={() => choose(onFavorite)}
      >
        {favorite ? t("Remove from favorites") : t("Add to favorites")}
      </MenuItem>
      <MenuItem icon={<Play weight="fill" />} onClick={() => choose(onPlay)}>
        {item.progress_position && item.progress_position > 10 && !item.progress_completed ? t("Resume playback") : t("Play now")}
      </MenuItem>
      <MenuItem icon={<Info />} onClick={() => choose(onDetails)}>{t("Open details")}</MenuItem>
      </div>
    </div>,
    document.fullscreenElement || document.body
  );
}

function MenuItem({ children, icon, end, onClick, ref }: { children: ReactNode; icon: ReactNode; end?: ReactNode; onClick: () => void; ref?: React.Ref<HTMLButtonElement> }) {
  return <button ref={ref} className="media-context-menu-item" role="menuitem" onClick={onClick}>
    <span className="media-context-menu-icon">{icon}</span>
    <span className="media-context-menu-label">{children}</span>
    {end && <span className="media-context-menu-end">{end}</span>}
  </button>;
}
