import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, horizontalListSortingStrategy, verticalListSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowCounterClockwise, ArrowDown, ArrowUp, CaretLeft, CaretRight, DotsThree, DotsSixVertical, List, Play, Queue as QueueIcon, Rows, Shuffle, SkipForward, X } from '@phosphor-icons/react';
import { artwork } from '../api';
import type { MediaItem } from '../types';
import { RepeatControl } from './RepeatControl';
import { PlayerActionMenu, type PlayerAction } from './PlayerActionMenu';
import { useRowWheel } from '../hooks/useRowWheel';
import { useQueueLayout } from '../hooks/useQueueLayout';
import type { ContextMenuPosition } from '../utils/context-menu';
import type { RepeatMode } from '../utils/playback-repeat';
import { cssTimeToMilliseconds } from '../utils/motion-time';
import { clearUpcoming, moveQueueItem, playQueueItemNext, removeQueueItem, resetQueue, toggleQueueShuffle, undoQueueEdit, type QueueState } from '../utils/playback-queue';

interface PlaybackQueueProps {
  items: MediaItem[];
  activeIndex: number;
  repeatMode: RepeatMode;
  onRepeatChange: (mode: RepeatMode) => void;
  onSelect: (index: number) => void;
  state: QueueState;
  onEdit: (change: (current: QueueState) => QueueState) => void;
}
const reducedQuery = () => window.matchMedia('(prefers-reduced-motion: reduce)');
const subscribeMotion = (notify: () => void) => {
  const query = reducedQuery(); query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export function PlaybackQueue({ items, activeIndex, repeatMode, onRepeatChange, onSelect, state, onEdit }: PlaybackQueueProps) {
  const { layout, setLayout } = useQueueLayout();
  const vertical = layout === 'vertical';
  const reduced = useSyncExternalStore(subscribeMotion, () => reducedQuery().matches);
  const [motion] = useState(() => {
    const style = getComputedStyle(document.documentElement);
    return { duration: cssTimeToMilliseconds(style.getPropertyValue('--dur-short')) || 200, easing: style.getPropertyValue('--ease-out').trim() || 'cubic-bezier(.23,1,.32,1)' };
  });
  const queueList = useRef<HTMLOListElement>(null);
  const scroll = useRowWheel(queueList, items.length, !vertical);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [dragId, setDragId] = useState<number | null>(null);
  const [keyboardDrag, setKeyboardDrag] = useState(false);
  const [menu, setMenu] = useState<{ id: number | null; position: ContextMenuPosition; trigger: HTMLElement } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates, scrollBehavior: 'auto' }));
  const currentId = items[activeIndex]?.id;
  const dragItem = items.find(item => item.id === dragId);
  const showCurrent = (instant = false) => {
    const list = queueList.current;
    const tile = list?.querySelector<HTMLElement>('[aria-current="true"]')?.closest('li');
    if (!list || !tile) return;
    const bounds = tile.getBoundingClientRect(), rail = list.getBoundingClientRect();
    if (vertical) {
      if (bounds.top < rail.top || bounds.bottom > rail.bottom)
        list.scrollBy({ top: bounds.top - rail.top - (list.clientHeight - tile.clientHeight) / 2, behavior: instant || reduced ? 'instant' : 'smooth' });
    } else if (bounds.left < rail.left || bounds.right > rail.right) {
      scroll(bounds.left - rail.left - (list.clientWidth - tile.clientWidth) / 2, instant ? 'instant' : undefined);
    }
  };
  const showCurrentRef = useRef(showCurrent); showCurrentRef.current = showCurrent;
  // Follow actual playback changes, not index changes caused by editing the queue.
  useEffect(() => { showCurrentRef.current(true); }, [currentId, layout]);
  useEffect(() => {
    const list = queueList.current; if (!list) return;
    const update = () => {
      const next = { left: list.scrollLeft > 2, right: list.scrollLeft + list.clientWidth < list.scrollWidth - 2 };
      setEdges(old => old.left === next.left && old.right === next.right ? old : next);
    };
    const observer = new ResizeObserver(update); observer.observe(list);
    list.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); list.removeEventListener('scroll', update); };
  }, [items.length, layout]);
  const browse = (direction: number) => scroll(direction * (queueList.current?.clientWidth ?? 300) * .85);
  const openMenu = (id: number | null, trigger: HTMLElement, position?: ContextMenuPosition, keyboard = false) => {
    const rect = trigger.getBoundingClientRect();
    setMenu({ id, trigger, position: position ?? { x: rect.right, y: rect.top + rect.height / 2, keyboard } });
  };
  const focusList = () => requestAnimationFrame(() => queueList.current?.focus({ preventScroll: true }));
  const menuIndex = items.findIndex(item => item.id === menu?.id);
  const menuItem = items[menuIndex];
  const actions: PlayerAction[] = menu?.id == null ? [
    { label: 'Show now playing', icon: <Play/>, action: () => showCurrent(Boolean(menu?.position.keyboard)) },
    { label: 'Clear upcoming', icon: <X/>, disabled: activeIndex === items.length - 1, action: () => onEdit(clearUpcoming) },
    { label: 'Reset queue', icon: <ArrowCounterClockwise/>, action: () => onEdit(resetQueue) }
  ] : [
    { label: 'Play now', icon: <Play/>, disabled: menuIndex === activeIndex, action: () => onSelect(menuIndex) },
    { label: 'Play next', icon: <SkipForward/>, disabled: menuIndex === activeIndex || menuIndex === activeIndex + 1, action: () => onEdit(queue => playQueueItemNext(queue, menuItem.id)) },
    { label: 'Move earlier', icon: <ArrowUp/>, disabled: menuIndex === 0, action: () => onEdit(queue => moveQueueItem(queue, menuItem.id, menuIndex - 1)) },
    { label: 'Move later', icon: <ArrowDown/>, disabled: menuIndex === items.length - 1, action: () => onEdit(queue => moveQueueItem(queue, menuItem.id, menuIndex + 1)) },
    { label: menuIndex === activeIndex ? (menuIndex < items.length - 1 ? 'Remove and play next' : 'Remove and play previous') : 'Remove from queue', icon: <X/>, disabled: items.length <= 1,
      action: () => { onEdit(queue => removeQueueItem(queue, menuItem.id)); focusList(); } }
  ];
  return <section className="playback-queue" data-layout={layout} aria-labelledby="playback-queue-title">
    <header className="playback-queue-head">
      <div className="playback-queue-title"><QueueIcon/><div><h2 id="playback-queue-title">Queue</h2><span>{activeIndex + 1} of {items.length}</span></div></div>
      <div className="playback-queue-nav">
        <button type="button" aria-label="Shuffle queue" aria-pressed={state.shuffled} title={state.shuffled ? 'Turn shuffle off' : 'Shuffle queue'} disabled={items.length < 2} onClick={() => onEdit(toggleQueueShuffle)}><Shuffle/></button>
        <RepeatControl mode={repeatMode} hasQueue queueOnly onChange={onRepeatChange}/>
        <button type="button" aria-label={vertical ? 'Use horizontal queue' : 'Use vertical queue'} title={vertical ? 'Horizontal queue' : 'Vertical queue'} onClick={() => setLayout(vertical ? 'horizontal' : 'vertical')}>{vertical ? <Rows/> : <List/>}</button>
        <button type="button" aria-label="Queue options" aria-haspopup="menu" aria-expanded={menu?.id === null} onClick={event => openMenu(null, event.currentTarget, undefined, event.detail === 0)}><DotsThree weight="bold"/></button>
      </div>
    </header>
    <DndContext sensors={sensors} collisionDetection={args => {
      const point = args.pointerCoordinates, bounds = queueList.current?.getBoundingClientRect();
      if (point && bounds && (point.x < bounds.left || point.x > bounds.right || point.y < bounds.top || point.y > bounds.bottom)) return [];
      return closestCenter(args);
    }}
      accessibility={{ screenReaderInstructions: { draggable: 'Press Space or Enter to pick up a video. Use arrow keys to move it, Space or Enter to drop, or Escape to cancel.' },
        announcements: {
          onDragStart: ({ active }) => `Picked up ${items.find(item => item.id === active.id)?.title}.`,
          onDragOver: ({ over }) => over ? `Position ${items.findIndex(item => item.id === over.id) + 1} of ${items.length}.` : undefined,
          onDragEnd: ({ over }) => over ? `Dropped at position ${items.findIndex(item => item.id === over.id) + 1}.` : 'Reordering cancelled.',
          onDragCancel: () => 'Reordering cancelled.'
        } }}
      onDragStart={({ active, activatorEvent }) => { setMenu(null); setKeyboardDrag(activatorEvent instanceof KeyboardEvent); setDragId(Number(active.id)); }}
      onDragCancel={() => setDragId(null)}
      onDragEnd={({ active, over }) => {
        setDragId(null);
        if (over && active.id !== over.id) onEdit(queue => moveQueueItem(queue, Number(active.id), queue.ids.indexOf(Number(over.id))));
      }}>
      <SortableContext items={items.map(item => item.id)} strategy={vertical ? verticalListSortingStrategy : horizontalListSortingStrategy}>
        <ol className="playback-queue-list" ref={queueList} tabIndex={0} aria-label="Videos in queue"
          onKeyDown={event => {
            if (event.target !== event.currentTarget) return;
            const list = event.currentTarget, forward = vertical ? 'ArrowDown' : 'ArrowRight', backward = vertical ? 'ArrowUp' : 'ArrowLeft';
            const distance = vertical ? list.clientHeight : list.clientWidth;
            const delta = event.key === forward || event.key === 'PageDown' ? distance * .85 :
              event.key === backward || event.key === 'PageUp' ? -distance * .85 :
              event.key === 'Home' ? -Infinity : event.key === 'End' ? Infinity : null;
            if (delta !== null) {
              event.preventDefault();
              const amount = Number.isFinite(delta) ? delta : delta > 0 ? (vertical ? list.scrollHeight : list.scrollWidth) : -(vertical ? list.scrollHeight : list.scrollWidth);
              if (vertical) list.scrollBy({ top: amount, behavior: 'instant' }); else scroll(amount, 'instant');
            }
          }}>
          {items.map((item, index) => <QueueTile key={item.id} item={item} index={index} activeIndex={activeIndex} motion={reduced || keyboardDrag ? null : motion} disabled={items.length < 2}
            onSelect={() => onSelect(index)} onMenu={(trigger, point, keyboard) => openMenu(item.id, trigger, point, keyboard)}
            menuOpen={menu?.id === item.id}/>)}
        </ol>
      </SortableContext>
      {createPortal(<DragOverlay dropAnimation={null}>
        {dragItem ? <div className="queue-drag-preview" data-layout={layout}><DotsSixVertical/><QueueArtwork item={dragItem}/><strong>{dragItem.title}</strong></div> : null}
      </DragOverlay>, document.body)}
    </DndContext>
    <div className="queue-footer">
      <div className="queue-feedback"><span role="status">{state.notice || 'Drag the handle to reorder.'}</span><button type="button" disabled={!state.undo?.ids.length} onClick={() => onEdit(undoQueueEdit)} aria-label="Undo queue change">Undo</button></div>
      {!vertical && <div className="queue-scroll-controls">
        <button type="button" onClick={() => browse(-1)} disabled={!edges.left} aria-label="Scroll queue left"><CaretLeft/></button>
        <button type="button" onClick={() => browse(1)} disabled={!edges.right} aria-label="Scroll queue right"><CaretRight/></button>
      </div>}
    </div>
    {menu && (menu.id === null || menuItem) && <PlayerActionMenu position={menu.position} label={menuItem ? `${menuItem.title} queue actions` : 'Queue options'} actions={actions} returnFocus={menu.trigger} onClose={() => setMenu(null)}/>}
  </section>;
}

