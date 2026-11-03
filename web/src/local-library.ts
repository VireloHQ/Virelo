import type { BrowserCapabilities, Library, MediaItem, ScanStatus, Settings } from './types';
import { probeVideo, THUMBNAIL_VERSION, validThumbnail } from './utils/video-thumbnail';
import { libraryName, libraryFolder } from './utils/library-names';
import { readAudioAnalysis } from './utils/volume-leveling';
import { AVI_MAX_FILE_BYTES } from './utils/avi';

const DB_NAME = 'virelo-web';
const DB_VERSION = 2;
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mkv', 'webm', 'mov', 'avi', 'wmv', 'mpg', 'mpeg', 'ts', 'm2ts', 'flv', 'ogv', '3gp']);

type PermissionMode = { mode: 'read' };
type PermissionCapableHandle = FileSystemDirectoryHandle & {
  queryPermission?: (descriptor?: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (descriptor?: PermissionMode) => Promise<PermissionState>;
};

interface StoredLibrary {
  id: number;
  label: string;
  path: string;
  created_at: number;
  persistent: boolean;
  handle?: FileSystemDirectoryHandle;
  folderLabels?: Record<string,string>;
}

interface StoredMedia extends MediaItem {
  source_path: string;
}

interface LocalFile {
  file: File;
  relativePath: string;
}

interface StoredThumbnail { id: number; blob: Blob | null; version?: number; size?: number; mtime?: number; }

const DEFAULT_SETTINGS: Settings = {
  audioAnalysisEnabled: false,
  shortsIncludeLandscapes: false,
  queueBehavior: 'auto'
};

const sessionFiles = new Map<number, File>();
const sessionLibraries = new Map<number, LocalFile[]>();
const sessionHandles = new Map<number, FileSystemDirectoryHandle>();
const mediaUrls = new Map<number, string>();
const thumbnailUrls = new Map<number, string>();
const thumbnailTasks = new Map<number, Promise<string | null>>();
const thumbnailQueue: Array<() => void> = [];
let activeThumbnails = 0;
const knownLibraries = new Map<number, StoredLibrary>();
let scanTask: Promise<void> | null = null;
let scanStatus: ScanStatus = idleScanStatus();
let libraryEdit:Promise<unknown>=Promise.resolve();
let audioRun: { controller: AbortController; status: ScanStatus } | null = null;
const audioChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('virelo-audio-analysis');
audioChannel?.addEventListener('message', () => cancelAudioAnalysis());

function finishScan(status: ScanStatus) {
  status.running = false;
  status.finishedAt = Date.now();
  status.message = status.errors ? `Scan complete · ${status.errors} unavailable` : 'Scan complete';
}

function cancelAudioAnalysis(notify = false) {
  if (audioRun) {
    audioRun.controller.abort();
    finishScan(audioRun.status);
    audioRun = null;
  }
  if (notify) audioChannel?.postMessage('cancel');
}

function startAudioAnalysis(status: ScanStatus) {
  const run = { controller: new AbortController(), status };
  audioRun = run;
  const signal = run.controller.signal;
  const current = () => audioRun === run && !signal.aborted && scanStatus === status;
  const sweep = async () => {
    if (!current() || !(await readSettings()).audioAnalysisEnabled) return;
    const media = (await listStoredMedia()).filter(item => {
      const file = sessionFiles.get(item.id);
      return file && file.size === item.size && file.lastModified === item.mtime && !readAudioAnalysis(item.audio_loudness, item.size, item.mtime);
    });
    if (!current() || !media.length) return;
    status.audioTotal = media.length;
    status.audioAnalyzed = 0;
    let analyzer: import('./browser-audio-analysis').BrowserAudioAnalyzer | undefined;
    try {
      for (const item of media) {
        if (!current()) break;
        const file = sessionFiles.get(item.id)!;
        status.message = `Analyzing audio · ${item.filename}`;
        // Reject oversized sources before importing the analyzer or downloading its worker/core.
        if (file.size >= AVI_MAX_FILE_BYTES) { status.errors++; status.audioAnalyzed!++; continue; }
        try {
          if (!analyzer) {
            const { BrowserAudioAnalyzer } = await import('./browser-audio-analysis');
            if (!current()) break;
            analyzer = new BrowserAudioAnalyzer();
          }
          const analysis = await analyzer.analyze(file, signal);
          if (!current()) break;
          await saveAudioAnalysis(item, file, JSON.stringify(analysis), current);
        } catch {
          if (!current()) break;
          // Leave failures uncached so another scan can retry; playback retains its live fallback.
          status.errors++;
        }
        status.audioAnalyzed!++;
      }
    } finally { analyzer?.dispose(); }
  };
  void (async () => {
    // One full-file worker across tabs as well as within this page; never share the AVI engine.
    if (navigator.locks) await navigator.locks.request('virelo-audio-analysis', { signal }, sweep);
    else await sweep();
  })().catch(() => { if (current()) status.errors++; }).finally(() => {
    if (current()) { finishScan(status); audioRun = null; }
  });
}

async function saveAudioAnalysis(snapshot: StoredMedia, file: File, value: string, current: () => boolean) {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['media', 'settings', 'libraries'], 'readwrite');
    const store = tx.objectStore('media');
    const settings = tx.objectStore('settings').get('current');
    const library = tx.objectStore('libraries').get(snapshot.library_id);
    const request = store.get(snapshot.id);
    request.onsuccess = () => {
      const item = request.result as StoredMedia | undefined;
      if (!current() || !settings.result?.audioAnalysisEnabled || !library.result || !item
        || item.library_id !== snapshot.library_id || item.source_path !== snapshot.source_path
        || item.size !== file.size || item.mtime !== file.lastModified || sessionFiles.get(item.id) !== file) return;
      // Merge the latest row, never the pre-analysis snapshot (progress/likes/renames may have changed).
      store.put({ ...item, audio_loudness: value });
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('Audio analysis could not be saved.'));
    tx.onerror = () => reject(tx.error);
  }).finally(() => db.close());
}

