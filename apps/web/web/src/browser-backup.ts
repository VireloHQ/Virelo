import { editLibraries, openDatabase } from './local-library';
import type { MediaItem, Settings } from './types';
import { isAppearance, normalizeAppearance } from './utils/appearance';
import { isLocale, LANGUAGE_KEY } from './i18n/locale';
import { libraryFolder, libraryName } from './utils/library-names';
import { playlistIds, playlistName, playlistRevision, type StoredPlaylist } from './utils/playlist-values';
import { PLAYBACK_SPEED_KEY, PLAYBACK_SPEEDS } from './utils/playback-speed';
import { LEVELING_KEY, readAudioAnalysis } from './utils/volume-leveling';

export type BackupKind = 'settings' | 'library';
interface BackupLibrary {
  id: number; label: string; path: string; created_at: number;
  persistent: false; folderLabels: Record<string, string>;
}
type BackupMedia = Omit<MediaItem, 'thumbnail_path' | 'poster_path' | 'backdrop_path'> & { source_path: string };
export interface BrowserBackup {
  format: 'virelo-browser-backup'; version: 1; kind: BackupKind; createdAt: number;
  settings: Settings; preferences: Record<string, string>;
  libraries: BackupLibrary[]; media: BackupMedia[]; playlists: StoredPlaylist[];
}

const MAX_BYTES = 32 * 1024 * 1024;
const INVALID = 'This backup contains invalid or unsafe data.';
const TOO_LARGE = 'Backup files must be 32 MiB or smaller.';
const NOT_EMPTY = 'Library backups can only be imported into an empty browser library.';
const STORES = ['libraries', 'media', 'playlists'];
const PREFERENCE_KEYS = [
  'virelo.appearance.v1', LANGUAGE_KEY, 'virelo.library-layout', 'virelo.queue-layout',
  'virelo.explorer-width', PLAYBACK_SPEED_KEY, 'virelo-playback-quality:v1',
  'virelo-playback-audio:v1', 'virelo-playback-subtitles:v1', 'virelo-playback-volume:v1', LEVELING_KEY
];
const MEDIA_TEXT = ['path', 'source_path', 'filename', 'title', 'sort_title', 'folder'] as const;
const MEDIA_NULL_TEXT = ['series_title', 'video_codec', 'audio_codec', 'container', 'overview', 'genres', 'external_id'] as const;
const MEDIA_NULL_NUMBER = ['season', 'episode', 'year', 'duration', 'width', 'height'] as const;
const MEDIA_NUMBER = ['id', 'library_id', 'size', 'mtime', 'added_at', 'updated_at'] as const;
const MEDIA_OPTIONAL = ['metadata_blocked', 'metadata_revision', 'progress_position', 'progress_updated_at', 'progress_duration', 'progress_completed', 'liked'] as const;