function QueueTile({ item, index, activeIndex, motion, disabled, onSelect, onMenu, menuOpen }: {
  item: MediaItem; index: number; activeIndex: number; motion: { duration: number; easing: string } | null; disabled: boolean; onSelect: () => void; menuOpen: boolean;
  onMenu: (trigger: HTMLElement, position?: ContextMenuPosition, keyboard?: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id, disabled, transition: motion
  });
  const active = index === activeIndex;
  return <li ref={setNodeRef} className="playback-queue-tile" data-queue-id={item.id} data-dragging={isDragging || undefined}
    style={{ transform: CSS.Transform.toString(transform), transition: motion ? transition : undefined }}
    onContextMenu={event => { event.preventDefault(); onMenu(event.currentTarget.querySelector<HTMLButtonElement>('.queue-item-menu')!, { x: event.clientX, y: event.clientY, keyboard: event.clientX === 0 && event.clientY === 0 }); }}
    onKeyDown={event => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); event.stopPropagation();
        onMenu(event.currentTarget.querySelector<HTMLButtonElement>('.queue-item-menu')!, undefined, true);
      }
    }}>
    <button type="button" className={`playback-queue-item${active ? ' active' : ''}`} onClick={onSelect} aria-current={active ? 'true' : undefined} aria-label={`Play ${item.title}`}>
      <QueueArtwork item={item}/>
      <span className="playback-queue-copy"><small>{active ? 'Now playing' : index === activeIndex + 1 ? 'Up next' : `Video ${index + 1}`}</small><strong title={item.title}>{item.title}</strong><span>{queueMeta(item)}</span></span>
    </button>
    <div className="queue-item-actions">
      <button type="button" className="queue-drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} disabled={disabled} aria-label={`Reorder ${item.title}`} title="Drag to reorder"><DotsSixVertical/></button>
      <span aria-hidden="true">{index + 1}</span>
      <button type="button" className="queue-item-menu" aria-label={`Options for ${item.title}`} aria-haspopup="menu" aria-expanded={menuOpen}
        onClick={event => onMenu(event.currentTarget, undefined, event.detail === 0)}><DotsThree weight="bold"/></button>
    </div>
  </li>;
}
function QueueArtwork({ item }: { item: MediaItem }) {
  return <span className="playback-queue-art">
    <span className="playback-queue-fallback"><Play weight="fill"/></span>
    <img key={`${item.id}:${item.metadata_revision ?? 0}`} src={artwork(item, item.backdrop_path ? 'backdrop' : item.poster_path ? 'poster' : 'thumbnail')} alt="" loading="lazy" decoding="async" draggable={false}
      onError={event => { event.currentTarget.style.display = 'none'; }}/>
  </span>;
}
function queueMeta(item: MediaItem) {
  const episode = item.kind === 'series' && item.season != null && item.episode != null ? `S${String(item.season).padStart(2, '0')} · E${String(item.episode).padStart(2, '0')}` : '';
  if (!item.duration || !Number.isFinite(item.duration)) return episode;
  const total = Math.round(item.duration), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
  const duration = hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
  return episode ? `${episode} · ${duration}` : duration;
}
