import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import chokidar from 'chokidar';
import { createReadStream, existsSync, watch as watchDirectory, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VireloDB } from './db.js';
import { ensureDataDirs, type RuntimeConfig } from './config.js';
import { parseMediaName, scanAll } from './scanner.js';
import { refreshMetadata, refreshMissingMetadata } from './metadata.js';
import { hasFfmpeg, hasFfprobe, playbackQualities, probePlaybackInfo } from './ffmpeg.js';
import { adaptiveTranscodeStatus, audioTranscodeStatus, extractSubtitleVtt, startAdaptiveTranscode, startAudioTranscode, startHlsTranscode, transcodeStatus, stopAllTranscodes } from './transcode.js';
import type { AppSettings, MediaKind, ScanStatus, SortKey } from './types.js';
import { VIRELO_VERSION } from './version.js';
import { demandManifest, demandSegment, initializeDemandCache, playbackCacheLimit, clearPlaybackCache } from './demand-playback.js';
import { dataUsage, assertSeparateCache } from './data-management.js';
import { directLocal, registerAccounts } from './auth.js';
import type { CatalogScope } from './auth-types.js';
import { pickNativeFolder } from './folder-picker.js';
import { isMediaFile, isVideoPath, mediaWatchFilter } from './media-files.js';
import { assertSupportedNode } from './runtime.js';

const SORT_KEYS: SortKey[] = ['title', 'newest', 'oldest', 'year', 'duration', 'random'];

function contentType(path: string) {
  const ext = extname(path).toLowerCase();
  return ({
    '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
    '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo', '.wmv': 'video/x-ms-wmv', '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg', '.ts': 'video/mp2t', '.m2ts': 'video/mp2t', '.flv': 'video/x-flv', '.ogv': 'video/ogg',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif'
  } as Record<string,string>)[ext] || 'application/octet-stream';
}

function publicSettings(settings: AppSettings) {
  return {
    ...settings,
    tmdbApiKey: '',
    tmdbApiKeyConfigured: Boolean(settings.tmdbApiKey)
  };
}


function hostWithoutPort(value: string) {
  if (value.startsWith('[')) return value.slice(1, value.indexOf(']'));
  return value.split(':')[0].toLowerCase();
}

function isPrivateHost(host: string, configHost: string) {
  const normalized = host.toLowerCase();
  const trusted = (process.env.VIRELO_TRUSTED_HOSTS || '').split(',').map((value) => value.trim().toLowerCase()).filter(Boolean);
  if (trusted.includes(normalized)) return true;
  if (['localhost', '127.0.0.1', '::1'].includes(normalized) || normalized.endsWith('.local') || /^[a-z0-9-]+$/i.test(normalized)) return true;
  if (configHost !== '0.0.0.0' && configHost !== '::' && normalized === configHost.toLowerCase()) return true;
  if (/^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized) || /^169\.254\./.test(normalized)) return true;
  const ipv4 = normalized.match(/^172\.(\d{1,3})\./);
  if (ipv4 && Number(ipv4[1]) >= 16 && Number(ipv4[1]) <= 31) return true;
  const cgnat = normalized.match(/^100\.(\d{1,3})\./);
  if (cgnat && Number(cgnat[1]) >= 64 && Number(cgnat[1]) <= 127) return true;
  if (/^(fc|fd|fe[89ab])/i.test(normalized)) return true;
  return false;
}

function isTermuxRuntime() {
  return Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('/com.termux/'));
}