function check(value: unknown): asserts value { if (!value) throw new Error(INVALID); }
function record(value: unknown, allowed?: readonly string[]): Record<string, unknown> {
  check(value && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
  const row = value as Record<string, unknown>;
  check(Object.keys(row).every(key => key !== '__proto__' && key !== 'constructor' && key !== 'prototype' && (!allowed || allowed.includes(key))));
  return row;
}
function text(value: unknown, limit = 4096): string {
  check(typeof value === 'string' && value.length <= limit && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
  return value;
}
function number(value: unknown, integer = false, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum && (!integer || Number.isSafeInteger(value)));
  return value;
}
function path(value: unknown, empty = false): string {
  const result = libraryFolder(text(value));
  // These are literal handle-relative names, not URLs: do not decode percent signs or expand '~'.
  check((empty || result.length > 0) && !/^(?:[a-z]:\/|(?:blob|file|https?):)/i.test(result));
  return result;
}
function rows(value: unknown, maximum: number): unknown[] {
  check(Array.isArray(value) && value.length <= maximum && Object.keys(value).length === value.length);
  for (let index = 0; index < value.length; index++) check(Object.hasOwn(value, index));
  return value;
}
function unique<T extends { id: number }>(items: T[]): T[] {
  check(new Set(items.map(item => item.id)).size === items.length);
  return items;
}
function settings(value: unknown): Settings {
  const row = record(value, ['audioAnalysisEnabled', 'shortsIncludeLandscapes', 'queueBehavior']);
  check(typeof row.audioAnalysisEnabled === 'boolean' && typeof row.shortsIncludeLandscapes === 'boolean'
    && ['auto', 'loop', 'manual'].includes(row.queueBehavior as string));
  return { audioAnalysisEnabled: row.audioAnalysisEnabled, shortsIncludeLandscapes: row.shortsIncludeLandscapes, queueBehavior: row.queueBehavior as Settings['queueBehavior'] };
}
function trackKey(value: unknown): void {
  const tuple = rows(JSON.parse(text(value, 2048)), 6);
  check(tuple.length === 6);
  [0, 1, 2, 4].forEach(index => text(tuple[index], 1024));
  if (tuple[3] !== null) number(tuple[3], true, 0, 1024);
  check(typeof tuple[5] === 'boolean');
}
function preference(key: string, value: unknown): string {
  const raw = text(value, 65536);
  switch (key) {
    case 'virelo.appearance.v1': {
      const parsed: unknown = JSON.parse(raw);
      check(isAppearance(parsed));
      return JSON.stringify(normalizeAppearance(parsed));
    }
    case LANGUAGE_KEY: check(isLocale(raw)); break;
    case 'virelo.library-layout': check(['grid', 'explorer'].includes(raw)); break;
    case 'virelo.queue-layout': check(['horizontal', 'vertical'].includes(raw)); break;
    case 'virelo.explorer-width': number(Number(raw), false, 160, 720); break;
    case PLAYBACK_SPEED_KEY: check(PLAYBACK_SPEEDS.some(speed => String(speed) === raw)); break;
    case 'virelo-playback-quality:v1': check(raw === 'auto' || raw === 'source' || /^\d+$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) > 0); break;
    case LEVELING_KEY: check(raw === 'true' || raw === 'false'); break;
    case 'virelo-playback-volume:v1': {
      const saved = record(JSON.parse(raw), ['volume', 'muted']);
      number(saved.volume, false, 0, 1); check(typeof saved.muted === 'boolean');
      return JSON.stringify(saved);
    }
    case 'virelo-playback-audio:v1':
    case 'virelo-playback-subtitles:v1': {
      const saved = record(JSON.parse(raw), ['configuration', 'selection']);
      const configuration = rows(JSON.parse(text(saved.configuration, 32768)), 256);
      configuration.forEach(trackKey);
      if (saved.selection === null) check(key === 'virelo-playback-subtitles:v1');
      else { trackKey(saved.selection); check(configuration.includes(saved.selection)); }
      return JSON.stringify(saved);
    }
    default: throw new Error(INVALID);
  }
  return raw;
}
function preferences(value: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(record(value, PREFERENCE_KEYS)).map(([key, value]) => [key, preference(key, value)]));
}
function library(value: unknown): BackupLibrary {
  const row = record(value, ['id', 'label', 'path', 'created_at', 'persistent', 'folderLabels']);
  const labels = record(row.folderLabels);
  check(Object.keys(labels).length <= 10000 && row.persistent === false);
  const folderLabels = Object.fromEntries(Object.entries(labels).map(([key, value]) => [path(key), libraryName(value)]));
  const root = path(row.path); check(!root.includes('/'));
  return { id: number(row.id, true, 1), label: libraryName(row.label), path: root, created_at: number(row.created_at), persistent: false, folderLabels };
}
function media(value: unknown): BackupMedia {
  const row = record(value, [...MEDIA_TEXT, ...MEDIA_NULL_TEXT, ...MEDIA_NULL_NUMBER, ...MEDIA_NUMBER, ...MEDIA_OPTIONAL, 'kind', 'audio_loudness']);
  const result: Record<string, unknown> = {};
  MEDIA_TEXT.forEach(key => { result[key] = text(row[key]); });
  MEDIA_NULL_TEXT.forEach(key => { result[key] = row[key] === null ? null : text(row[key], key === 'overview' || key === 'genres' ? 65536 : 4096); });
  MEDIA_NULL_NUMBER.forEach(key => { result[key] = row[key] === null ? null : number(row[key], key !== 'duration'); });
  MEDIA_NUMBER.forEach(key => { result[key] = number(row[key], key === 'id' || key === 'library_id' || key === 'size', key === 'id' || key === 'library_id' ? 1 : 0); });
  MEDIA_OPTIONAL.forEach(key => {
    if (Object.hasOwn(row, key)) result[key] = number(row[key], !['progress_position', 'progress_duration', 'progress_updated_at'].includes(key));
  });
  for (const key of ['metadata_blocked', 'progress_completed', 'liked']) check(result[key] === undefined || result[key] === 0 || result[key] === 1);
  const source = path(row.source_path), slash = source.lastIndexOf('/');
  check(path(row.path) === source && path(row.filename) === source.slice(slash + 1) && path(row.folder, true) === (slash < 0 ? '' : source.slice(0, slash)));
  let hash = 2166136261;
  const identity = `${row.library_id}:${source}`;
  for (let index = 0; index < identity.length; index++) hash = Math.imul(hash ^ identity.charCodeAt(index), 16777619);
  check(row.id === ((hash >>> 0) || 1) && ['movie', 'series', 'video'].includes(row.kind as string));
  result.kind = row.kind;
  if (Object.hasOwn(row, 'audio_loudness')) {
    result.audio_loudness = row.audio_loudness;
    if (row.audio_loudness !== null) {
      const analysis = readAudioAnalysis(text(row.audio_loudness, 65536), Number(row.size), Number(row.mtime));
      check(analysis); record(analysis, ['version', 'size', 'mtime', 'defaultAudioStream', 'tracks']);
      analysis.tracks.forEach(track => {
        record(track, ['index', 'loudness']);
        if (track.loudness !== null) record(track.loudness, ['integratedLufs', 'truePeakDb']);
      });
    }
  }
  return result as unknown as BackupMedia;
}
function playlist(value: unknown): StoredPlaylist {
  const row = record(value, ['id', 'name', 'revision', 'mediaIds', 'createdAt', 'updatedAt']);
  const mediaIds = playlistIds(row.mediaIds);
  check(mediaIds.length === (row.mediaIds as unknown[]).length && mediaIds.every(id => id <= 0xffffffff));
  return { id: number(row.id, true, 1), name: playlistName(row.name), revision: playlistRevision(row.revision), mediaIds,
    createdAt: number(row.createdAt), updatedAt: number(row.updatedAt) };
}
function validate(value: unknown): BrowserBackup {
  try {
    const row = record(value, ['format', 'version', 'kind', 'createdAt', 'settings', 'preferences', 'libraries', 'media', 'playlists']);
    check(row.format === 'virelo-browser-backup');
    if (row.version !== 1) throw new Error('This backup version is not supported.');
    check(row.kind === 'settings' || row.kind === 'library');
    const libraries = unique(rows(row.libraries, 1000).map(library));
    const items = unique(rows(row.media, 100000).map(media));
    const playlists = unique(rows(row.playlists, 1000).map(playlist));
    const libraryIds = new Set(libraries.map(item => item.id));
    check(items.every(item => libraryIds.has(item.library_id)));
    // Missing playlist videos are intentional: reconnect may make these IDs available again.
    check(row.kind === 'library' || !libraries.length && !items.length && !playlists.length);
    return { format: 'virelo-browser-backup', version: 1, kind: row.kind, createdAt: number(row.createdAt),
      settings: settings(row.settings), preferences: preferences(row.preferences), libraries, media: items, playlists };
  } catch (error) {
    if (error instanceof Error && error.message === 'This backup version is not supported.') throw error;
    throw new Error(INVALID);
  }
}

