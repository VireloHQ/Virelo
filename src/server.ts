import Fastify, { type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import chokidar from 'chokidar';
import { createReadStream, existsSync, realpathSync, watch as watchDirectory, type FSWatcher } from 'node:fs';
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
import { registerPlaylists } from './playlists.js';
import type { CatalogScope } from './auth-types.js';
import { pickNativeFolder } from './folder-picker.js';
import { isMediaFile, isVideoPath, mediaWatchFilter, resolveLibraryFile } from './media-files.js';
import { generatedFileInfo } from './image-files.js';
import { assertSupportedNode } from './runtime.js';
import { CustomCommands, registerCustomCommands } from './custom-commands.js';
import { serverUrl,networkUrls,acceptsIpv4 } from './network-urls.js';
import { registerNotifications } from './notifications.js';
import { mediaScheduler,MediaBusyError } from './media-work.js';
import { requestHostname, isTrustedHostname } from './request-security.js';
import { AccountError } from './accounts.js';
import { libraryName, libraryFolder } from './library-names.js';

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


function isTermuxRuntime() {
  return Boolean(process.env.TERMUX_VERSION || process.env.PREFIX?.includes('/com.termux/'));
}

export async function createVireloServer(config: RuntimeConfig, pickFolder: (signal: AbortSignal) => Promise<string | null> = pickNativeFolder) {
  assertSupportedNode();
  ensureDataDirs(config.dataDir);
  config={...config,dataDir:realpathSync.native(config.dataDir)};
  mediaScheduler.openScope(resolve(config.dataDir));
  const db = new VireloDB(config.dataDir);
  // Broad/archived libraries may contain even a hidden data folder; keep the UI, disable the cache.
  const checkCacheLibraries=()=>assertSeparateCache(config.dataDir,[...config.mediaPaths,...db.listLibraries().map(library=>library.path)]);
  let cacheBlocked:Error|undefined;
  try {
    try{checkCacheLibraries();}catch(error){if((error as {statusCode?:number}).statusCode!==409)throw error;cacheBlocked=error as Error;}
    await initializeDemandCache(config.dataDir,checkCacheLibraries,!cacheBlocked);
  } catch(error) { db.close();await mediaScheduler.closeScope(resolve(config.dataDir));throw error; }
  const app = Fastify({ logger: { level: process.env.VIRELO_LOG_LEVEL || 'info', redact: ['req.headers.cookie','req.headers.authorization','res.headers.set-cookie'] }, bodyLimit: 1024 * 1024 });
  if(cacheBlocked)app.log.warn(cacheBlocked.message);
  const trustedHosts = (process.env.VIRELO_TRUSTED_HOSTS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
  const commands = new CustomCommands(db.db, config.dataDir, () => {
    const address = app.server.address();
    const host = address && typeof address === 'object' ? address.address : config.host;
    return serverUrl(host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host, address && typeof address === 'object' ? address.port : config.port);
  });
  app.addHook('onRequest', async (request, reply) => {
    const hostHeader = request.headers.host || '';
    const hostname = requestHostname(hostHeader);
    if (!hostname || (!isTrustedHostname(hostname, config.host, trustedHosts) && !commands.allowsHost(hostname))) return reply.code(403).send({ error: 'Untrusted Host header.' });
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
  const { accounts, fresh } = registerAccounts(app, db, host => commands.allowsHost(host));
  const mediaResource=(request:FastifyRequest)=>{
    const user=fresh(request),scope=accounts.scope(user),route=request.routeOptions.url??'';
    const params=request.params as {id?:string;'*'?:string};
    const media=db.getMedia(Number(params.id??params['*']?.split('/')[0]),scope);
    if(!media)throw new AccountError('Media not found.',404);
    if(!route.includes('/artwork/')&&!user.permissions.play
      ||(route.startsWith('/playback/')||/\/(?:transcode|quality|audio)\//.test(route))&&!user.permissions.transcode)
      throw new AccountError('Your account does not have permission for this action.',403);
    if(/^\/(?:hls|audio|playback)\//.test(route)||/^\/api\/media\/:id\/(?:transcode|quality|audio|subtitles)\//.test(route))checkCacheLibraries();
    if(route.includes('/artwork/'))return media;
    const library=db.visibleLibraries(scope).find(library=>library.id===media.library_id);
    const path=library&&resolveLibraryFile(media.path,library.path);
    if(!path||db.libraryForPath(path)?.id!==media.library_id)throw new AccountError('Media file not found',404);
    return {...media,path};
  };
  const cachedPath=(request:FastifyRequest,bucket:string)=>resolve(config.dataDir,'cache',bucket,(request.params as {'*':string})['*']);
  app.addHook('preHandler',async request=>{if(/^\/(?:hls|audio)\//.test(request.routeOptions.url??''))mediaResource(request);});
  app.addHook('onSend',async(request,reply,payload)=>{
    const route=request.routeOptions.url??'';
    if(reply.statusCode<400&&(/^\/(?:hls|audio|playback)\//.test(route)||/^\/api\/media\/:id\/(?:stream|playback|subtitles|transcode|quality|audio|artwork)(?:\/|$)/.test(route))){
      mediaResource(request);
      const bucket=/^\/(hls|audio)\//.exec(route)?.[1];
      if(bucket)try{generatedFileInfo(cachedPath(request,bucket),resolve(config.dataDir,'cache'));}
      catch{throw new AccountError('Playback resource not found.',404);}
    }
    return payload;
  });
  registerNotifications(app,db.db);
  app.get('/api/share/addresses',async request=>{
    if(!directLocal(request))return [];
    const address=app.server.address();
    if(!address||typeof address==='string')return [];
    const ipv4=config.host==='::'&&await acceptsIpv4(address.port,app.server);
    return networkUrls(config.host,address.port,undefined,ipv4);
  });
  registerCustomCommands(app, commands, request => fresh(request, true));
  registerPlaylists(app, db);
  let activePicker: AbortController | null = null;
  let closing = false;
  const scanAbort = new AbortController();
  let scanTask: Promise<void> | null = null;
  app.addHook('preClose', async () => { closing = true; scanAbort.abort(); activePicker?.abort(); await Promise.all([commands.close(),mediaScheduler.closeScope(resolve(config.dataDir))]); });
  let watcher: { close(): void | Promise<unknown> } | null = null;
  let watchDebounce: NodeJS.Timeout | null = null;
  let watchScanPending = false;

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
        if (watchScanPending && !closing) {
          watchScanPending = false;
          void runScan();
        }
      }
    })();
    return true;
  }

  async function refreshWatcher() {
    if (watcher) { await watcher.close(); watcher = null; }
    if (watchDebounce) { clearTimeout(watchDebounce); watchDebounce = null; }
    watchScanPending = false;
    if (closing || !db.getSettings().libraryWatchEnabled) return;
    const paths = db.visibleLibraries().map((l) => l.path).filter((p) => existsSync(p));
    if (!paths.length) return;
    const ignored = mediaWatchFilter(paths);
    const schedule = () => {
      if (closing) return;
      if (watchDebounce) clearTimeout(watchDebounce);
      watchDebounce = setTimeout(() => {
        watchDebounce = null;
        if (scanStatus.running) watchScanPending = true;
        else void runScan();
      }, 1400);
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
    const body = request.body ?? {};
    if (typeof body !== 'object' || Array.isArray(body)
      || body.clearTmdbApiKey !== undefined && typeof body.clearTmdbApiKey !== 'boolean'
      || body.tmdbApiKey !== undefined && typeof body.tmdbApiKey !== 'string') throw new AccountError('Invalid settings.');
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

  const namedLibraries = (scope:CatalogScope) => {
    const allowed = new Map<number,Set<string>>();
    for (const entry of db.getFolders(scope)) {
      let paths = allowed.get(entry.library_id);
      if (!paths) { paths = new Set(); allowed.set(entry.library_id,paths); }
      const parts = entry.folder.split('/');
      for (let index=1;index<=parts.length;index++) paths.add(parts.slice(0,index).join('/'));
    }
    return db.visibleLibraries(scope).map(library => ({...library,folderLabels:Object.fromEntries(
      Object.entries(db.folderLabels(library.id)).filter(([folder]) => allowed.get(library.id)?.has(folder))
    )}));
  };
  app.get('/api/libraries', async request => namedLibraries(request.catalogScope!));
  app.patch<{ Params: { id:string }; Body: { label?:unknown; folder?:unknown } }>('/api/libraries/:id', async (request, reply) => {
    const user = fresh(request);
    if (!user.permissions.manageLibraries) return reply.code(403).send({error:'Library management is not allowed.'});
    const id = Number(request.params.id), scope = accounts.scope(user);
    const library = Number.isSafeInteger(id) && id > 0 ? db.visibleLibraries(scope).find(item => item.id === id) : undefined;
    if (!library) return reply.code(404).send({error:'Library not found.'});
    const label = libraryName(request.body?.label), folder = libraryFolder(request.body?.folder === undefined ? '' : request.body.folder);
    if (folder && !db.getFolders(scope).some(item => item.library_id === id && (item.folder === folder || item.folder.startsWith(folder+'/'))))
      return reply.code(404).send({error:'Folder not found.'});
    db.renameLibrary(id,label,folder);
    return namedLibraries(scope).find(item => item.id === id);
  });
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
    assertSeparateCache(config.dataDir,[path]);
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
  app.get<{ Querystring: { search?: string; kind?: MediaKind; limit?: string; offset?: string; libraryId?: string; folder?: string; sort?: string; seed?:string; liked?: string } }>('/api/media', async (request) => {
    const q = request.query;
    return db.listMedia({
      search: q.search?.slice(0, 200),
      kind: q.kind,
      limit: q.limit ? Number(q.limit) : 100,
      offset: q.offset ? Number(q.offset) : 0,
      libraryId: q.libraryId ? Number(q.libraryId) : undefined,
      folder: q.folder !== undefined ? q.folder.slice(0, 4096) : undefined,
      sort: (SORT_KEYS as string[]).includes(q.sort ?? '') ? q.sort as SortKey : 'title',
      seed: q.seed===undefined?undefined:Number(q.seed),
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
    const media = mediaResource(request);
    const info = await probePlaybackInfo(media.path,{owner:String(request.account!.id),scope:resolve(config.dataDir)});
    mediaResource(request);
    if (!info) return reply.code(503).send({ error: 'ffprobe is required to inspect audio and subtitle tracks.' });
    return info;
  });
  app.post<{ Params: { id: string }; Body: { audioStream?: number; startTime?: number } }>('/api/media/:id/transcode/start', async (request, reply) => {
    let media = mediaResource(request);
    const audioStream = request.body?.audioStream;
    const startTime=request.body?.startTime;
    if(startTime!==undefined&&(!Number.isFinite(startTime)||startTime<0||(media.duration&&startTime>=media.duration)))return reply.code(400).send({error:'Invalid seek position.'});
    const info=await probePlaybackInfo(media.path,{owner:String(request.account!.id),scope:resolve(config.dataDir)});
    media=mediaResource(request);
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
    let media=mediaResource(request);
    const startTime=request.body?.startTime;
    if(startTime!==undefined&&(!Number.isFinite(startTime)||startTime<0||(media.duration&&startTime>=media.duration)))return reply.code(400).send({error:'Invalid seek position.'});
    const info=await probePlaybackInfo(media.path,{owner:String(request.account!.id),scope:resolve(config.dataDir)});
    media=mediaResource(request);
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
    let media = mediaResource(request);
    const audioStream = request.body?.audioStream;
    if (!Number.isInteger(audioStream) || Number(audioStream) < 0) return reply.code(400).send({ error: 'Invalid audio stream.' });
    const info = await probePlaybackInfo(media.path,{owner:String(request.account!.id),scope:resolve(config.dataDir)});
    media=mediaResource(request);
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
    let media = mediaResource(request);
    const subtitleStream = Number(request.params.stream);
    if (!Number.isInteger(subtitleStream) || subtitleStream < 0) return reply.code(400).send({ error: 'Invalid subtitle stream.' });
    const info = await probePlaybackInfo(media.path,{owner:String(request.account!.id),scope:resolve(config.dataDir)});
    media=mediaResource(request);
    const track = info?.subtitleTracks.find((candidate) => candidate.index === subtitleStream);
    if (!track) return reply.code(404).send({ error: 'Subtitle stream not found.' });
    if (!track.supported) return reply.code(415).send({ error: 'This subtitle format cannot be converted to WebVTT.' });
    try {
      const subtitle = await extractSubtitleVtt(config.dataDir, media.id, media.path, subtitleStream,String(request.account!.id));
      mediaResource(request);
      generatedFileInfo(subtitle.path,resolve(config.dataDir,'cache'));
      return reply.type('text/vtt; charset=utf-8').header('Cache-Control','private, max-age=86400').send(createReadStream(subtitle.path));
    } catch (error) {
      if(error instanceof AccountError)throw error;
      if(error instanceof MediaBusyError)return reply.code(503).header('Retry-After','1').send({error:error.message});
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
    const media = mediaResource(request);
    const path = request.params.kind === 'poster' ? media.poster_path : request.params.kind === 'backdrop' ? media.backdrop_path : media.thumbnail_path;
    if (!path) return reply.code(404).send();
    let actual:string|null=null;
    for(const folder of ['thumbnails','artwork'])try{generatedFileInfo(path,resolve(config.dataDir,folder));actual=path;break;}catch{}
    if(!actual){
      const library=db.visibleLibraries().find(library=>library.id===media.library_id);
      actual=library?resolveLibraryFile(path,library.path):null;
      if(actual&&db.libraryForPath(actual)?.id!==media.library_id)actual=null;
    }
    if(!actual)return reply.code(404).send();
    reply.header('Cache-Control', 'private, no-store').type(contentType(actual));
    return reply.send(createReadStream(actual));
  });

  app.get<{ Params: { id: string } }>('/api/media/:id/stream', async (request, reply) => {
    const media = mediaResource(request);
    const info = await stat(media.path);
    mediaResource(request);
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
    mediaResource(request);
    const {id,stamp,mode,audio}=request.params,resource=request.params['*'];
    const prefix=`/playback/${id}/${stamp}/${mode}/${audio}`;
    const manifest=demandManifest(config.dataDir,prefix,resource);
    if(manifest!==null)return reply.type('application/vnd.apple.mpegurl').header('Cache-Control','no-store').send(manifest);
    if(!/^(?:\d+\/)?segment-\d+\.ts$/.test(resource))return reply.code(404).send({error:'Playback resource not found.'});
    const controller=new AbortController();
    const abort=()=>{if(!reply.raw.writableFinished)controller.abort();};reply.raw.once('close',abort);
    try{
      const segment=await demandSegment(config.dataDir,prefix,resource,controller.signal,String(request.account!.id));
      try{mediaResource(request);generatedFileInfo(segment.path,resolve(config.dataDir,'cache'));}
      catch(error){segment.release();throw error;}
      if(controller.signal.aborted){segment.release();return reply;}
      reply.raw.once('close',segment.release);
      return reply.type('video/mp2t').header('Cache-Control','private, max-age=3600').send(createReadStream(segment.path));
    }catch(reason){if(controller.signal.aborted)return reply;if(reason instanceof AccountError)throw reason;if(reason instanceof MediaBusyError)reply.header('Retry-After','1');return reply.code(503).send({error:reason instanceof Error?reason.message:'Playback segment is unavailable.'});}
  });
  for(const bucket of ['hls','audio'])await app.register(fastifyStatic, {
    root:resolve(config.dataDir,'cache',bucket),prefix:`/${bucket}/`,wildcard:true,decorateReply:false,cacheControl:false,
    allowedPath(pathname,root,request){
      if(!root)return false;
      try{mediaResource(request);generatedFileInfo(resolve(root,'.'+pathname),resolve(config.dataDir,'cache'));return true;}catch{return false;}
    }
  });
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
