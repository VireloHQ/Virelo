import { t, useLocale } from '../i18n';
import { Suspense, createElement, useCallback, useRef, useState, type ComponentType, type FunctionComponent } from 'react';
import { useBlocker, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { ArrowClockwise, X } from '@phosphor-icons/react';
import { PageSkeleton, type SkeletonKind } from './PageSkeleton';
import { createRouteLoader, RouteLoadError } from '../utils/route-loading';
import './RouteRecovery.css';

export type RouteView = FunctionComponent & { preload: () => Promise<void>; pending: FunctionComponent };

export function createRouteView<T>(importer: () => Promise<T>, exportName: keyof T, kind: SkeletonKind): RouteView {
  const loader = createRouteLoader(importer, { validate: module => {
    if (!module || typeof module[exportName] !== 'function') throw new Error('The downloaded page module is incomplete.');
  } });
  function LoadedView() {
    const module = loader.read();
    return createElement(module[exportName] as ComponentType);
  }
  function View() {
    return <Suspense fallback={<PageSkeleton kind={kind} />}><LoadedView /></Suspense>;
  }
  View.preload = async () => { await loader.load(); };
  View.pending = () => <PageSkeleton kind={kind} />;
  return View;
}

export function RoutePendingView({ viewForPath }: { viewForPath: (pathname: string) => RouteView | undefined }) {
  const Pending = viewForPath(window.location.pathname)?.pending;
  return Pending ? <Pending /> : <PageSkeleton kind="library" />;
}

export function RouteErrorView({ error, reset }: ErrorComponentProps) {
  useLocale();
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try {
      if (error instanceof RouteLoadError) await error.retry();
      await router.invalidate({ sync: true });
      reset();
    } catch {
      // Stay on this local fallback; do not reload the app or lose playback state.
    } finally { setRetrying(false); }
  };
  return <section className="route-error-view" aria-labelledby="route-error-title">
    <h1 id="route-error-title">{t("This page is temporarily unavailable")}</h1>
    <p>{error instanceof RouteLoadError ? t("Check your connection and try again. If the app was updated, reload when you are ready.") : t("The page could not be displayed. You can try opening it again.")}</p>
    <div className="route-recovery-actions">
      <button disabled={retrying} onClick={() => void retry()}><ArrowClockwise aria-hidden="true" />{retrying ? t("Retrying…") : t("Try again")}</button>
      <button className="route-recovery-secondary" onClick={() => window.location.reload()}>{t("Reload app")}</button>
    </div>
  </section>;
}

export function RouteNavigationGuard({ viewForPath }: { viewForPath: (pathname: string) => RouteView | undefined }) {
  useLocale();
  const router = useRouter();
  const sequence = useRef(0);
  const [notice, setNotice] = useState<{ retry: () => void } | null>(null);
  const shouldBlock = useCallback(async ({ next }: { next: { pathname: string; search: unknown } }) => {
    const attempt = ++sequence.current;
    const view = viewForPath(next.pathname);
    if (!view) { setNotice(null); return false; }
    try {
      await view.preload();
      if (attempt !== sequence.current) return true;
      setNotice(null);
      return false;
    } catch (error) {
      console.warn('Virelo kept the current page after a route download failed.', error);
      if (attempt === sequence.current) setNotice({ retry: () => {
        void router.navigate({ to: next.pathname, search: () => next.search as never });
      } });
      return true;
    }
  }, [router, viewForPath]);

  // Download the destination before committing navigation. The existing Player
  // stays mounted, with its current source/time/volume, if the download fails.
  useBlocker({ shouldBlockFn: shouldBlock, enableBeforeUnload: false });
  return notice ? <aside className="route-recovery-notice" role="status" aria-live="polite">
    <div><strong>{t("Couldn’t open that page")}</strong><p>{t("Your current screen is still available. Try again, or reload when you’re ready.")}</p></div>
    <div className="route-recovery-actions">
      <button onClick={notice.retry}><ArrowClockwise aria-hidden="true" />{t("Try again")}</button>
      <button className="route-recovery-secondary" onClick={() => window.location.reload()}>{t("Reload app")}</button>
    </div>
    <button className="route-recovery-dismiss" aria-label={t("Dismiss message")} onClick={() => setNotice(null)}><X aria-hidden="true" /></button>
  </aside> : null;
}