function readPreferences(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    for (const key of PREFERENCE_KEYS) {
      let value = localStorage.getItem(key);
      if (key === LANGUAGE_KEY && !isLocale(value)) value = localStorage.getItem('virelo-public-locale:v1');
      if (key === 'virelo-playback-quality:v1' && value === null) value = localStorage.getItem('virelo-playback-quality');
      if (value !== null) result[key] = value;
    }
  } catch { throw new Error('Could not read browser preferences. Allow browser storage and try again.'); }
  return result;
}

export async function exportBrowserData(kind: BackupKind): Promise<Blob> {
  check(kind === 'settings' || kind === 'library');
  const db = await openDatabase();
  const snapshot = await new Promise<BrowserBackup>((resolve, reject) => {
    const tx = db.transaction(kind === 'library' ? [...STORES, 'settings'] : ['settings'], 'readonly');
    const current = tx.objectStore('settings').get('current');
    const requests = kind === 'library' ? STORES.map(name => tx.objectStore(name).getAll()) : [];
    tx.onabort = () => reject(new Error('Could not read browser data. Please try again.'));
    tx.oncomplete = () => {
      try {
        const [libraries = [], items = [], playlists = []] = requests.map(request => request.result as Record<string, unknown>[]);
        const stored = current.result as Partial<Settings> | undefined;
        resolve(validate({ format: 'virelo-browser-backup', version: 1, kind, createdAt: Date.now(),
          settings: { audioAnalysisEnabled: stored?.audioAnalysisEnabled ?? false, shortsIncludeLandscapes: stored?.shortsIncludeLandscapes ?? false, queueBehavior: stored?.queueBehavior ?? 'auto' },
          preferences: readPreferences(),
          libraries: libraries.map(row => ({ id: row.id, label: row.label, path: row.path, created_at: row.created_at, persistent: false, folderLabels: row.folderLabels ?? {} })),
          media: items.map(row => Object.fromEntries([...MEDIA_TEXT, ...MEDIA_NULL_TEXT, ...MEDIA_NULL_NUMBER, ...MEDIA_NUMBER, ...MEDIA_OPTIONAL, 'kind', 'audio_loudness']
            .filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]]))),
          playlists: playlists.map(row => ({ id: row.id, name: row.name, revision: row.revision, mediaIds: row.mediaIds, createdAt: row.createdAt, updatedAt: row.updatedAt })) }));
      } catch (error) { reject(error); }
    };
  }).finally(() => db.close());
  const blob = new Blob([JSON.stringify(snapshot)], { type: 'application/json' });
  if (blob.size > MAX_BYTES) throw new Error(TOO_LARGE);
  return blob;
}

