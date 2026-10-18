import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVireloServer, startServer } from '../dist/server.js';
import { authenticatedInjector } from './auth-helper.mjs';

const packageMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

test('clearing metadata through the API keeps the file, likes and progress', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'virelo-reset-api-'));
  let app;
  try {
    const server = await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
    app = server.app;
    const db = server.db;
    const library = db.addLibrary(dataDir, 'Audit');
    const media = db.upsertMedia({
      library_id:library.id,path:join(dataDir,'Arrival (2016).mp4'),filename:'Arrival (2016).mp4',
      title:'Wrong match',sort_title:'wrong match',kind:'movie',series_title:null,season:null,episode:null,
      year:2000,duration:120,width:1920,height:1080,video_codec:'h264',audio_codec:'aac',container:'mp4',
      folder:'',size:123,mtime:1,thumbnail_path:'generated.jpg',poster_path:'matched.jpg',backdrop_path:'matched-wide.jpg',
      overview:'Wrong description',genres:'Wrong genre',external_id:'wrong'
    });
    db.setLike(media.id, true);
    db.setProgress(media.id, 30, 120);
    const inject = await authenticatedInjector(app);
    const response = await inject({method:'DELETE',url:'/api/media/'+media.id+'/metadata'});
    assert.equal(response.statusCode, 200);
    const reset = response.json();
    assert.equal(reset.title, 'Arrival');
    assert.equal(reset.year, 2016);
    assert.equal(reset.external_id, null);
    assert.equal(reset.poster_path, null);
    assert.equal(reset.thumbnail_path, 'generated.jpg');
    assert.equal(reset.path, media.path);
    assert.equal(reset.liked, 1);
    assert.equal(reset.progress_position, 30);
    assert.equal(reset.metadata_blocked, 1);
    assert.equal(db.listMetadataCandidates(500, true).length, 0);
    const missing = await inject({method:'DELETE',url:'/api/media/99999/metadata'});
    assert.equal(missing.statusCode, 404);
  } finally {
    if (app) await app.close();
    await rm(dataDir, {recursive:true,force:true});
  }
});

test('bulk metadata reset includes all libraries and preserves video and personal data', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'virelo-bulk-reset-'));
  let app;
  try {
    const server = await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
    app = server.app;
    const db = server.db;
    const inject = await authenticatedInjector(app);
    assert.deepEqual((await inject({method:'DELETE',url:'/api/metadata'})).json(), {cleared:0});
    const items = [];
    for (const name of ['Arrival', 'Interstellar']) {
      const library = db.addLibrary(join(dataDir,name), name);
      const media = db.upsertMedia({
        library_id:library.id,path:join(dataDir,name,`${name} (2016).mp4`),filename:`${name} (2016).mp4`,
        title:'Wrong match',sort_title:'wrong match',kind:'movie',series_title:null,season:null,episode:null,
        year:2000,duration:120,width:1920,height:1080,video_codec:'h264',audio_codec:'aac',container:'mp4',
        folder:'',size:123,mtime:1,thumbnail_path:'generated.jpg',poster_path:'matched.jpg',backdrop_path:'matched-wide.jpg',
        overview:'Wrong description',genres:'Wrong genre',external_id:'wrong'
      });
      db.setLike(media.id,true);
      db.setProgress(media.id,30,120);
      items.push({media,name});
    }
    const response = await inject({method:'DELETE',url:'/api/metadata'});
    assert.equal(response.statusCode,200);
    assert.deepEqual(response.json(),{cleared:2});
    for (const {media,name} of items) {
      const reset = db.getMedia(media.id);
      assert.equal(reset.title,name);
      assert.equal(reset.year,2016);
      for (const key of ['overview','genres','poster_path','backdrop_path','external_id']) assert.equal(reset[key],null);
      assert.equal(reset.thumbnail_path,'generated.jpg');
      assert.equal(reset.path,media.path);
      assert.equal(reset.liked,1);
      assert.equal(reset.progress_position,30);
      assert.equal(reset.metadata_blocked,1);
      db.updateExternalMetadata(media.id,{title:'Stale result'},media.metadata_revision);
      assert.equal(db.getMedia(media.id).title,name);
    }
    assert.equal(db.listMetadataCandidates(500,true).length,0);
    assert.deepEqual((await inject({method:'DELETE',url:'/api/metadata'})).json(),{cleared:2});
  } finally {
    if (app) await app.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});

