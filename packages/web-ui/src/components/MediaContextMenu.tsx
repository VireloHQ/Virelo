import { t, useLocale } from '@edition/i18n';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { CaretRight, Check, Heart, Info, ListPlus, Play } from '@phosphor-icons/react';
import { PlaylistPicker } from './SavePlaylist';
import { useContextMenuPlacement } from '../hooks/useContextMenuPlacement';
import { contextPlaylistPlacement, type ContextMenuPosition } from '../utils/context-menu';
import type { MediaItem } from '@edition/types';

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
  const [playlistOpen, setPlaylistOpen] = useState(false);
  const [playlistVisit, setPlaylistVisit] = useState(0);
  const [playlistMotion, setPlaylistMotion] = useState(false);
  const playlistId = useId();
  const playlistTrigger = useRef<HTMLButtonElement>(null);
  const playlistPanel = useRef<HTMLDivElement>(null);
  const playlistPending = useRef(false);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement|null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const placement = useContextMenuPlacement(menuRef, position, returnFocus, playlistOpen);
  const playlistPlacement = contextPlaylistPlacement(placement.left, placement.width, window.innerWidth);
  const playlistSide = playlistPlacement.side;

  useLayoutEffect(() => {
    const row = playlistTrigger.current, menu = menuRef.current, panel = playlistPanel.current;
    if (!playlistOpen || playlistSide==='bottom' || !row || !menu || !panel) return;
    const top = row.offsetTop - (row.closest('.context-popover-content')?.scrollTop ?? 0), bottom = top + row.offsetHeight;
    const below = window.innerHeight - placement.top - top - 16;
    const above = placement.top + bottom - 16;
    const alignBelow = below >= 300 || below >= above;
    panel.style.setProperty('--playlist-panel-top',alignBelow?top+'px':'auto');
    panel.style.setProperty('--playlist-panel-bottom',alignBelow?'auto':menu.offsetHeight-bottom+'px');
    panel.style.setProperty('--playlist-panel-height',Math.max(0,alignBelow?below:above)+'px');
    panel.style.setProperty('--playlist-panel-origin',alignBelow?'24px':'calc(100% - 24px)');
  }, [playlistOpen, playlistSide, placement.top]);

  useEffect(() => {
    previousFocusRef.current = returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    firstItemRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      if (!playlistPending.current && menuRef.current && !menuRef.current.contains(event.target as Node)) closeRef.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!menuRef.current || playlistPending.current) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        previousFocusRef.current?.focus({ preventScroll: true });
        closeRef.current();
      }
    };
    const scrollAtOpen = { x: window.scrollX, y: window.scrollY };
    const onViewportChange = (event: Event) => {
      if (!menuRef.current || playlistPending.current) return;
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
  }, [returnFocus]);

  const closeMenu = () => {
    if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    onClose();
  };
  const choose = (action: () => void) => {
    if (playlistPending.current) return;
    closeMenu();
    action();
  };
  const togglePlaylist = (animate:boolean) => {
    if (playlistPending.current) return;
    setPlaylistMotion(animate);
    if (playlistOpen) playlistTrigger.current?.focus({preventScroll:true});
    else setPlaylistVisit(visit => visit + 1);
    setPlaylistOpen(!playlistOpen);
  };

  return createPortal(
    <div
      ref={menuRef}
      className="media-context-menu context-popover"
      data-side={placement.side} data-animate={placement.animate}
      data-playlist-side={playlistPlacement.side} data-playlist-motion={playlistMotion}
      style={placement.style}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (playlistOpen && !playlistPending.current && event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) onClose();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          if (playlistPending.current) return;
          if (playlistOpen) togglePlaylist(false);
          else closeMenu();
          return;
        }
        if (!(event.target instanceof HTMLElement) || !event.target.closest('[role="menuitem"]')) return;
        if (event.target === playlistTrigger.current && !playlistOpen
          && ((playlistPlacement.side === 'right' && event.key === 'ArrowRight') || (playlistPlacement.side === 'left' && event.key === 'ArrowLeft'))) {
          event.preventDefault();
          togglePlaylist(false);
          return;
        }
        const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        let next: number | undefined;
        if (event.key === 'ArrowDown') next = (index + 1) % items.length;
        else if (event.key === 'ArrowUp') next = (index - 1 + items.length) % items.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = items.length - 1;
        else if (event.key === 'Tab' && !playlistOpen) closeMenu();
        if (next !== undefined) { event.preventDefault(); items[next]?.focus({preventScroll:true}); }
      }}
    >
      <div className="context-popover-content">
      <div className="media-context-menu-title" title={item.title}>
        <span>{item.title}</span>
      </div>
      <div className="media-context-menu-divider" />
      <div role="menu" aria-label={t("{value0} actions", { value0: item.title })}>
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
      <MenuItem ref={playlistTrigger} icon={<ListPlus />} end={<CaretRight size={14} aria-hidden="true"/>}
        expanded={playlistOpen} controls={playlistVisit?playlistId:undefined} onClick={event=>togglePlaylist(event.detail > 0)}>{t("Add to playlist")}</MenuItem>
      </div>
      </div>
      {playlistVisit > 0 && <div ref={playlistPanel} className="context-playlist-panel" hidden={!playlistOpen} inert={!playlistOpen}
        style={{'--playlist-panel-width':playlistPlacement.width+'px'} as CSSProperties}>
        <PlaylistPicker key={item.id+':'+playlistVisit} id={playlistId} mediaIds={[item.id]} pending={playlistPending} onSaved={closeMenu}/>
      </div>}
    </div>,
    document.fullscreenElement || document.body
  );
}

function MenuItem({ children, icon, end, onClick, ref, expanded, controls }: { children: ReactNode; icon: ReactNode; end?: ReactNode; onClick: (event:MouseEvent<HTMLButtonElement>) => void; ref?: React.Ref<HTMLButtonElement>; expanded?: boolean; controls?: string }) {
  return <button type="button" ref={ref} className="media-context-menu-item" role="menuitem" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
    <span className="media-context-menu-icon" aria-hidden="true">{icon}</span>
    <span className="media-context-menu-label">{children}</span>
    {end && <span className="media-context-menu-end">{end}</span>}
  </button>;
}
