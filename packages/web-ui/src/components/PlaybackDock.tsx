import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useRouter, useRouterState } from '@tanstack/react-router';
import type { SortKey } from '@virelo/core/media';
import { t } from '@edition/i18n';
import './PlaybackDock.css';

export interface WatchRouteSearch {
  resumeSession?: string;
  queue?: boolean;
  favorites?: boolean;
  playlistId?: number;
  seriesTitle?: string;
  folder?: string;
  exactFolder?: boolean;
  libraryId?: number;
  sort?: SortKey;
  search?: string;
}

export type PlaybackSource =
  | { kind: 'watch'; mediaId: string; search: WatchRouteSearch }
  | { kind: 'shorts'; startId?: number }
  | { kind: 'live-tv' };

export interface PlaybackDockState {
  source: PlaybackSource;
  minimized: boolean;
  started: boolean;
  onPlaying: () => void;
  onStopped: () => void;
  minimize: () => void;
  restore: () => void;
  close: () => void;
}

export const PlaybackDockContext = createContext<PlaybackDockState | null>(null);
export const usePlaybackDock = () => useContext(PlaybackDockContext);
const MiniplayerOpenContext=createContext(false);
export const useMiniplayerOpen = () => useContext(MiniplayerOpenContext);

export function usePlaybackSource<K extends PlaybackSource['kind']>(kind: K) {
  const source = usePlaybackDock()?.source;
  if (source?.kind !== kind) throw new Error(t("The page could not be displayed. You can try opening it again."));
  return source as Extract<PlaybackSource, {kind: K}>;
}

type Location = ReturnType<typeof useLocation>;
type Session = {key: string; source: PlaybackSource; location: Location};

export function PlaybackDock({ source, playbackPath, libraryPath, render, children }: {
  source: PlaybackSource | null;
  playbackPath?: string;
  libraryPath: string;
  render: (kind: PlaybackSource['kind']) => ReactNode;
  children: ReactNode;
}) {
  const router = useRouter(), location = useLocation();
  const resolvedHref=useRouterState({select:state=>state.resolvedLocation?.href});
  const [saved, setSaved] = useState<Session | null>(null);
  const [browsing, setBrowsing] = useState<Location | null>(null);
  const [played, setPlayed] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const incoming = source && {key: JSON.stringify(source), source, location};
  // The new URL can arrive before its match. Never save that URL as the previous player's address.
  if (incoming && playbackPath?.replace(/\/$/,'') === location.pathname.replace(/\/$/,'') &&
    (saved?.key !== incoming.key || saved.location.href !== location.href)) setSaved(incoming);
  if (!source && resolvedHref === location.href && browsing?.href !== location.href) setBrowsing(location);
  const session = incoming ?? (saved?.key === played ? saved : null);
  const minimized = Boolean(session && !source);

  useEffect(() => {
    if (minimized && document.fullscreenElement && host.current?.contains(document.fullscreenElement))
      void document.exitFullscreen().catch(() => {});
  }, [minimized]);

  const go = (target: Location | null) => {
    if (!target) return void router.navigate({to: libraryPath});
    void router.navigate({to: target.pathname, search: () => target.search as never, hash: target.hash});
  };

  // Keep the same DOM and decoder while the route changes; only the surrounding layout moves.
  return <>
    <MiniplayerOpenContext.Provider value={minimized}>{children}</MiniplayerOpenContext.Provider>
    {session && <PlaybackDockContext.Provider key={session.key} value={{
      source: session.source, minimized, started: session.key === played,
      onPlaying: () => setPlayed(session.key),
      onStopped: () => setPlayed(previous=>previous===session.key ? null : previous),
      minimize: () => go(browsing),
      restore: () => go(session.location),
      close: () => { setSaved(null); setPlayed(null); }
    }}>
      <div className="playback-dock" data-minimized={minimized || undefined} ref={host}>
        {render(session.source.kind)}
      </div>
    </PlaybackDockContext.Provider>}
  </>;
}
