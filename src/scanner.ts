import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import type { VireloDB } from './db.js';
import type { CatalogScope } from './auth-types.js';
import type { Library, MediaKind, MediaRecord, ScanStatus } from './types.js';
import { makeThumbnail, probeMedia } from './ffmpeg.js';
import { imageFileExists } from './image-files.js';

const VIDEO_EXTENSIONS = new Set(['.mp4','.m4v','.mkv','.webm','.mov','.avi','.wmv','.mpg','.mpeg','.ts','.m2ts','.flv','.ogv','.3gp']);

function cleanName(value: string) {
  return value
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b(2160p|1080p|720p|480p|web[- ]?dl|bluray|brrip|webrip|hdr|x264|x265|h264|h265|hevc|aac|dts)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseMediaName(path: string): {title:string; kind:MediaKind; seriesTitle:string|null; season:number|null; episode:number|null; year:number|null} {
  const file = basename(path, extname(path));
  const episodeMatch = file.match(/(?:^|[ ._-])S(\d{1,2})E(\d{1,3})(?:$|[ ._-])/i) || file.match(/(?:^|[ ._-])(\d{1,2})x(\d{1,3})(?:$|[ ._-])/i);
  const yearMatch = file.match(/(?:^|[ ._(-])((?:19|20)\d{2})(?:$|[ ._)-])/);
  const year = yearMatch ? Number(yearMatch[1]) : null;
  if (episodeMatch) {
    const markerIndex = episodeMatch.index ?? 0;
    const rawSeries = cleanName(file.slice(0, markerIndex));
    const parent = basename(dirname(path));
    const grandParent = basename(dirname(dirname(path)));
    const folderSeries = /^season\s*\d+$/i.test(parent) ? grandParent : parent;
    const seriesTitle = rawSeries || cleanName(folderSeries) || 'Series';
    return {
      title: `${seriesTitle} · S${String(Number(episodeMatch[1])).padStart(2,'0')}E${String(Number(episodeMatch[2])).padStart(2,'0')}`,
      kind: 'series', seriesTitle, season: Number(episodeMatch[1]), episode: Number(episodeMatch[2]), year
    };
  }
  const withoutYear = yearMatch ? file.replace(yearMatch[1], '') : file;
  const title = cleanName(withoutYear).replace(/[()[\]-]+$/g,'').trim() || file;
  return { title, kind: 'movie', seriesTitle: null, season: null, episode: null, year };
}

async function collectFiles(root: string, found: string[]): Promise<boolean> {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return false; }
  const complete = await Promise.all(entries.map(async (entry) => {
    if (entry.name.startsWith('.')) return;
    const full = join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(full, found);
    if (entry.isFile() && VIDEO_EXTENSIONS.has(extname(entry.name).toLowerCase())) found.push(resolve(full));
    return true;
  }));
  return complete.every(result => result !== false);
}

async function mapLimit<T>(items: T[], limit: number, worker: (item:T)=>Promise<void>) {
  let index = 0;
  const run = async () => {
    while (true) {
      const current = index++;
      if (current >= items.length) return;
      await worker(items[current]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(items.length,1)) }, run));
}

async function repairImages(db:VireloDB,record:MediaRecord,dataDir:string,status:ScanStatus){
  const [thumbnail,poster,backdrop]=await Promise.all([
    imageFileExists(record.thumbnail_path),imageFileExists(record.poster_path),imageFileExists(record.backdrop_path)
  ]);
  const missingPoster=Boolean(record.poster_path&&!poster),missingBackdrop=Boolean(record.backdrop_path&&!backdrop);
  if(missingPoster||missingBackdrop)db.clearMissingArtwork(record.id,missingPoster,missingBackdrop);
  if(thumbnail){
    const shared=db.shareThumbnail(record.path,record.thumbnail_path!);
    if(shared)status.thumbnailsRepaired=(status.thumbnailsRepaired??0)+1;
    return missingPoster||missingBackdrop||shared>0;
  }
  const restoring=Boolean(record.thumbnail_path);
  status.message=`${restoring?'Restoring':'Generating'} thumbnail · ${record.filename}`;
  const target=join(dataDir,'thumbnails',`${record.id}.jpg`);
  if(await makeThumbnail(record.path,target,record.duration)){
    db.shareThumbnail(record.path,target,true);
    const counter=restoring?'thumbnailsRepaired':'thumbnailsGenerated';
    status[counter]=(status[counter]??0)+1;
    return true;
  }
  status.errors++;
  return missingPoster||missingBackdrop;
}

