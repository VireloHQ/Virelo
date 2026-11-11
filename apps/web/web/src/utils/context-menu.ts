export interface ContextMenuPosition { x: number; y: number; keyboard?: boolean }
export interface PopoverAnchor { left: number; right: number; top: number; bottom: number }

export function sidePopoverPlacement(anchor: PopoverAnchor, size: { width: number; height: number },
  viewport: { width: number; height: number }) {
  const margin = 16, gap = 14;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  const width = Math.min(size.width, Math.max(0, viewport.width - margin * 2));
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(size.height, maxHeight);
  const right = Math.max(0, viewport.width - anchor.right - gap - margin);
  const left = Math.max(0, anchor.left - gap - margin);
  const side = right >= width || right >= left ? 'right' : 'left';
  const y = clamp((anchor.top + anchor.bottom) / 2, margin, viewport.height - margin);
  const top = clamp(y - 24, margin, viewport.height - height - margin);
  const inset = Math.min(24, height / 2);
  return {
    width, left: clamp(side === 'right' ? anchor.right + gap : anchor.left - gap - width, margin, viewport.width - width - margin),
    top, anchor: clamp(y - top, inset, height - inset), side, maxHeight
  };
}

export function contextMenuPlacement(point: ContextMenuPosition, size: { width: number; height: number },
  viewport: { width: number; height: number }) {
  return sidePopoverPlacement({ left: point.x, right: point.x, top: point.y, bottom: point.y }, size, viewport);
}
