import { createContext, useContext, type ReactNode } from 'react';
import type { MediaItem } from '@virelo/core/media';
import type { PlaylistSummary, PlaylistWrite } from '@edition/types';

interface MediaServices {
  artwork: (item: MediaItem, kind?: 'poster' | 'backdrop' | 'thumbnail') => string;
  api: {
    playlists: () => Promise<PlaylistSummary[]>;
    createPlaylist: (body: { name: string; mediaIds: number[] }) => Promise<PlaylistSummary>;
    updatePlaylist: (id: number, body: PlaylistWrite) => Promise<PlaylistSummary>;
    renameLibrary: (id: number, label: string, folder: string) => Promise<unknown>;
    progress: (id: number, position: number, duration: number) => Promise<unknown>;
  };
}

const MediaServicesContext = createContext<MediaServices | null>(null);
const missingProvider = 'MediaServicesProvider is missing';

export function MediaServicesProvider({ services, children }: { services: MediaServices; children: ReactNode }) {
  return <MediaServicesContext.Provider value={services}>{children}</MediaServicesContext.Provider>;
}

export function useMediaServices() {
  const services = useContext(MediaServicesContext);
  if (!services) throw new Error(missingProvider);
  return services;
}