export async function createVireloServer(config: RuntimeConfig, pickFolder: (signal: AbortSignal) => Promise<string | null> = pickNativeFolder) {
  assertSupportedNode();
  ensureDataDirs(config.dataDir);
  await initializeDemandCache(config.dataDir);
  const db = new VireloDB(config.dataDir);
  const app = Fastify({ logger: { level: process.env.VIRELO_LOG_LEVEL || 'info', redact: ['req.headers.cookie','req.headers.authorization','res.headers.set-cookie'] }, bodyLimit: 1024 * 1024 });
  app.addHook('onRequest', async (request, reply) => {
    const hostHeader = request.headers.host || '';
    const hostname = hostWithoutPort(hostHeader);
    if (!hostname || !isPrivateHost(hostname, config.host)) return reply.code(403).send({ error: 'Untrusted Host header.' });
    const origin = request.headers.origin;
    if (origin) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.host.toLowerCase() !== hostHeader.toLowerCase()) return reply.code(403).send({ error: 'Cross-origin request blocked.' });
      } catch {
        return reply.code(403).send({ error: 'Invalid Origin header.' });
      }
    }
  });
  app.addHook('onSend', async (_request, reply, payload) => {
    reply.headers({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; worker-src 'self' blob:; font-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    });
    return payload;
  });
  const webRoot = fileURLToPath(new URL('./web', import.meta.url));
  const { accounts, fresh } = registerAccounts(app, db);
  let activePicker: AbortController | null = null;
  let closing = false;
  const scanAbort = new AbortController();
  let scanTask: Promise<void> | null = null;
  app.addHook('preClose', async () => { closing = true; scanAbort.abort(); activePicker?.abort(); });
  let watcher: { close(): void | Promise<unknown> } | null = null;
  let watchDebounce: NodeJS.Timeout | null = null;

  if (config.mediaPaths.length) {
    for (const mediaPath of config.mediaPaths) {
      try {
        const info = await stat(mediaPath);
        if (info.isDirectory()) db.addLibrary(mediaPath, basename(mediaPath) || mediaPath, false);
      } catch {
        app.log.warn({ mediaPath }, 'Skipping unreadable media directory');
      }
    }
  }

  const scanStatus: ScanStatus = {
    running: false, startedAt: null, finishedAt: null, total: 0, scanned: 0, added: 0, updated: 0, skipped: 0, thumbnailsGenerated:0, thumbnailsRepaired:0, errors: 0, message: 'Idle'
  };

  async function runScan(scope?: CatalogScope) {
    if (closing || scanStatus.running) return false;
    Object.assign(scanStatus, { running: true, startedAt: Date.now(), finishedAt: null, total: 0, scanned: 0, added: 0, updated: 0, skipped: 0, thumbnailsGenerated:0, thumbnailsRepaired:0, errors: 0, message: 'Starting scan' });
    scanTask = (async () => {
      try {
        await scanAll(db, config.dataDir, scanStatus, scope, scanAbort.signal);
        const settings = db.getSettings();
        let metadataSummary='';
        if (settings.externalMetadataEnabled && !closing) {
          scanStatus.message = 'Matching metadata';
          const result = await refreshMissingMetadata(db, config.dataDir, (done, total) => {
            scanStatus.message = `Matching metadata · ${done}/${total}`;
          }, scope, scanAbort.signal);
          scanStatus.errors+=result.failed+result.artworkFailed;
          if(result.attempted)metadataSummary=` · ${result.updated} metadata matches`;
        }
        scanStatus.message = `Scan complete · ${scanStatus.scanned} checked · ${scanStatus.added} added · ${scanStatus.updated} updated · ${scanStatus.thumbnailsGenerated} thumbnail${scanStatus.thumbnailsGenerated===1?'':'s'} generated · ${scanStatus.thumbnailsRepaired} thumbnail${scanStatus.thumbnailsRepaired===1?'':'s'} restored${metadataSummary} · ${scanStatus.errors} errors`;
      } catch (error) {
        scanStatus.errors++;
        scanStatus.message = error instanceof Error ? error.message : 'Scan failed';
        app.log.error(error);
      } finally {
        scanStatus.running = false;
        scanStatus.finishedAt = Date.now();
      }
    })();
    return true;
  }

  async function refreshWatcher() {
    if (watcher) { await watcher.close(); watcher = null; }
    if (closing || !db.getSettings().libraryWatchEnabled) return;
    const paths = db.visibleLibraries().map((l) => l.path).filter((p) => existsSync(p));
    if (!paths.length) return;
    const ignored = mediaWatchFilter(paths);
    const schedule = () => {
      if (closing) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => { void runScan(); }, 1400);
    };
    const scheduleFile = (path: string) => {
      if (closing) return;
      if (extname(path).toLowerCase() !== '.ts' || db.getMediaByPath(path)) schedule();
      else void isMediaFile(path).then(video => { if (video) schedule(); }).catch(() => undefined);
    };
    const warn = (error: unknown) => app.log.warn({ err: error }, 'Library watcher stopped; use Scan now to refresh manually');
    if (process.platform === 'win32') {
      const native: FSWatcher[] = [];
      try {
        // Windows can monitor a whole tree without a startup crawl or per-file handles.
        for (const root of paths) native.push(watchDirectory(root, {recursive:true}, (event, name) => {
          if (!name) { schedule(); return; }
          const path = resolve(root, name.toString());
          if (ignored(path)) return;
          if (isVideoPath(path)) scheduleFile(path);
          else if (event === 'rename') void stat(path).then(info => { if (info.isDirectory()) schedule(); }).catch(() => schedule());
        }).on('error', warn));
        watcher = {close() { for (const current of native) current.close(); }};
        return;
      } catch (error) {
        for (const current of native) current.close();
        app.log.warn({err:error}, 'Native folder monitoring is unavailable; using portable monitoring');
      }
    }
    const portable = chokidar.watch(paths, {
      ignoreInitial: true,
      ignored,
      followSymlinks: false,
      usePolling: isTermuxRuntime(),
      awaitWriteFinish: { stabilityThreshold: 1200, pollInterval: 200 }
    });
    watcher = portable;
    portable
      .on('add', scheduleFile)
      .on('change', scheduleFile)
      .on('unlink', path => { if (!closing && (extname(path).toLowerCase() !== '.ts' || db.getMediaByPath(path))) schedule(); })
      .on('addDir', schedule)
      .on('unlinkDir', schedule)
      .on('error', warn);
  }

  const visibleScanStatus = (isAdmin: boolean) => isAdmin ? scanStatus : { ...scanStatus, message: scanStatus.running ? 'Scanning libraries' : 'Idle', total:0,scanned:0,added:0,updated:0,skipped:0,thumbnailsGenerated:0,thumbnailsRepaired:0,errors:0 };
  app.get('/api/health', async request => ({ ok: true, version: VIRELO_VERSION, ffmpeg: await hasFfmpeg(), ffprobe: await hasFfprobe(), scan: visibleScanStatus(request.account!.isAdmin) }));
  app.get('/api/settings', async () => publicSettings(db.getSettings()));
  app.get('/api/data', async request => {
    fresh(request,true);
    const usage=await dataUsage(config.dataDir,playbackCacheLimit(config.dataDir));
    fresh(request,true);
    return usage;
  });
  app.delete('/api/data/cache', async (request,reply) => {
    fresh(request,true);
    if(request.body!==undefined&&request.body!==null)return reply.code(400).send({error:'This action does not accept paths or options.'});
    return clearPlaybackCache(config.dataDir,()=>{
      fresh(request,true);
      assertSeparateCache(config.dataDir,db.listLibraries().map(library=>library.path));
    });
  });
  app.post<{ Body: Partial<AppSettings> & { tmdbApiKey?: string; clearTmdbApiKey?: boolean } }>('/api/settings', async (request) => {
    const body = request.body || {};
    const patch: Partial<AppSettings> = {};
    for (const key of ['externalMetadataEnabled','externalImagesEnabled','metadataProvider','metadataLanguage','libraryWatchEnabled','shortsIncludeLandscapes','queueBehavior'] as const) {
      if (body[key] !== undefined) (patch as any)[key] = body[key];
    }
    if (body.clearTmdbApiKey === true) patch.tmdbApiKey = '';
    else if (typeof body.tmdbApiKey === 'string' && body.tmdbApiKey.trim()) patch.tmdbApiKey = body.tmdbApiKey.trim();
    db.updateSettings(patch);
    await refreshWatcher();
    const updatedSettings = db.getSettings();
    if (updatedSettings.externalMetadataEnabled) void runScan();
    return publicSettings(updatedSettings);
  });

  app.get('/api/libraries', async request => db.visibleLibraries(request.catalogScope!));
  app.post('/api/libraries/pick', async (request, reply) => {
    if (!directLocal(request)) return reply.code(403).send({ error: 'Folder browsing is only available on localhost. Enter a path on the server PC instead.' });
    if (activePicker) return reply.code(409).send({ error: 'A folder selection window is already open on this PC. Finish or cancel that window, then try again.' });
    const controller = new AbortController();
    activePicker = controller;
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    try {
      const path = await pickFolder(controller.signal);
      if (!fresh(request).permissions.manageLibraries) return reply.code(403).send({ error: 'Library management is not allowed.' });
      return { path };
    } finally {
      reply.raw.off('close', abort);
      activePicker = null;
    }
  });
  app.post<{ Body: { path?: string; label?: string } }>('/api/libraries', async (request, reply) => {
    const raw = typeof request.body?.path === 'string' ? request.body.path.trim() : '';
    if (!raw) return reply.code(400).send({ error: 'path is required' });
    const path = resolve(raw);
    try {
      const info = await stat(path);
      if (!info.isDirectory()) throw new Error('Not a directory');
    } catch {
      return reply.code(400).send({ error: 'Directory does not exist or cannot be read.' });
    }
    const user = fresh(request);
    if (!user.permissions.manageLibraries) return reply.code(403).send({ error: 'Library management is not allowed.' });
    const label = typeof request.body?.label === 'string' ? request.body.label.trim().slice(0,200) : '';
    const library = db.addLibrary(path, label || basename(path) || path);
    if (!user.allLibraries) accounts.grantLibrary(user.id, library.id);
    await refreshWatcher();
    const current = accounts.get(user.id);
    if (current) await runScan({userId:current.id,libraryIds:[library.id]});
    return library;
  });
  app.delete<{ Params: { id: string } }>('/api/libraries/:id', async (request, reply) => {
    const id = Number(request.params.id);
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' });
    db.removeLibrary(id);
    await refreshWatcher();
    return { ok: true };
  });

  app.post('/api/scan', async request => ({ started: await runScan(request.catalogScope!), status: visibleScanStatus(request.account!.isAdmin) }));
  app.get('/api/scan/status', async request => visibleScanStatus(request.account!.isAdmin));
  app.get('/api/home', async request => db.getHome(request.catalogScope!));
  app.get<{ Querystring: { search?: string; kind?: MediaKind; limit?: string; offset?: string; libraryId?: string; folder?: string; sort?: string; liked?: string } }>('/api/media', async (request) => {
    const q = request.query;
    return db.listMedia({
      search: q.search?.slice(0, 200),
      kind: q.kind,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
      libraryId: q.libraryId ? Number(q.libraryId) : undefined,
      folder: q.folder !== undefined ? q.folder.slice(0, 500) : undefined,
      sort: (SORT_KEYS as string[]).includes(q.sort ?? '') ? q.sort as SortKey : 'title',
      liked: q.liked === '1' || q.liked === 'true'
    }, request.catalogScope!);
  });
  app.get('/api/folders', async request => db.getFolders(request.catalogScope!));
  app.get<{ Params: { id: string } }>('/api/media/:id', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media) return reply.code(404).send({ error: 'Not found' });
    return media;
  });
  app.post<{ Params: { id: string }; Body: { position?: number; duration?: number } }>('/api/media/:id/progress', async (request, reply) => {
    const id = Number(request.params.id);
    if (!db.getMedia(id, request.catalogScope!)) return reply.code(404).send({ error: 'Not found' });
    db.setProgress(id, Number(request.body?.position) || 0, Number(request.body?.duration) || 0, request.account!.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string } }>('/api/media/:id/playback', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media || !existsSync(media.path)) return reply.code(404).send({ error: 'Media file not found' });
    const info = await probePlaybackInfo(media.path);
    if (!info) return reply.code(503).send({ error: 'ffprobe is required to inspect audio and subtitle tracks.' });
    return info;
  });
  app.post<{ Params: { id: string }; Body: { audioStream?: number; startTime?: number } }>('/api/media/:id/transcode/start', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media || !existsSync(media.path)) return reply.code(404).send({ error: 'Media file not found' });
    const audioStream = request.body?.audioStream;
    const startTime=request.body?.startTime;
    if(startTime!==undefined&&(!Number.isFinite(startTime)||startTime<0||(media.duration&&startTime>=media.duration)))return reply.code(400).send({error:'Invalid seek position.'});
    const info=await probePlaybackInfo(media.path);
    if (audioStream !== undefined) {
      if (!Number.isInteger(audioStream) || audioStream < 0) return reply.code(400).send({ error: 'Invalid audio stream.' });
      if (!info?.audioTracks.some((track) => track.index === audioStream)) return reply.code(400).send({ error: 'Audio stream not found.' });
    }
    return startHlsTranscode(config.dataDir, media.id, media.path, { audioStream, copyVideo:info?.videoCodec==='h264',startTime,duration:media.duration });
  });
  app.get<{ Params: { id: string }; Querystring: { audioStream?: string; startTime?: string } }>('/api/media/:id/transcode/status', async (request, reply) => {
    const audioStream = request.query.audioStream === undefined ? undefined : Number(request.query.audioStream);
    if (audioStream !== undefined && (!Number.isInteger(audioStream) || audioStream < 0)) return reply.code(400).send({ error: 'Invalid audio stream.' });
    const startTime=Number(request.query.startTime??0);
    if(!Number.isSafeInteger(startTime)||startTime<0)return reply.code(400).send({error:'Invalid seek position.'});
    return transcodeStatus(config.dataDir, Number(request.params.id), audioStream,startTime);
  });
  app.post<{ Params: { id: string }; Body: { audioStream?: number; startTime?: number } }>('/api/media/:id/quality/start', async (request, reply) => {
    const media=db.getMedia(Number(request.params.id), request.catalogScope!);
    if(!media||!existsSync(media.path))return reply.code(404).send({error:'Media file not found'});
    const startTime=request.body?.startTime;
    if(startTime!==undefined&&(!Number.isFinite(startTime)||startTime<0||(media.duration&&startTime>=media.duration)))return reply.code(400).send({error:'Invalid seek position.'});
    const info=await probePlaybackInfo(media.path);
    if(!info||!info.width||!info.height)return reply.code(503).send({error:'Video resolution could not be inspected.'});
    const audioStream=request.body?.audioStream;
    if(audioStream!==undefined&&(!Number.isInteger(audioStream)||!info.audioTracks.some((track)=>track.index===audioStream)))return reply.code(400).send({error:'Audio stream not found.'});
    return startAdaptiveTranscode(config.dataDir,media.id,media.path,{audioStream,hasAudio:info.audioTracks.length>0,sourceWidth:info.width,sourceHeight:info.height,qualities:info.qualityOptions,startTime,duration:media.duration});
  });
  app.get<{ Params: { id: string }; Querystring: { audioStream?: string; startTime?: string } }>('/api/media/:id/quality/status', async (request, reply) => {
    const media=db.getMedia(Number(request.params.id), request.catalogScope!);
    if(!media||!existsSync(media.path))return reply.code(404).send({error:'Media file not found'});
    const audioStream=request.query.audioStream===undefined?undefined:Number(request.query.audioStream);
    if(audioStream!==undefined&&(!Number.isInteger(audioStream)||audioStream<0))return reply.code(400).send({error:'Invalid audio stream.'});
    const startTime=Number(request.query.startTime??0);
    if(!Number.isSafeInteger(startTime)||startTime<0)return reply.code(400).send({error:'Invalid seek position.'});
    return adaptiveTranscodeStatus(config.dataDir,media.id,audioStream,playbackQualities(media.width,media.height),startTime);
  });
  app.post<{ Params: { id: string }; Body: { audioStream?: number } }>('/api/media/:id/audio/start', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media || !existsSync(media.path)) return reply.code(404).send({ error: 'Media file not found' });
    const audioStream = request.body?.audioStream;
    if (!Number.isInteger(audioStream) || Number(audioStream) < 0) return reply.code(400).send({ error: 'Invalid audio stream.' });
    const info = await probePlaybackInfo(media.path);
    if (!info?.audioTracks.some((track) => track.index === audioStream)) return reply.code(400).send({ error: 'Audio stream not found.' });
    return startAudioTranscode(config.dataDir, media.id, media.path, Number(audioStream),media.duration);
  });
  app.get<{ Params: { id: string }; Querystring: { audioStream?: string } }>('/api/media/:id/audio/status', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media) return reply.code(404).send({ error: 'Media file not found' });
    const audioStream = Number(request.query.audioStream);
    if (!Number.isInteger(audioStream) || audioStream < 0) return reply.code(400).send({ error: 'Invalid audio stream.' });
    return audioTranscodeStatus(config.dataDir, media.id, audioStream);
  });
  app.get<{ Params: { id: string; stream: string } }>('/api/media/:id/subtitles/:stream', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media || !existsSync(media.path)) return reply.code(404).send({ error: 'Media file not found' });
    const subtitleStream = Number(request.params.stream);
    if (!Number.isInteger(subtitleStream) || subtitleStream < 0) return reply.code(400).send({ error: 'Invalid subtitle stream.' });
    const info = await probePlaybackInfo(media.path);
    const track = info?.subtitleTracks.find((candidate) => candidate.index === subtitleStream);
    if (!track) return reply.code(404).send({ error: 'Subtitle stream not found.' });
    if (!track.supported) return reply.code(415).send({ error: 'This subtitle format cannot be converted to WebVTT.' });
    try {
      const subtitle = await extractSubtitleVtt(config.dataDir, media.id, media.path, subtitleStream);
      return reply.type('text/vtt; charset=utf-8').header('Cache-Control','private, max-age=86400').send(createReadStream(subtitle.path));
    } catch (error) {
      return reply.code(500).send({ error: error instanceof Error ? error.message : 'Subtitle conversion failed.' });
    }
  });

  app.get<{ Querystring: { limit?: string; offset?: string; seed?: string; startId?: string } }>('/api/shorts', async (request) => {
    const q = request.query;
    return db.getShorts({
      limit: q.limit ? Number(q.limit) : 50,
      offset: q.offset ? Number(q.offset) : 0,
      seed: q.seed ? Number(q.seed) : 0,
      startId: q.startId ? Number(q.startId) : undefined,
      includeLandscapes: db.getSettings().shortsIncludeLandscapes
    }, request.catalogScope!);
  });
  app.post<{ Params: { id: string }; Body: { liked?: boolean } }>('/api/media/:id/like', async (request, reply) => {
    const id = Number(request.params.id);
    if (!db.getMedia(id, request.catalogScope!)) return reply.code(404).send({ error: 'Not found' });
    const liked = request.body?.liked === true;
    db.setLike(id, liked, request.account!.id);
    return { ok: true, liked };
  });

  app.delete('/api/metadata', async () => db.clearAllExternalMetadata());

  app.delete<{ Params: { id: string } }>('/api/media/:id/metadata', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media) return reply.code(404).send({ error: 'Media not found.' });
    db.clearExternalMetadata(media.id, parseMediaName(media.path));
    return db.getMedia(media.id, request.catalogScope!);
  });

  app.post<{ Params: { id: string } }>('/api/media/:id/metadata/refresh', async (request, reply) => {
    try { await refreshMetadata(db, config.dataDir, Number(request.params.id)); return db.getMedia(Number(request.params.id), request.catalogScope!); }
    catch (error) { return reply.code(400).send({ error: error instanceof Error ? error.message : 'Metadata refresh failed' }); }
  });

  app.get<{ Params: { id: string; kind: string } }>('/api/media/:id/artwork/:kind', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media) return reply.code(404).send();
    const path = request.params.kind === 'poster' ? media.poster_path : request.params.kind === 'backdrop' ? media.backdrop_path : media.thumbnail_path;
    if (!path || !existsSync(path)) return reply.code(404).send();
    reply.header('Cache-Control', 'public, max-age=86400, immutable').type(contentType(path));
    return reply.send(createReadStream(path));
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/stream', async (request, reply) => {
    const media = db.getMedia(Number(request.params.id), request.catalogScope!);
    if (!media || !existsSync(media.path)) return reply.code(404).send({ error: 'Media file not found' });
    const info = await stat(media.path);
    const total = info.size;
    const range = request.headers.range;
    reply.header('Accept-Ranges', 'bytes').header('Cache-Control', 'private, max-age=0').type(contentType(media.path));
    if (!range) {
      reply.header('Content-Length', total);
      return reply.send(createReadStream(media.path));
    }
    if (range.includes(',')) return reply.code(416).header('Content-Range', `bytes */${total}`).send();
    const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!match || (!match[1] && !match[2])) return reply.code(416).header('Content-Range', `bytes */${total}`).send();
    let start: number;
    let end: number;
    if (!match[1]) {
      const suffixLength = Number(match[2]);
      if (!Number.isFinite(suffixLength) || suffixLength <= 0) return reply.code(416).header('Content-Range', `bytes */${total}`).send();
      start = Math.max(total - Math.trunc(suffixLength), 0);
      end = total - 1;
    } else {
      start = Number(match[1]);
      end = match[2] ? Math.min(Number(match[2]), total - 1) : total - 1;
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= total) {
      return reply.code(416).header('Content-Range', `bytes */${total}`).send();
    }
    const chunkSize = end - start + 1;
    reply.code(206).headers({
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Content-Length': chunkSize
    });
    return reply.send(createReadStream(media.path, { start, end }));
  });

  app.get<{Params:{id:string;stamp:string;mode:string;audio:string;'*':string}}>('/playback/:id/:stamp/:mode/:audio/*',async(request,reply)=>{
    const {id,stamp,mode,audio}=request.params,resource=request.params['*'];
    const prefix=`/playback/${id}/${stamp}/${mode}/${audio}`;
    const manifest=demandManifest(config.dataDir,prefix,resource);
    if(manifest!==null)return reply.type('application/vnd.apple.mpegurl').header('Cache-Control','no-store').send(manifest);
    if(!/^(?:\d+\/)?segment-\d+\.ts$/.test(resource))return reply.code(404).send({error:'Playback resource not found.'});
    const controller=new AbortController();
    const abort=()=>{if(!reply.raw.writableFinished)controller.abort();};reply.raw.once('close',abort);
    try{
      const segment=await demandSegment(config.dataDir,prefix,resource,controller.signal);
      if(controller.signal.aborted){segment.release();return reply;}
      reply.raw.once('close',segment.release);
      return reply.type('video/mp2t').header('Cache-Control','private, max-age=3600').send(createReadStream(segment.path));
    }catch(reason){if(controller.signal.aborted)return reply;return reply.code(503).send({error:reason instanceof Error?reason.message:'Playback segment is unavailable.'});}
  });
  await app.register(fastifyStatic, { root: resolve(config.dataDir, 'cache', 'hls'), prefix: '/hls/', wildcard: true, decorateReply: false, cacheControl: false });
  await app.register(fastifyStatic, { root: resolve(config.dataDir, 'cache', 'audio'), prefix: '/audio/', wildcard: true, decorateReply: false, cacheControl: false });
  await app.register(fastifyStatic, {
    root: webRoot, prefix: '/', wildcard: true, decorateReply: true,
    setHeaders(reply, path) {
      if (extname(path).toLowerCase() === '.html' || ['sw.js','startup.js'].includes(basename(path))) reply.header('Cache-Control', 'no-cache');
    }
  });
  app.setNotFoundHandler(async (request, reply) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (/^\/(?:api|assets|hls|audio|playback)(?:\/|$)/.test(pathname)
      || !['GET', 'HEAD'].includes(request.method) || extname(pathname)) {
      return reply.code(404).header('Cache-Control', 'no-store').send({ error: 'Not found' });
    }
    return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  app.addHook('onClose', async () => {
    if (watchDebounce) clearTimeout(watchDebounce);
    if (watcher) await watcher.close();
    await scanTask;
    await stopAllTranscodes(config.dataDir);
    db.close();
  });

  await refreshWatcher();
  return { app, db, accounts, runScan, scanStatus };
}

export async function startServer(config: RuntimeConfig) {
  const { app, db, runScan, scanStatus } = await createVireloServer(config);
  await app.listen({ host: config.host, port: config.port });
  const address = app.server.address();
  const port = address && typeof address === 'object' ? address.port : config.port;
  void runScan();
  return { app, db, port, scanStatus };
}