function editLibraries<T>(operation:()=>Promise<T>):Promise<T> {
  const run=()=>navigator.locks?navigator.locks.request('virelo-library-edit',operation):operation();
  const task=libraryEdit.then(run,run);
  libraryEdit=task.catch(()=>{});
  return task;
}

async function matchingLibrary(libraries:StoredLibrary[],name:string,handle?:FileSystemDirectoryHandle,exceptId?:number) {
  for(const library of libraries) {
    if(library.id===exceptId)continue;
    const existing=library.handle??sessionHandles.get(library.id);
    if(handle&&existing) {
      if(handle===existing||await handle.isSameEntry(existing))return library;
    } else if(library.path===name) {
      throw new Error(`A folder named "${name}" is already registered. Reconnect it in Settings. This selection method cannot distinguish folders with the same name.`);
    }
  }
}

async function storeHandle(library:StoredLibrary,handle:FileSystemDirectoryHandle) {
  let stored:StoredLibrary={...library,persistent:true,handle};
  try { await writeStore('libraries',stored);sessionHandles.delete(library.id); }
  catch {
    stored={...stored,persistent:false};delete stored.handle;
    await writeStore('libraries',stored);
    sessionHandles.set(library.id,handle);
  }
  sessionLibraries.delete(library.id);
  return stored;
}

function idleScanStatus(): ScanStatus {
  return { running: false, startedAt: null, finishedAt: null, total: 0, scanned: 0, added: 0, updated: 0, skipped: 0, errors: 0, message: 'Ready' };
}

export function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error('Could not open browser storage.'));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('libraries')) db.createObjectStore('libraries', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('playlists')) db.createObjectStore('playlists', { keyPath: 'id', autoIncrement: true });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}

async function readStore<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).get(key);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T | undefined);
  }).finally(() => db.close());
}

async function readAll<T>(storeName: string): Promise<T[]> {
  const db = await openDatabase();
  return new Promise<T[]>((resolve, reject) => {
    const request = db.transaction(storeName, 'readonly').objectStore(storeName).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as T[]);
  }).finally(() => db.close());
}