test('health remains available when FFmpeg tools cannot be started', async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-server-test-'));
  const dataDir = join(root, 'data');
  const mediaDir = join(root, 'media');
  await Promise.all([
    mkdir(join(dataDir, 'cache', 'hls'), { recursive: true }),
    mkdir(join(dataDir, 'thumbnails'), { recursive: true }),
    mkdir(join(dataDir, 'artwork'), { recursive: true }),
    mkdir(mediaDir, { recursive: true })
  ]);
  const previousFfmpeg = process.env.FFMPEG_PATH;
  const previousFfprobe = process.env.FFPROBE_PATH;
  const previousLogLevel = process.env.VIRELO_LOG_LEVEL;
  process.env.FFMPEG_PATH = join(root, 'missing-ffmpeg');
  process.env.FFPROBE_PATH = join(root, 'missing-ffprobe');
  process.env.VIRELO_LOG_LEVEL = 'silent';
  let app;
  try {
    ({ app } = await createVireloServer({
      dataDir,
      host: '127.0.0.1',
      port: 41777,
      mediaPaths: [mediaDir]
    }));
    const inject = await authenticatedInjector(app);
    const response = await inject({ method: 'GET', url: '/api/health' });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      ok: true,
      version: packageMetadata.version,
      ffmpeg: false,
      ffprobe: false,
      scan: {
        running: false,
        startedAt: null,
        finishedAt: null,
        total: 0,
        scanned: 0,
        added: 0,
        updated: 0,
        skipped: 0,
        thumbnailsRepaired: 0,
        errors: 0,
        message: 'Idle'
      }
    });
  } finally {
    if (app) await app.close();
    if (previousFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpeg;
    if (previousFfprobe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousFfprobe;
    if (previousLogLevel === undefined) delete process.env.VIRELO_LOG_LEVEL;
    else process.env.VIRELO_LOG_LEVEL = previousLogLevel;
    await rm(root, { recursive: true, force: true });
  }
});

test('startServer reports the port selected by the OS', async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-dynamic-port-test-'));
  const dataDir = join(root, 'data');
  const mediaDir = join(root, 'media');
  await Promise.all([
    mkdir(join(dataDir, 'cache', 'hls'), { recursive: true }),
    mkdir(join(dataDir, 'thumbnails'), { recursive: true }),
    mkdir(join(dataDir, 'artwork'), { recursive: true }),
    mkdir(mediaDir, { recursive: true })
  ]);
  const previousFfmpeg = process.env.FFMPEG_PATH;
  const previousFfprobe = process.env.FFPROBE_PATH;
  const previousLogLevel = process.env.VIRELO_LOG_LEVEL;
  process.env.FFMPEG_PATH = join(root, 'missing-ffmpeg');
  process.env.FFPROBE_PATH = join(root, 'missing-ffprobe');
  process.env.VIRELO_LOG_LEVEL = 'silent';
  let app;
  let appPort;
  try {
    ({ app, port: appPort } = await startServer({
      dataDir,
      host: '127.0.0.1',
      port: 0,
      mediaPaths: [mediaDir]
    }));
    assert.ok(appPort > 0);
    assert.equal(app.server.address().port, appPort);
  } finally {
    if (app) await app.close();
    if (previousFfmpeg === undefined) delete process.env.FFMPEG_PATH;
    else process.env.FFMPEG_PATH = previousFfmpeg;
    if (previousFfprobe === undefined) delete process.env.FFPROBE_PATH;
    else process.env.FFPROBE_PATH = previousFfprobe;
    if (previousLogLevel === undefined) delete process.env.VIRELO_LOG_LEVEL;
    else process.env.VIRELO_LOG_LEVEL = previousLogLevel;
    await rm(root, { recursive: true, force: true });
  }
});