export async function scanLibrary(db: VireloDB, library: Library, dataDir: string, status: ScanStatus) {
  const files: string[] = [];
  const complete = await collectFiles(library.path, files);
  if (!complete) status.errors++;
  status.total += files.length;
  const existingPaths = new Set(files);
  await mapLimit(files, 4, async (path) => {
    if (db.libraryForPath(path)?.id !== library.id) return;
    status.scanned++;
    try {
      const info = await stat(path);
      const previous = db.getMediaByPath(path);
      if (previous && previous.library_id === library.id && previous.mtime === Math.trunc(info.mtimeMs) && previous.size === info.size) {
        let updated=false;
        if(previous.duration==null||previous.width==null||previous.height==null||previous.video_codec==null){
          const probe=await probeMedia(path);
          if(probe){
            db.updateTechnicalMetadata(previous.id,{duration:probe.duration,width:probe.width,height:probe.height,video_codec:probe.videoCodec,audio_codec:probe.audioCodec,container:probe.container});
            Object.assign(previous,db.getMedia(previous.id));updated=true;
          }
        }
        if(await repairImages(db,previous,dataDir,status)||updated)status.updated++;else status.skipped++;
        return;
      }
      const parsed = parseMediaName(path);
      const probe = await probeMedia(path);
      const parent = dirname(path);
      let folder = '';
      try {
        const rel = relative(library.path, parent).replaceAll('\\', '/');
        if (rel && !rel.startsWith('..')) folder = rel;
      } catch { /* keep root */ }
      const record = db.upsertMedia({
        library_id: library.id,
        path: previous?.path ?? path,
        filename: basename(path),
        title: previous?.title || parsed.title,
        sort_title: (previous?.title || parsed.title).toLowerCase(),
        kind: parsed.kind,
        series_title: parsed.seriesTitle,
        season: parsed.season,
        episode: parsed.episode,
        year: parsed.year,
        duration: probe?.duration ?? previous?.duration ?? null,
        width: probe?.width ?? previous?.width ?? null,
        height: probe?.height ?? previous?.height ?? null,
        video_codec: probe?.videoCodec ?? previous?.video_codec ?? null,
        audio_codec: probe?.audioCodec ?? previous?.audio_codec ?? null,
        container: probe?.container ?? extname(path).slice(1),
        folder,
        size: info.size,
        mtime: Math.trunc(info.mtimeMs),
        thumbnail_path: previous?.thumbnail_path ?? null,
        poster_path: previous?.poster_path ?? null,
        backdrop_path: previous?.backdrop_path ?? null,
        overview: previous?.overview ?? null,
        genres: previous?.genres ?? null,
        external_id: previous?.external_id ?? null
      });
      if (previous) await rm(join(dataDir, 'cache', 'hls', String(record.id)), { recursive: true, force: true }).catch(() => undefined);
      await repairImages(db,record,dataDir,status);
      if (previous) status.updated++; else status.added++;
    } catch {
      status.errors++;
    }
  });
  if (complete) db.deleteMissingForLibrary(library.id, existingPaths);
}

export async function scanAll(db: VireloDB, dataDir: string, status: ScanStatus, scope?: CatalogScope) {
  for (const library of db.visibleLibraries(scope)) {
    status.message = `Scanning ${library.label}`;
    await scanLibrary(db, library, dataDir, status);
  }
}
