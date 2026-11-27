import { t, useLocale } from '@edition/i18n';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CaretDown, Check, Heart, Info, ListPlus, Play } from '@phosphor-icons/react';
import { PlaylistPicker } from './SavePlaylist';
import { useContextMenuPlacement } from '../hooks/useContextMenuPlacement';
import type { ContextMenuPosition } from '../utils/context-menu';
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
  const playlistId = useId();
  const playlistTrigger = useRef<HTMLButtonElement>(null);
  const playlistPending = useRef(false);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement|null>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const placement = useContextMenuPlacement(menuRef, position, returnFocus, playlistOpen);

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
  const togglePlaylist = () => {
    if (playlistPending.current) return;
    if (playlistOpen) playlistTrigger.current?.focus({preventScroll:true});
    setPlaylistOpen(!playlistOpen);
  };

  return createPortal(
    <div
      ref={menuRef}
      className="media-context-menu context-popover"
      data-side={placement.side} data-animate={placement.animate}
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
          if (playlistOpen) togglePlaylist();
          else closeMenu();
          return;
        }
        if (!(event.target instanceof HTMLElement) || !event.target.closest('[role="menuitem"]')) return;
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
      <MenuItem ref={playlistTrigger} icon={<ListPlus />} end={<CaretDown size={14} aria-hidden="true"/>}
        expanded={playlistOpen} controls={playlistOpen?playlistId:undefined} onClick={togglePlaylist}>{t("Add to playlist")}</MenuItem>
      </div>
      {playlistOpen && <PlaylistPicker key={item.id} id={playlistId} mediaIds={[item.id]} pending={playlistPending} onSaved={closeMenu}/>}
      </div>
    </div>,
    document.fullscreenElement || document.body
  );
}

function MenuItem({ children, icon, end, onClick, ref, expanded, controls }: { children: ReactNode; icon: ReactNode; end?: ReactNode; onClick: () => void; ref?: React.Ref<HTMLButtonElement>; expanded?: boolean; controls?: string }) {
  return <button type="button" ref={ref} className="media-context-menu-item" role="menuitem" aria-expanded={expanded} aria-controls={controls} onClick={onClick}>
    <span className="media-context-menu-icon" aria-hidden="true">{icon}</span>
    <span className="media-context-menu-label">{children}</span>
    {end && <span className="media-context-menu-end">{end}</span>}
  </button>;
}