export async function readBrowserBackup(file: Blob): Promise<BrowserBackup> {
  if (file.size > MAX_BYTES) throw new Error(TOO_LARGE);
  let parsed: unknown;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error('Could not read the backup JSON file.'); }
  return validate(parsed);
}

export function backupSummary(value: BrowserBackup): { kind: BackupKind; libraries: number; videos: number; playlists: number } {
  return { kind: value.kind, libraries: value.libraries.length, videos: value.media.length, playlists: value.playlists.length };
}

export async function hasBrowserData(): Promise<boolean> {
  const db = await openDatabase();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction([...STORES, 'settings'], 'readonly');
    const counts = STORES.map(name => tx.objectStore(name).count());
    const current = tx.objectStore('settings').get('current');
    tx.oncomplete = () => {
      try {
        resolve(counts.some(request => request.result > 0) || current.result !== undefined
          || PREFERENCE_KEYS.some(key => key !== LANGUAGE_KEY && localStorage.getItem(key) !== null)
          || localStorage.getItem('virelo-playback-quality') !== null);
      } catch { reject(new Error('Could not read browser preferences. Allow browser storage and try again.')); }
    };
    tx.onabort = () => reject(new Error('Could not read browser data. Please try again.'));
  }).finally(() => db.close());
}

export async function importBrowserBackup(value: BrowserBackup): Promise<{ preferencesRestored: boolean }> {
  // Revalidate and copy: callers may have edited the preview before confirming import.
  const backup = validate(value);
  if (new Blob([JSON.stringify(backup)]).size > MAX_BYTES) throw new Error(TOO_LARGE);
  const restore = async () => {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(backup.kind === 'library' ? [...STORES, 'settings'] : ['settings'], 'readwrite');
      let failure: Error | undefined;
      const save = () => {
        try {
          backup.libraries.forEach(row => tx.objectStore('libraries').add(row));
          backup.media.forEach(row => tx.objectStore('media').add({ ...row, thumbnail_path: null, poster_path: null, backdrop_path: null }));
          backup.playlists.forEach(row => tx.objectStore('playlists').add(row));
          tx.objectStore('settings').put(backup.settings, 'current');
        } catch { tx.abort(); }
      };
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(failure ?? new Error('Could not import browser data. No browser database data was changed.'));
      if (backup.kind === 'settings') save();
      else {
        let pending = STORES.length;
        const counts = STORES.map(name => tx.objectStore(name).count());
        counts.forEach(request => { request.onsuccess = () => {
          if (--pending) return;
          if (counts.some(count => count.result > 0)) { failure = new Error(NOT_EMPTY); tx.abort(); }
          else save();
        }; });
      }
    }).finally(() => db.close());
  };
  // Folder registration allocates IDs across several transactions; share its edit lock.
  await (backup.kind === 'library' ? editLibraries(restore) : restore());
  // IDB has committed; localStorage is separate and may partially fail. Never claim rollback.
  let preferencesRestored = true;
  for (const [key, value] of Object.entries(backup.preferences)) {
    try { localStorage.setItem(key, value); }
    catch { preferencesRestored = false; }
  }
  return { preferencesRestored };
}
