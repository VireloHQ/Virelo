import { t, useLocale } from '../i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { api } from '../api';
import { useLocalMediaUrl } from '../hooks/useLocalMediaUrl';
import { Player } from '../components/Player';
import type { ShortItem } from '../types';

const PAGE_SIZE = 40;
const RENDER_WINDOW = 2;

export function ShortsView() {
  const { startId } = useSearch({ from: '/app/shorts' });
  return <ShortsFeedView key={startId ?? 'random'} startId={startId} />;
}

function ShortsFeedView({ startId }: { startId?: number }) {
  useLocale();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexRef = useRef(0);
  const scrollerHeight = useRef(0);
  activeIndexRef.current = activeIndex;
  const [pipOn, setPipOn] = useState(false);
  const [seed] = useState(() => crypto.getRandomValues(new Uint32Array(1))[0]);

  const query = useInfiniteQuery({
    queryKey: ['shorts', seed, startId],
    queryFn: ({ pageParam }) => api.shorts({ limit: PAGE_SIZE, offset: pageParam, seed, startId }),
    initialPageParam: 0,
    gcTime: 0,
    getNextPageParam: (page, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0);
      return loaded < page.total ? loaded : undefined;
    }
  });

  const items: ShortItem[] = [];
  for (const page of query.data?.pages ?? []) items.push(...page.items);
  const activeItem = items[activeIndex];
  const total = query.data?.pages[0]?.total ?? 0;
  const hasNextPage = Boolean(query.hasNextPage);

  const onScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || el.clientHeight < 1 || scrollerHeight.current !== el.clientHeight) return;
    const index = Math.round(el.scrollTop / el.clientHeight);
    setActiveIndex((prev) => (prev === index ? prev : index));
  }, []);

  const goTo = useCallback((index: number) => {
    const el = scrollerRef.current;
    if (!el || items.length === 0) return;
    const clamped = Math.max(0, Math.min(index, items.length - 1));
    el.scrollTo({ top: clamped * el.clientHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  }, [items.length]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const align = () => {
      scrollerHeight.current = el.clientHeight;
      el.scrollTo({ top: activeIndexRef.current * el.clientHeight, behavior: 'instant' });
    };
    align();
    const observer = new ResizeObserver(align);
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length > 0]);

  useEffect(() => {
    if (hasNextPage && items.length - activeIndex < 4) void query.fetchNextPage();
  }, [activeIndex, items.length, hasNextPage, query.fetchNextPage]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || (e.target instanceof Element && e.target.closest('input, textarea, select, button, [role="menu"], [role="dialog"]'))) return;
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); goTo(activeIndex + 1); }
      else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goTo(activeIndex - 1); }
      else if (e.key === 'Home') { e.preventDefault(); goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); goTo(items.length - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goTo, activeIndex, items.length]);

  if (query.isError && items.length === 0) return <div className="shorts-empty"><p>{t("Shorts could not be loaded.")}</p><button onClick={() => void query.refetch()}>{t("Try again")}</button></div>;
  if (query.isLoading) return <PageSkeleton kind="shorts" />;
  if (startId !== undefined && query.data && items[0]?.id !== startId) {
    return <div className="shorts-empty"><p>{t("This Short is no longer available in your Shorts feed.")}</p>
      <button onClick={() => history.back()}>{t("Back")}</button></div>;
  }
  if (!query.isFetching && total === 0 && items.length === 0) {
    return (
      <div className="shorts-empty">
        <p>{t("No vertical videos found. Portrait clips (height > width) appear here as Shorts.")}</p>
        <button onClick={() => history.back()}>{t("Back")}</button>
      </div>
    );
  }

  return (
    <div className="shorts-view">
      <div className="shorts-scroller" ref={scrollerRef} onScroll={onScroll}>
        {items.map((item, i) => (
          <div className="short-slot" key={item.id}>
            {Math.abs(i - activeIndex) <= RENDER_WINDOW
              ? <div className="short-stage"><ShortsClip item={item} active={i === activeIndex} onSkip={() => goTo(i + 1)} pipOn={pipOn} onPip={setPipOn} /></div>
              : <div className="short-slot-placeholder" />}
          </div>
        ))}
      </div>
      {activeItem && (
        <div className="short-info" aria-live="polite">
          <h2>{activeItem.title}</h2>
          <p>{activeItem.filename}</p>
        </div>
      )}
    </div>
  );
}

function ShortsClip({ item, active, onSkip, pipOn, onPip }: { item: ShortItem; active: boolean; onSkip: () => void; pipOn: boolean; onPip: (on: boolean) => void }) {
  const navigate = useNavigate();
  if (!active) return <ShortsPreview item={item} />;
  return <Player item={item} autoPlay repeatMode="one" shorts={{
    onNext: onSkip, pipOn, onPipChange: onPip,
    onDetails: () => void navigate({ to: '/app/title/$mediaId', params: { mediaId: String(item.id) } })
  }} />;
}

function ShortsPreview({ item }: { item: ShortItem }) {
  const source = useLocalMediaUrl(item.id);
  return <div className="short-frame" aria-hidden="true">
    <video className="short-video" src={source.url || undefined} preload="metadata" muted playsInline tabIndex={-1} />
  </div>;
}
