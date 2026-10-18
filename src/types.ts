export type MediaKind = 'movie' | 'series' | 'video';

export type SortKey = 'title' | 'newest' | 'oldest' | 'year' | 'duration' | 'random';

export type QueueBehavior = 'auto' | 'loop' | 'manual';

export type DataCategory = 'database' | 'thumbnails' | 'artwork' | 'cache';
export interface DataUsage {
  dataDir: string;
  totalBytes: number;
  categories: Record<DataCategory, {bytes: number; files: number}>;
  skippedLinks: number;
  cacheLimitBytes: number;
}

export interface Library {
  id: number;
  path: string;
  label: string;
  created_at: number;
  persistent: number;
}

export interface MediaRecord {
  id: number;
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
  progress_duration?: number;
  progress_completed?: number;
  liked?: number;
}

export interface FolderEntry {
  library_id: number;
  folder: string;
  count: number;
}

export interface AppSettings {
  externalMetadataEnabled: boolean;
  externalImagesEnabled: boolean;
  metadataProvider: 'cinemeta' | 'tmdb';
  metadataLanguage: string;
  tmdbApiKey: string;
  libraryWatchEnabled: boolean;
  shortsIncludeLandscapes: boolean;
  queueBehavior: QueueBehavior;
}

export interface ShortsItem extends MediaRecord {
  liked: number;
}

export interface ShortsFeed {
  items: ShortsItem[];
  total: number;
}

export interface ScanStatus {
  running: boolean;
  startedAt: number | null;
  finishedAt: number | null;
  total: number;
  scanned: number;
  added: number;
  updated: number;
  skipped: number;
  errors: number;
  message: string;
}
