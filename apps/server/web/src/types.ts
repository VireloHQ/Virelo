import type { MediaItem, QueueBehavior } from '@virelo/core/media';
export type { MediaItem, MediaKind, SortKey, QueueBehavior, FolderEntry, HomeData, ShortItem, ShortsFeed, PlaybackTrack, PlaybackQuality, PlaybackInfo } from '@virelo/core/media';

export type { PlaylistSummary, PlaylistWrite } from './utils/playlist-values';
export type PlaylistDetail = import('./utils/playlist-values').PlaylistSummary & { items: MediaItem[] };

export interface Library { id:number; path:string; label:string; created_at:number; persistent:number; folderLabels?:Record<string,string> }
export interface Settings {
  audioAnalysisEnabled:boolean;
  externalMetadataEnabled: boolean;
  externalImagesEnabled: boolean;
  metadataProvider: 'cinemeta' | 'tmdb';
  metadataLanguage: string;
  tmdbApiKey: string;
  tmdbApiKeyConfigured: boolean;
  libraryWatchEnabled: boolean;
  shortsIncludeLandscapes: boolean;
  queueBehavior: QueueBehavior;
}
export interface ScanStatus {
  audioTotal?:number;
  audioAnalyzed?:number;
  running:boolean; startedAt:number|null; finishedAt:number|null; total:number; scanned:number; added:number; updated:number; skipped:number; thumbnailsGenerated?:number; thumbnailsRepaired?:number; errors:number; message:string;
}
