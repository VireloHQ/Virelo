import type { Appearance } from './utils/appearance';
import { readAppearance, writeAppearance } from './utils/appearance-storage';
import {
  addLocalLibrary,
  renameLocalLibrary,
  browserCapabilities,
  clearLocalMetadata,
  clearAllLocalMetadata,
  getLocalScanStatus,
  getStoredMedia,
  hydrateMedia,
  ensureLocalThumbnail,
  listLocalLibraries,
  listStoredMedia,
  localMediaFile,
  localMediaUrl,
  readSettings,
  reconnectLocalLibrary,
  removeLocalLibrary,
  updateStoredMedia,
  startLocalScan,
  writeSettings
} from './local-library';
import type { FolderEntry, HomeData, MediaItem, Settings, ShortsFeed, SortKey } from './types';
import { buildHome } from '@virelo/core/home-catalog';
import { seriesTitleKey } from '@virelo/core/series-playback';
import { createLocalPlaylist, deleteLocalPlaylist, getLocalPlaylist, listLocalPlaylists, updateLocalPlaylist } from './local-playlists';

async function hydrated(items: Awaited<ReturnType<typeof listStoredMedia>>) {
  return Promise.all(items.map(hydrateMedia));
}

function compare(sort: SortKey) {
  if (sort === 'random') return () => Math.random() - 0.5;
  if (sort === 'newest') return (a: MediaItem, b: MediaItem) => b.mtime - a.mtime;
  if (sort === 'oldest') return (a: MediaItem, b: MediaItem) => a.mtime - b.mtime;
  if (sort === 'year') return (a: MediaItem, b: MediaItem) => (b.year ?? -1) - (a.year ?? -1);
  if (sort === 'duration') return (a: MediaItem, b: MediaItem) => (b.duration ?? -1) - (a.duration ?? -1);
  return (a: MediaItem, b: MediaItem) => a.sort_title.localeCompare(b.sort_title);
}

