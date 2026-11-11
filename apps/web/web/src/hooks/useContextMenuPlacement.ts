import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';
import { contextMenuPlacement, type ContextMenuPosition } from '../utils/context-menu';

export function useContextMenuPlacement(ref: RefObject<HTMLDivElement | null>, point: ContextMenuPosition,
  returnFocus?: HTMLElement | null) {
  const keyboard = Boolean(point.keyboard || (point.x === 0 && point.y === 0));
  const [placement, setPlacement] = useState(() => contextMenuPlacement(point,
    { width: 280, height: 0 }, { width: window.innerWidth, height: window.innerHeight }));
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const content = menu.querySelector<HTMLElement>('.context-popover-content');
    const bounds = keyboard && point.x === 0 && point.y === 0 ? returnFocus?.getBoundingClientRect() : null;
    const anchor = bounds ? { x: bounds.left + 24, y: bounds.top + 24 } : point;
    const measure = () => {
      // Layout dimensions do not shrink while the entry transition is running.
      const height = menu.offsetHeight + (content ? content.scrollHeight - content.clientHeight : 0);
      const next = contextMenuPlacement(anchor, { width: menu.offsetWidth, height },
        { width: window.innerWidth, height: window.innerHeight });
      setPlacement(previous => previous.left === next.left && previous.top === next.top
        && previous.anchor === next.anchor && previous.side === next.side && previous.maxHeight === next.maxHeight ? previous : next);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(menu);
    if (content) resize.observe(content);
    return () => resize.disconnect();
  }, [ref, point.x, point.y, point.keyboard, keyboard, returnFocus]);
  return {
    side: placement.side, animate: !keyboard,
    style: { left: placement.left, top: placement.top, maxHeight: placement.maxHeight,
      '--popover-anchor-y': placement.anchor + 'px' } as CSSProperties
  };
}
