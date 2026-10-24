import { useEffect, useId, useRef, useState } from 'react';
import { CaretDown, Check } from '@phosphor-icons/react';

export interface SelectOption { value: string; label: string }

export function Select({ value, options, onChange, label, align = 'start', className }: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label?: string;
  align?: 'start' | 'end';
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [animate, setAnimate] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (open) {
      const index = Math.max(0, options.findIndex((o) => o.value === value));
      setFocusIndex(index);
      const onDocClick = (e: MouseEvent) => {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
      };
      document.addEventListener('mousedown', onDocClick);
      return () => document.removeEventListener('mousedown', onDocClick);
    }
  }, [open, options, value]);

  useEffect(() => {
    if (open) optionRefs.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const openMenu = (direction: 'current' | 'next' | 'previous' = 'current', pointer = false) => {
    setAnimate(pointer);
    const currentIndex = Math.max(0, options.findIndex((o) => o.value === value));
    const nextIndex = direction === 'next'
      ? Math.min(options.length - 1, currentIndex + 1)
      : direction === 'previous'
        ? Math.max(0, currentIndex - 1)
        : currentIndex;
    setFocusIndex(nextIndex);
    setOpen(true);
  };

  const onTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    setAnimate(false);
    e.stopPropagation();
    if (e.key === 'Escape' && open) { e.preventDefault(); close(true); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open ? close() : openMenu(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); open ? setFocusIndex((i) => Math.min(options.length - 1, i + 1)) : openMenu('next'); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); open ? setFocusIndex((i) => Math.max(0, i - 1)) : openMenu('previous'); }
  };

  const onRootKeyDown = (e: React.KeyboardEvent) => {
    if (!open) return;
    setAnimate(false);
    if (e.key === 'Escape') { e.preventDefault(); close(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setFocusIndex((i) => e.key === 'ArrowDown' ? Math.min(options.length - 1, i + 1) : Math.max(0, i - 1));
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault();
      setFocusIndex(e.key === 'Home' ? 0 : options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      const option = options[focusIndex];
      if (option) { e.preventDefault(); onChange(option.value); close(true); }
    }
  };

  return <div className={`picker${className ? ` ${className}` : ''}`} ref={rootRef} data-align={align} data-animate={animate} data-open={open} onKeyDown={onRootKeyDown}>
    <button type="button" ref={triggerRef} className="picker-trigger" aria-haspopup="listbox" aria-expanded={open} aria-controls={menuId} aria-label={label}
      onClick={event => open ? close() : openMenu('current', event.detail > 0)} onKeyDown={onTriggerKeyDown}>
      <span>{current?.label ?? value}</span>
      <CaretDown weight="bold"/>
    </button>
    <div id={menuId} hidden={!open} inert={!open} aria-hidden={!open} className="picker-menu" role="listbox" aria-label={label} style={align === 'end' ? { right: 0, left: 'auto' } : undefined}>
      {options.map((option, i) => (
        <button type="button" role="option" aria-selected={option.value === value} key={option.value}
          id={`${menuId}-option-${option.value}`}
          ref={(el) => { optionRefs.current[i] = el; }}
          className={`picker-option${option.value === value ? ' selected' : ''}`}
          onMouseEnter={() => setFocusIndex(i)}
          onClick={() => { onChange(option.value); close(true); }}>
          <span>{option.label}</span>
          {option.value === value && <Check weight="bold"/>}
        </button>
      ))}
    </div>
  </div>;
}