async function writeStore(storeName: string, value: unknown, key?: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    if (key === undefined) store.put(value); else store.put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

async function deleteStore(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

function pickerAvailable() {
  return typeof (window as Window & { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

async function permissionState(library: StoredLibrary) {
  const directoryHandle = library.handle ?? sessionHandles.get(library.id);
  if (!directoryHandle) return sessionLibraries.has(library.id) ? 'granted' : 'prompt';
  const handle = directoryHandle as PermissionCapableHandle;
  if (!handle.queryPermission) return 'granted';
  return handle.queryPermission({ mode: 'read' });
}

async function requestLibraryPermission(library: StoredLibrary) {
  const directoryHandle = library.handle ?? sessionHandles.get(library.id);
  if (!directoryHandle) return sessionLibraries.has(library.id);
  const handle = directoryHandle as PermissionCapableHandle;
  if (!handle.queryPermission || await handle.queryPermission({ mode: 'read' }) === 'granted') return true;
  return Boolean(handle.requestPermission && await handle.requestPermission({ mode: 'read' }) === 'granted');
}

function nextLibraryId(libraries: StoredLibrary[]) {
  return Math.max(0, ...libraries.map((library) => library.id)) + 1;
}

async function chooseDirectory() {
  const picker = (window as Window & { showDirectoryPicker?: (options?: { mode?: 'read' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) return null;
  return picker({ mode: 'read' });
}

function chooseFallbackFiles(): Promise<LocalFile[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input') as HTMLInputElement & { webkitdirectory: boolean };
    input.type = 'file';
    input.multiple = true;
    input.accept = [...VIDEO_EXTENSIONS].map((extension) => `.${extension}`).join(',');
    input.webkitdirectory = true;
    input.addEventListener('change', () => {
      const files = [...(input.files ?? [])]
        .filter(isVideoFile)
        .map((file) => ({ file, relativePath: normalizeFallbackPath(file.webkitRelativePath || file.name) }));
      if (files.length) resolve(files); else reject(new Error('No supported video files were selected.'));
    }, { once: true });
    input.addEventListener('cancel', () => reject(new DOMException('Folder selection was cancelled.', 'AbortError')), { once: true });
    input.click();
  });
}

function normalizeFallbackPath(path: string) {
  const parts = path.replaceAll('\\', '/').split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(1).join('/') : parts[0] ?? path;
}

export async function addLocalLibrary(): Promise<Library> {
  const direct=pickerAvailable();
  const selection = direct ? chooseDirectory() : chooseFallbackFiles();
  const selected = await selection;
  return editLibraries(async()=>{
    const libraries = await readAll<StoredLibrary>('libraries');
    const id = nextLibraryId(libraries);
    let stored: StoredLibrary;
    if (direct) {
      const handle = selected as FileSystemDirectoryHandle | null;
      if (!handle) throw new Error('Folder selection is not available in this browser.');
      const existing=await matchingLibrary(libraries,handle.name,handle);
      stored=await storeHandle(existing??{id,label:handle.name,path:handle.name,created_at:Date.now(),persistent:true},handle);
    } else {
      const files = selected as LocalFile[];
      const firstOriginalPath = files[0]?.file.webkitRelativePath.replaceAll('\\', '/');
      const label = firstOriginalPath?.split('/')[0] || 'Selected videos';
      await matchingLibrary(libraries,label);
      stored = { id, label, path: label, created_at: Date.now(), persistent: false };
      await writeStore('libraries', stored);
      sessionLibraries.set(id, files);
    }
    knownLibraries.set(stored.id, stored);
    await runScan([stored.id], true);
    return toLibrary(stored, true);
  });
}

export async function reconnectLocalLibrary(id: number): Promise<Library> {
  let library = knownLibraries.get(id) ?? await readStore<StoredLibrary>('libraries', id);
  if (!library) throw new Error('Library not found.');
  const existingHandle = library.handle ?? sessionHandles.get(id);
  if (existingHandle) {
    const capable = existingHandle as PermissionCapableHandle;
    const connected = capable.requestPermission
      ? await capable.requestPermission({ mode: 'read' }) === 'granted'
      : await requestLibraryPermission(library);
    if (!connected) throw new Error('Folder access was not granted.');
    return editLibraries(async()=>{
      const current=await readStore<StoredLibrary>('libraries',id);
      if(!current)throw new Error('Library not found.');
      await runScan([id], true);
      return toLibrary(current,true);
    });
  }
  if (pickerAvailable()) {
    const handle = await chooseDirectory();
    if (!handle) throw new Error('Folder selection is not available in this browser.');
    return editLibraries(async()=>{
      const libraries=await readAll<StoredLibrary>('libraries'),current=libraries.find(item=>item.id===id);
      if(!current)throw new Error('Library not found.');
      const duplicate=await matchingLibrary(libraries,handle.name,handle,id);
      if(duplicate)throw new Error(`This folder is already registered as "${duplicate.label}". Reconnect that library instead.`);
      library=await storeHandle({...current,label:current.label===current.path?handle.name:current.label,path:handle.name},handle);
      knownLibraries.set(id, library);
      await runScan([id], true);
      return toLibrary(library, true);
    });
  }
  const files = await chooseFallbackFiles();
  const firstOriginalPath = files[0]?.file.webkitRelativePath.replaceAll('\\', '/');
  const label = firstOriginalPath?.split('/')[0] || library.label;
  return editLibraries(async()=>{
    const libraries=await readAll<StoredLibrary>('libraries'),current=libraries.find(item=>item.id===id);
    if(!current)throw new Error('Library not found.');
    await matchingLibrary(libraries,label,undefined,id);
    library = { ...current, label:current.label===current.path?label:current.label, path: label, persistent: false };
    await writeStore('libraries', library);
    sessionLibraries.set(id, files);
    knownLibraries.set(id, library);
    await runScan([id], true);
    return toLibrary(library, true);
  });
}

export async function renameLocalLibrary(id:number, value:unknown, path:unknown=''):Promise<Library> {
  const label=libraryName(value),folder=libraryFolder(path);
  return editLibraries(async()=>{
    const library=await readStore<StoredLibrary>('libraries',id);
    if(!library)throw new Error('Library not found.');
    if(folder&&!(await listStoredMedia()).some(item=>item.library_id===id&&(item.folder===folder||item.folder.startsWith(folder+'/'))))
      throw new Error('Folder not found.');
    const updated=folder?{...library,folderLabels:{...library.folderLabels,[folder]:label}}:{...library,label};
    await writeStore('libraries',updated);
    knownLibraries.set(id,updated);
    return toLibrary(updated,await permissionState(updated)==='granted');
  });
}

export async function removeLocalLibrary(id: number) {
  cancelAudioAnalysis(true);
  return editLibraries(async()=>{
    cancelAudioAnalysis(true);
    const media = (await readAll<StoredMedia>('media')).filter((item) => item.library_id === id);
    await Promise.all(media.flatMap((item) => [deleteStore('media', item.id), deleteStore('thumbnails', item.id)]));
    await deleteStore('libraries', id);
    sessionLibraries.delete(id);
    sessionHandles.delete(id);
    knownLibraries.delete(id);
    for (const item of media) releaseMediaUrls(item.id, true);
  });
}

export async function listLocalLibraries(): Promise<Library[]> {
  const libraries = await readAll<StoredLibrary>('libraries');
  knownLibraries.clear();
  for (const library of libraries) knownLibraries.set(library.id, library);
  return Promise.all(libraries.sort((a, b) => a.created_at - b.created_at).map(async (library) => toLibrary(library, await permissionState(library) === 'granted')));
}

function toLibrary(library: StoredLibrary, connected: boolean): Library {
  return { id: library.id, label: library.label, path: library.path, created_at: library.created_at, persistent: library.persistent, connected, folderLabels:library.folderLabels??{} };
}

export async function startLocalScan() {
  if (scanTask || scanStatus.running) return false;
  scanTask = editLibraries(() => runScan(undefined, false)).catch(() => {
    scanStatus.errors++;
    finishScan(scanStatus);
  }).finally(() => { scanTask = null; });
  return true;
}

export function getLocalScanStatus() {
  return { ...scanStatus };
}

async function runScan(libraryIds?: number[], requestPermission = false) {
  cancelAudioAnalysis(true);
  const libraries = (await readAll<StoredLibrary>('libraries')).filter((library) => !libraryIds || libraryIds.includes(library.id));
  scanStatus = { running: true, startedAt: Date.now(), finishedAt: null, total: 0, scanned: 0, added: 0, updated: 0, skipped: 0, errors: 0, message: 'Reading folders…' };
  try {
    for (const library of libraries) await scanLibrary(library, requestPermission);
  } catch (error) {
    finishScan(scanStatus);
    throw error;
  }
  // Adding/reconnecting waits only for baseline metadata and thumbnails, never for loudness.
  startAudioAnalysis(scanStatus);
}

async function scanLibrary(library: StoredLibrary, allowPermissionRequest: boolean) {
  scanStatus.message = `Scanning ${library.label}`;
  let files: LocalFile[];
  try {
    const directoryHandle = library.handle ?? sessionHandles.get(library.id);
    if (directoryHandle) {
      const connected = allowPermissionRequest ? await requestLibraryPermission(library) : await permissionState(library) === 'granted';
      if (!connected) throw new Error('Folder access needs to be restored.');
      files = await collectHandleFiles(directoryHandle);
    } else {
      files = sessionLibraries.get(library.id) ?? [];
      if (!files.length) throw new Error('Choose the folder again to refresh this library.');
    }
  } catch {
    scanStatus.errors++;
    scanStatus.message = `${library.label} needs access`;
    return;
  }

  scanStatus.total += files.length;
  const existing = (await readAll<StoredMedia>('media')).filter((item) => item.library_id === library.id);
  const previousByPath = new Map(existing.map((item) => [item.source_path, item]));
  const foundIds = new Set<number>();

  await mapLimit(files, 2, async ({ file, relativePath }) => {
    const id = stableId(`${library.id}:${relativePath}`);
    foundIds.add(id);
    sessionFiles.set(id, file);
    const previous = previousByPath.get(relativePath);
    scanStatus.scanned++;
    if (previous && previous.size === file.size && previous.mtime === file.lastModified) {
      // An unchanged file may still have a missing/black thumbnail from an older scan.
      await ensureLocalThumbnail(id, true);
      scanStatus.skipped++;
      return;
    }
    try {
      const parsed = parseMediaName(relativePath);
      const probe = await probeVideo(file);
      const item: StoredMedia = {
        audio_loudness: null,
        id,
        library_id: library.id,
        source_path: relativePath,
        path: relativePath,
        filename: file.name,
        title: previous?.title || parsed.title,
        sort_title: (previous?.title || parsed.title).toLocaleLowerCase(),
        kind: parsed.kind,
        series_title: parsed.seriesTitle,
        season: parsed.season,
        episode: parsed.episode,
        year: parsed.year,
        duration: probe.duration ?? previous?.duration ?? null,
        width: probe.width ?? previous?.width ?? null,
        height: probe.height ?? previous?.height ?? null,
        video_codec: null,
        audio_codec: null,
        container: extensionOf(file.name),
        folder: relativePath.includes('/') ? relativePath.slice(0, relativePath.lastIndexOf('/')) : '',
        size: file.size,
        mtime: file.lastModified,
        thumbnail_path: probe.thumbnail ? 'browser' : previous?.thumbnail_path ?? null,
        poster_path: null,
        backdrop_path: null,
        overview: null,
        genres: null,
        external_id: null,
        added_at: previous?.added_at ?? Date.now(),
        updated_at: Date.now(),
        progress_position: previous?.progress_position ?? 0,
        progress_duration: previous?.progress_duration ?? probe.duration ?? 0,
        progress_completed: previous?.progress_completed ?? 0,
        liked: previous?.liked ?? 0
      };
      await writeStore('media', item);
      await writeStore('thumbnails', { id, blob: probe.thumbnail, version: THUMBNAIL_VERSION, size: file.size, mtime: file.lastModified });
      releaseMediaUrls(id);
      window.dispatchEvent(new CustomEvent('virelo-thumbnail-updated', { detail: { id, url: await localThumbnailUrl(id) } }));
      if (previous) scanStatus.updated++; else scanStatus.added++;
    } catch {
      scanStatus.errors++;
    }
  });

  for (const item of existing) {
    if (foundIds.has(item.id)) continue;
    await Promise.all([deleteStore('media', item.id), deleteStore('thumbnails', item.id)]);
    releaseMediaUrls(item.id, true);
  }
}

async function collectHandleFiles(root: FileSystemDirectoryHandle) {
  const found: LocalFile[] = [];
  const visit = async (directory: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
    const values = (directory as FileSystemDirectoryHandle & { values: () => AsyncIterableIterator<FileSystemHandle> }).values();
    for await (const entry of values) {
      if (entry.name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.kind === 'directory') await visit(entry as FileSystemDirectoryHandle, path);
      else {
        const file = await (entry as FileSystemFileHandle).getFile();
        if (isVideoFile(file)) found.push({ file, relativePath: path });
      }
    }
  };
  await visit(root, '');
  return found;
}

function isVideoFile(file: File) {
  return VIDEO_EXTENSIONS.has(extensionOf(file.name));
}

function extensionOf(name: string) {
  const index = name.lastIndexOf('.');
  return index >= 0 ? name.slice(index + 1).toLocaleLowerCase() : '';
}


function cleanName(value: string) {
  return value.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').replace(/\b(2160p|1080p|720p|480p|web[- ]?dl|bluray|brrip|webrip|hdr|x264|x265|h264|h265|hevc|aac|dts)\b/gi, '').replace(/\s+/g, ' ').trim();
}

function parseMediaName(path: string) {
  const filename = path.split('/').at(-1) ?? path;
  const stem = filename.replace(/\.[^.]+$/, '');
  const episode = stem.match(/(?:^|[ ._-])S(\d{1,2})E(\d{1,3})(?:$|[ ._-])/i) || stem.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:$|[ ._-])/i);
  const yearMatch = stem.match(/(?:^|[ ._(-])((?:19|20)\d{2})(?:$|[ ._)-])/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (episode) {
    const marker = episode.index ?? 0;
    const parent = path.split('/').at(-2) ?? '';
    const seriesTitle = cleanName(stem.slice(0, marker)) || cleanName(parent) || 'Series';
    return { title: `${seriesTitle} · S${String(Number(episode[1])).padStart(2, '0')}E${String(Number(episode[2])).padStart(2, '0')}`, kind: 'series' as const, seriesTitle, season: Number(episode[1]), episode: Number(episode[2]), year };
  }
  const title = cleanName(yearMatch ? stem.replace(yearMatch[1], '') : stem).replace(/[()[\]-]+$/g, '').trim() || stem;
  return { title, kind: 'movie' as const, seriesTitle: null, season: null, episode: null, year };
}

function stableId(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}

async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  let index = 0;
  const run = async () => {
    while (index < items.length) {
      const current = index++;
      await worker(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length, 1)) }, run));
}

export async function listStoredMedia() {
  return readAll<StoredMedia>('media');
}

export async function getStoredMedia(id: number) {
  return readStore<StoredMedia>('media', id);
}

export async function hydrateMediaIds(ids: number[]): Promise<MediaItem[]> {
  const db = await openDatabase();
  return new Promise<MediaItem[]>((resolve, reject) => {
    const tx = db.transaction(['media', 'thumbnails'], 'readonly'), result: MediaItem[] = [];
    ids.forEach((id, index) => {
      const request = tx.objectStore('media').get(id);
      request.onsuccess = () => {
        const item = request.result as StoredMedia | undefined;
        if (!item) return;
        const assign = (thumbnail: string | null) => { result[index] = { ...item, thumbnail_path: thumbnail }; };
        const cached = thumbnailUrls.get(id);
        if (cached) { assign(cached); return; }
        const thumbnail = tx.objectStore('thumbnails').get(id);
        thumbnail.onsuccess = () => {
          const blob = (thumbnail.result as StoredThumbnail | undefined)?.blob;
          const url = thumbnailUrls.get(id) || (blob ? URL.createObjectURL(blob) : null);
          if (url) thumbnailUrls.set(id, url);
          assign(url);
        };
      };
    });
    tx.oncomplete = () => resolve(result.filter(Boolean));
    tx.onabort = () => reject(tx.error ?? new Error('Could not read playlist videos.'));
  }).finally(() => db.close());
}

export async function saveStoredMedia(item: StoredMedia) {
  await writeStore('media', item);
}

// Read and write in the same transaction: progress, likes and resets must not overwrite each other.
export async function updateStoredMedia(id: number, update: (item: StoredMedia) => void) {
  const db = await openDatabase();
  return new Promise<StoredMedia>((resolve, reject) => {
    const transaction = db.transaction('media', 'readwrite');
    const store = transaction.objectStore('media');
    let result: StoredMedia;
    const request = store.get(id);
    request.onsuccess = () => {
      if (!request.result) { transaction.abort(); return; }
      result = request.result as StoredMedia;
      update(result);
      store.put(result);
    };
    transaction.oncomplete = () => resolve(result);
    transaction.onabort = () => reject(transaction.error ?? new Error('Video not found.'));
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

export async function clearLocalMetadata(id: number) {
  const item = await updateStoredMedia(id, resetMatchedMetadata);
  return hydrateMedia(item);
}

function resetMatchedMetadata(item: StoredMedia) {
  const parsed = parseMediaName(item.source_path || item.filename);
  Object.assign(item, {
    title: parsed.title, sort_title: parsed.title.toLocaleLowerCase(), year: parsed.year,
    overview: null, genres: null, poster_path: null, backdrop_path: null, external_id: null,
    metadata_blocked: 1, metadata_revision: (item.metadata_revision ?? 0) + 1, updated_at: Date.now()
  });
}

export async function clearAllLocalMetadata(): Promise<{cleared:number}> {
  const db = await openDatabase();
  return new Promise<{cleared:number}>((resolve, reject) => {
    const transaction = db.transaction('media', 'readwrite');
    let cleared = 0;
    const request = transaction.objectStore('media').openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const item = cursor.value as StoredMedia;
      resetMatchedMetadata(item);
      cursor.update(item);
      cleared++;
      cursor.continue();
    };
    transaction.oncomplete = () => resolve({cleared});
    transaction.onabort = () => reject(transaction.error ?? new Error('Could not clear metadata.'));
    transaction.onerror = () => reject(transaction.error);
  }).finally(() => db.close());
}

export async function hydrateMedia(item: StoredMedia): Promise<MediaItem> {
  const copy: MediaItem = { ...item };
  copy.thumbnail_path = await localThumbnailUrl(item.id);
  return copy;
}

async function localThumbnailUrl(id: number) {
  const cached = thumbnailUrls.get(id);
  if (cached) return cached;
  const stored = await readStore<StoredThumbnail>('thumbnails', id);
  if (!stored?.blob) return null;
  const existing = thumbnailUrls.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(stored.blob);
  thumbnailUrls.set(id, url);
  return url;
}

export function ensureLocalThumbnail(id: number, retryMissing = false): Promise<string | null> {
  const pending = thumbnailTasks.get(id);
  if (pending) return pending;
  const task = new Promise<string | null>(resolve => {
    const start = () => {
      activeThumbnails++;
      void repairThumbnail(id, retryMissing).then(resolve, () => resolve(null)).finally(() => {
        activeThumbnails--;
        thumbnailTasks.delete(id);
        thumbnailQueue.shift()?.();
      });
    };
    if (activeThumbnails < 2) start(); else thumbnailQueue.push(start);
  });
  thumbnailTasks.set(id, task);
  return task;
}

async function repairThumbnail(id: number, retryMissing: boolean) {
  const item = await getStoredMedia(id);
  if (!item) return null;
  const stored = await readStore<StoredThumbnail>('thumbnails', id);
  const sameFile = stored?.size === item.size && stored?.mtime === item.mtime;
  if (stored?.version === THUMBNAIL_VERSION && sameFile && (stored.blob || !retryMissing)) return localThumbnailUrl(id);
  if (stored?.blob && (sameFile || stored.size === undefined) && await validThumbnail(stored.blob)) {
    await writeStore('thumbnails', { ...stored, version: THUMBNAIL_VERSION, size: item.size, mtime: item.mtime });
    return localThumbnailUrl(id);
  }
  // Do not request permissions or block Home while repairing visible artwork.
  const file = await localMediaFile(id);
  const probe = await probeVideo(file);
  const current = await getStoredMedia(id);
  if (!current || current.size !== file.size || current.mtime !== file.lastModified) return null;
  await writeStore('thumbnails', { id, blob: probe.thumbnail, version: THUMBNAIL_VERSION, size: file.size, mtime: file.lastModified });
  await updateStoredMedia(id, media => {
    media.thumbnail_path = probe.thumbnail ? 'browser' : null;
    media.duration = probe.duration ?? media.duration;
    media.width = probe.width ?? media.width;
    media.height = probe.height ?? media.height;
  });
  const oldUrl = thumbnailUrls.get(id);
  if (oldUrl) URL.revokeObjectURL(oldUrl);
  thumbnailUrls.delete(id);
  const url=await localThumbnailUrl(id);
  window.dispatchEvent(new CustomEvent('virelo-thumbnail-updated',{detail:{id,url}}));
  return url;
}

export async function localMediaFile(id: number) {
  let file = sessionFiles.get(id);
  if (!file) {
    const media = await getStoredMedia(id);
    if (!media) throw new Error('Video not found.');
    const library = await readStore<StoredLibrary>('libraries', media.library_id);
    const directoryHandle = library ? library.handle ?? sessionHandles.get(library.id) : undefined;
    if (!library || !directoryHandle || await permissionState(library) !== 'granted') throw new Error('Open Settings and reconnect this folder.');
    let directory = directoryHandle;
    const parts = media.source_path.split('/').filter(Boolean);
    for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
    file = await (await directory.getFileHandle(parts.at(-1) ?? media.filename)).getFile();
    sessionFiles.set(id, file);
  }
  return file;
}

export async function localMediaUrl(id: number) {
  const cached = mediaUrls.get(id);
  if (cached) return cached;
  const file = await localMediaFile(id);
  const url = URL.createObjectURL(file);
  mediaUrls.set(id, url);
  return url;
}

function releaseMediaUrls(id: number, forgetFile = false) {
  const mediaUrl = mediaUrls.get(id);
  const thumbnailUrl = thumbnailUrls.get(id);
  if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  if (thumbnailUrl) URL.revokeObjectURL(thumbnailUrl);
  mediaUrls.delete(id);
  thumbnailUrls.delete(id);
  if (forgetFile) sessionFiles.delete(id);
}

export async function readSettings() {
  const stored = await readStore<Partial<Settings>>('settings', 'current');
  return {
    audioAnalysisEnabled: stored?.audioAnalysisEnabled === true,
    shortsIncludeLandscapes: stored?.shortsIncludeLandscapes ?? DEFAULT_SETTINGS.shortsIncludeLandscapes,
    queueBehavior: stored?.queueBehavior ?? DEFAULT_SETTINGS.queueBehavior
  };
}

export async function writeSettings(settings: Partial<Settings>) {
  const next = { ...await readSettings(), ...settings };
  next.audioAnalysisEnabled = next.audioAnalysisEnabled === true;
  await writeStore('settings', next, 'current');
  if (!next.audioAnalysisEnabled) cancelAudioAnalysis(true);
  return next;
}

export function browserCapabilities(): BrowserCapabilities {
  return { directoryPicker: pickerAvailable(), secureContext: window.isSecureContext, persistentHandles: pickerAvailable() && window.isSecureContext };
}

window.addEventListener('beforeunload', () => {
  cancelAudioAnalysis();
  audioChannel?.close();
  for (const url of mediaUrls.values()) URL.revokeObjectURL(url);
  for (const url of thumbnailUrls.values()) URL.revokeObjectURL(url);
});