export const api = {
  appearance: () => Promise.resolve(readAppearance()),
  saveAppearance: (value: Appearance) => Promise.resolve().then(() => writeAppearance(value)),
  playlists: listLocalPlaylists,
  playlist: getLocalPlaylist,
  createPlaylist: createLocalPlaylist,
  updatePlaylist: updateLocalPlaylist,
  deletePlaylist: deleteLocalPlaylist,
  home: async (): Promise<HomeData> => {
    const shelves = buildHome(await listStoredMedia());
    // Resolve thumbnails once per displayed title, not once per item in a large library.
    const selected = [...shelves.recent,...shelves.continueWatching,...shelves.favorites,...shelves.movies,
      ...shelves.series,...shelves.nextEpisodes,...shelves.unwatched,...shelves.quickWatches,...shelves.genres.flatMap(g=>g.items)];
    const hydratedItems = await hydrated([...new Map(selected.map(item=>[item.id,item])).values()]);
    const byId = new Map(hydratedItems.map(item=>[item.id,item]));
    const resolve = (items:MediaItem[]) => items.map(item=>byId.get(item.id)!);
    return {...shelves,recent:resolve(shelves.recent),continueWatching:resolve(shelves.continueWatching),
      favorites:resolve(shelves.favorites),movies:resolve(shelves.movies),series:resolve(shelves.series),
      nextEpisodes:resolve(shelves.nextEpisodes),unwatched:resolve(shelves.unwatched),quickWatches:resolve(shelves.quickWatches),
      genres:shelves.genres.map(g=>({...g,items:resolve(g.items)}))};
  },
  media: async (params: Record<string, string | number | undefined> = {}) => {
    let items = await listStoredMedia();
    const search = String(params.search ?? '').trim().toLocaleLowerCase();
    const libraryId = params.libraryId === undefined ? null : Number(params.libraryId);
    const folder = params.folder === undefined ? null : String(params.folder);
    if (search) items = items.filter((item) => `${item.title} ${item.filename} ${item.folder}`.toLocaleLowerCase().includes(search));
    if (libraryId !== null) items = items.filter((item) => item.library_id === libraryId);
    if (folder !== null) items = items.filter((item) => item.folder === folder || params.recursive!==0&&params.recursive!=='0'&&item.folder.startsWith(`${folder}/`));
    if (params.kind) items = items.filter((item) => item.kind === params.kind);
    if (params.seriesTitle !== undefined) {
      const title = seriesTitleKey(String(params.seriesTitle));
      items = items.filter((item) => item.series_title !== null && seriesTitleKey(item.series_title) === title);
    }
    if (String(params.liked ?? '') === '1') items = items.filter((item) => Boolean(item.liked));
    items.sort(params.sort==='random'&&params.seed!==undefined?(a,b)=>shortsRank(a.id,Number(params.seed))-shortsRank(b.id,Number(params.seed))||a.id-b.id:compare((params.sort as SortKey | undefined) ?? 'title'));
    const offset = Number(params.offset ?? 0);
    const limit = Number(params.limit ?? items.length);
    return hydrated(items.slice(offset, offset + limit));
  },
  clearMetadata: clearLocalMetadata,
  clearAllMetadata: clearAllLocalMetadata,
  mediaById: async (id: number) => {
    const item = await getStoredMedia(id);
    if (!item) throw new Error('Video not found.');
    return hydrateMedia(item);
  },
  shorts: async ({ limit = 40, offset = 0, seed = 0, startId }: { limit?: number; offset?: number; seed?: number; startId?: number } = {}): Promise<ShortsFeed> => {
    const settings = await readSettings();
    const all = (await listStoredMedia()).filter((item) => settings.shortsIncludeLandscapes || Boolean(item.width && item.height && item.height > item.width));
    all.sort((a, b) => Number(b.id === startId) - Number(a.id === startId) || shortsRank(a.id, seed) - shortsRank(b.id, seed) || a.id - b.id);
    const page = await hydrated(all.slice(offset, offset + limit));
    return { items: page.map((item) => ({ ...item, liked: item.liked ? 1 : 0 })), total: all.length };
  },
  setLike: async (id: number, liked: boolean) => {
    await updateStoredMedia(id, (item) => { item.liked = liked ? 1 : 0; item.updated_at = Date.now(); });
    return { ok: true, liked };
  },
  folders: async (): Promise<FolderEntry[]> => {
    const counts = new Map<string, FolderEntry>();
    for (const item of await listStoredMedia()) {
      const key = `${item.library_id}:${item.folder}`;
      const current = counts.get(key);
      if (current) current.count++; else counts.set(key, { library_id: item.library_id, folder: item.folder, count: 1 });
    }
    return [...counts.values()];
  },
  libraries: listLocalLibraries,
  addLibrary: addLocalLibrary,
  renameLibrary: renameLocalLibrary,
  reconnectLibrary: reconnectLocalLibrary,
  removeLibrary: async (id: number) => { await removeLocalLibrary(id); return { ok: true }; },
  settings: readSettings,
  saveSettings: (settings: Partial<Settings>) => writeSettings(settings),
  startScan: async () => ({ started: await startLocalScan(), status: getLocalScanStatus() }),
  scanStatus: async () => getLocalScanStatus(),
  capabilities: async () => browserCapabilities(),
  thumbnail: ensureLocalThumbnail,
  mediaSource: localMediaUrl,
  mediaFile: localMediaFile,
  progress: async (id: number, position: number, duration: number) => {
    await updateStoredMedia(id, (item) => {
      item.progress_position = Number.isFinite(position) ? Math.max(0, position) : 0;
      item.progress_updated_at = Date.now();
      item.progress_duration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
      item.progress_completed = item.progress_duration > 0 && item.progress_position / item.progress_duration >= 0.92 ? 1 : 0;
      item.updated_at = Date.now();
    });
  }
};

export function artwork(item: MediaItem, kind: 'poster' | 'backdrop' | 'thumbnail' = 'thumbnail') {
  const image = kind === 'poster' ? item.poster_path : kind === 'backdrop' ? item.backdrop_path : item.thumbnail_path;
  return image || item.thumbnail_path || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
}

function shortsRank(id: number, seed: number) {
  let hash = (id ^ seed) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
