export type MediaKind = 'movie' | 'series' | 'video';

export type SortKey = 'title' | 'newest' | 'oldest' | 'year' | 'duration' | 'random';

export type QueueBehavior = 'auto' | 'loop' | 'manual';

export interface MediaItem {
  id: number;
  canonical_id?: number;
  library_id: number;
  path: string;
  filename: string;
  title: string;
  sort_title: string;
  kind: MediaKind;
  series_title: string | null;
  season: number | null;
  episode: number | null;
  year: number | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  container: string | null;
  folder: string;
  size: number;
  mtime: number;
  thumbnail_path: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  genres: string | null;
  external_id: string | null;
  metadata_blocked?: number;
  metadata_revision?: number;
  added_at: number;
  updated_at: number;
  progress_position?: number;
  progress_updated_at?: number;
  progress_duration?: number;
  progress_completed?: number;
  liked?: number;
}

export interface FolderEntry {
  library_id: number;
  folder: string;
  count: number;
}

export interface HomeData {
  favorites: MediaItem[];
  nextEpisodes: MediaItem[];
  unwatched: MediaItem[];
  quickWatches: MediaItem[];
  genres: Array<{name:string;items:MediaItem[]}>;
  recent: MediaItem[];
  continueWatching: MediaItem[];
  movies: MediaItem[];
  series: MediaItem[];
  total: number;
}

export interface ShortItem extends MediaItem {
  liked: number;
}

export interface ShortsFeed {
  items: ShortItem[];
  total: number;
  startId?: number;
}

export interface Library { id:number; path:string; label:string; created_at:number; persistent:number }
export interface Settings {
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
  running:boolean; startedAt:number|null; finishedAt:number|null; total:number; scanned:number; added:number; updated:number; skipped:number; thumbnailsGenerated?:number; thumbnailsRepaired?:number; errors:number; message:string;
}

export interface PlaybackTrack {
  index: number;
  typeIndex: number;
  codec: string;
  language: string | null;
  title: string | null;
  channels: number | null;
  channelLayout: string | null;
  default: boolean;
  forced: boolean;
  supported: boolean;
}

export interface PlaybackInfo {
  videoCodec: string | null;
  width: number | null;
  height: number | null;
  qualityOptions: PlaybackQuality[];
  audioTracks: PlaybackTrack[];
  subtitleTracks: PlaybackTrack[];
  defaultAudioStream: number | null;
  requiresVideoTranscode: boolean;
  requiresAudioTranscode: boolean;
  requiresTranscode: boolean;
}

export interface PlaybackQuality {
  height: number;
  label: string;
  bitrate: number;
}
