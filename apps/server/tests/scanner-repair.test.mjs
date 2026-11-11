import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { scanLibrary } from '../dist/scanner.js';
import { hasFfmpeg, hasFfprobe, makeThumbnail } from '../dist/ffmpeg.js';
import { refreshMissingMetadata } from '../dist/metadata.js';
import { Accounts, hashPassword } from '../dist/accounts.js';

const status=()=>({running:true,total:0,scanned:0,added:0,updated:0,skipped:0,thumbnailsGenerated:0,thumbnailsRepaired:0,errors:0,message:''});
const fingerprint=async path=>({sha256:createHash('sha256').update(await readFile(path)).digest('hex'),mtime:(await stat(path)).mtimeMs});
async function fixture(t){
  if(!await hasFfmpeg()||!await hasFfprobe()){t.skip('FFmpeg and ffprobe are required');return;}
  const root=await mkdtemp(join(tmpdir(),'virelo-rescan-repair-')),data=join(root,'data'),media=join(root,'media');
  await mkdir(data);await mkdir(media);
  const source=join(media,'Example.mp4');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x334455:s=320x180:r=5:d=4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source],{windowsHide:true});
  const db=new VireloDB(data),library=db.addLibrary(media,'Media');
  db.updateSettings({externalMetadataEnabled:false,libraryWatchEnabled:false});
  t.after(async()=>{db.close();await rm(root,{recursive:true,force:true});});
  const scan=async()=>{const result=status();await scanLibrary(db,library,data,result);return result;};
  const initial=await scan();assert.equal(initial.added,1);assert.equal(initial.thumbnailsGenerated,1);assert.equal(initial.thumbnailsRepaired,0);assert.equal(initial.errors,0);
  assert.match(initial.message,/^Generating thumbnail · Example\.mp4$/);
  const item=db.getMediaByPath(source);
  return {root,data,media,source,db,library,item,scan};
}

test('rescan restores deleted and empty thumbnails for unchanged videos while preserving media and personal state',async t=>{
  const f=await fixture(t);if(!f)return;
  const {db,item,source,scan}=f;
  db.updateExternalMetadata(item.id,{title:'Matched title',year:2024,overview:'Keep this summary',external_id:'cinemeta:movie:fixture'});
  db.setLike(item.id,true);db.setProgress(item.id,2,4);
  const playbackCache=join(f.data,'cache','hls',String(item.id),'default');await mkdir(playbackCache,{recursive:true});
  await writeFile(join(playbackCache,'index.m3u8'),'keep active playback');
  const before=db.getMedia(item.id),original=await fingerprint(source),healthy=await fingerprint(item.thumbnail_path);
  const skipped=await scan();assert.equal(skipped.skipped,1);assert.equal(skipped.thumbnailsRepaired,0);
  assert.deepEqual(await fingerprint(item.thumbnail_path),healthy,'healthy thumbnails are not rewritten');
  for(const damage of ['deleted','empty']){
    if(damage==='deleted')await rm(item.thumbnail_path);else await writeFile(item.thumbnail_path,'');
    const repaired=await scan();assert.equal(repaired.scanned,1);assert.equal(repaired.updated,1);assert.equal(repaired.thumbnailsGenerated,0);assert.equal(repaired.thumbnailsRepaired,1);assert.equal(repaired.errors,0);
    assert.match(repaired.message,/^Restoring thumbnail · Example\.mp4$/);
    const after=db.getMedia(item.id);
    for(const key of ['id','path','size','mtime','added_at','title','year','overview','external_id','liked','progress_position','progress_duration'])assert.equal(after[key],before[key],key+' is preserved');
    assert.ok(after.metadata_revision>before.metadata_revision,'image URL changes so failed browser images can retry');
    assert.ok((await stat(after.thumbnail_path)).size>0);
    assert.deepEqual(await fingerprint(source),original,'source content and timestamp never change');
    assert.equal(await readFile(join(playbackCache,'index.m3u8'),'utf8'),'keep active playback','thumbnail-only repair never clears playback cache');
  }
});

test('indexed videos without a previous thumbnail reference still report initial generation',async t=>{
  const f=await fixture(t);if(!f)return;
  await rm(f.item.thumbnail_path);
  f.db.db.prepare('UPDATE media SET thumbnail_path=NULL WHERE id=?').run(f.item.id);
  const original=await fingerprint(f.source),generated=await f.scan();
  assert.match(generated.message,/^Generating thumbnail · Example\.mp4$/);
  assert.equal(generated.added,0);assert.equal(generated.thumbnailsGenerated,1);assert.equal(generated.thumbnailsRepaired,0);
  assert.deepEqual(await fingerprint(f.source),original);
});

test('real TS recordings still receive technical details and thumbnails',async t=>{
  const f=await fixture(t);if(!f)return;
  const recording=join(f.media,'Recording.ts');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-i',f.source,'-c','copy','-f','mpegts',recording],{windowsHide:true});
  const original=await fingerprint(recording),result=await f.scan(),item=f.db.getMediaByPath(recording);
  assert.equal(result.added,1);assert.equal(result.errors,0);assert.equal(result.scanned,2);
  assert.equal(item.video_codec,'h264');assert.ok(item.duration>0);assert.ok((await stat(item.thumbnail_path)).size>0);
  assert.deepEqual(await fingerprint(recording),original);
});

test('rescan recreates a removed thumbnail directory and missing technical details',async t=>{
  const f=await fixture(t);if(!f)return;
  await rm(join(f.data,'thumbnails'),{recursive:true});
  f.db.db.prepare('UPDATE media SET duration=NULL,width=NULL,height=NULL,video_codec=NULL WHERE id=?').run(f.item.id);
  const repaired=await f.scan();assert.equal(repaired.updated,1);assert.equal(repaired.thumbnailsRepaired,1);
  const item=f.db.getMedia(f.item.id);
  assert.equal(item.width,320);assert.equal(item.height,180);assert.equal(item.video_codec,'h264');assert.ok(item.duration>0);
  assert.deepEqual(await readdir(join(f.data,'thumbnails')),[`${item.id}.jpg`],'temporary output is cleaned up');
  const next=await f.scan();assert.equal(next.skipped,1);assert.equal(next.thumbnailsRepaired,0,'silent videos do not endlessly reprobe a missing audio track');
});

test('changed videos refresh their thumbnail without deleting old cache folders or personal state',async t=>{
  const f=await fixture(t);if(!f)return;
  const before=await fingerprint(f.item.thumbnail_path);
  f.db.setLike(f.item.id,true);f.db.setProgress(f.item.id,2,4);
  const cache=join(f.data,'cache','hls',String(f.item.id));await mkdir(cache,{recursive:true});
  await writeFile(join(cache,'notes.txt'),'not a generated file');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=640x360:r=5:d=4','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',f.source],{windowsHide:true});
  const original=await fingerprint(f.source),result=await f.scan(),after=f.db.getMedia(f.item.id);
  assert.notEqual((await fingerprint(after.thumbnail_path)).sha256,before.sha256,'the thumbnail follows the changed source');
  assert.equal(after.width,640);assert.equal(after.liked,1);assert.equal(after.progress_position,2);
  assert.deepEqual(await fingerprint(f.source),original);
  assert.equal(await readFile(join(cache,'notes.txt'),'utf8'),'not a generated file');
  assert.equal(result.errors,0);
});

test('rescanning a changed file never recursively deletes through a legacy cache junction',async t=>{
  const f=await fixture(t);if(!f)return;
  const originals=join(f.root,'originals'),protectedFolder=join(originals,String(f.item.id)),file=join(protectedFolder,'Original.mp4');
  await mkdir(protectedFolder,{recursive:true});await writeFile(file,'original video bytes');
  await mkdir(join(f.data,'cache'));await symlink(originals,join(f.data,'cache','hls'),process.platform==='win32'?'junction':'dir');
  f.db.db.prepare('UPDATE media SET mtime=0 WHERE id=?').run(f.item.id);
  const before=await fingerprint(file);await f.scan();assert.deepEqual(await fingerprint(file),before);
});

test('progress counts completed videos, and failed thumbnails are not counted as skipped',async t=>{
  const f=await fixture(t);if(!f)return;
  await rm(f.item.thumbnail_path);
  const result=status(),observed=[];let message='';
  Object.defineProperty(result,'message',{get:()=>message,set:value=>{message=value;if(value.startsWith('Restoring thumbnail'))observed.push(result.scanned);}});
  await scanLibrary(f.db,f.library,f.data,result);
  assert.deepEqual(observed,[0]);assert.equal(result.scanned,1);
  await rm(f.item.thumbnail_path);await writeFile(f.source,'invalid video');
  await f.scan();
  const failed=await f.scan();assert.equal(failed.errors,1);assert.equal(failed.skipped,0);assert.equal(failed.scanned,1);
});

test('rescans detect nonempty corrupt and truncated image containers',async t=>{
  const f=await fixture(t);if(!f)return;
  const valid=await readFile(f.item.thumbnail_path);
  for(const damaged of [Buffer.from('not an image'),valid.subarray(0,valid.length-20)]){
    await writeFile(f.item.thumbnail_path,damaged);
    const result=await f.scan();assert.equal(result.thumbnailsRepaired,1);assert.equal(result.errors,0);
    assert.deepEqual(await readFile(f.item.thumbnail_path),valid);
  }
});

test('videos shorter than one tenth of a second still get a thumbnail',async t=>{
  const f=await fixture(t);if(!f)return;
  const source=join(f.media,'Tiny.mp4');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=red:s=160x90:r=25:d=0.04','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source],{windowsHide:true});
  const result=await f.scan();assert.equal(result.added,1);assert.equal(result.errors,0);assert.equal(result.thumbnailsGenerated,1);
  assert.ok((await stat(f.db.getMediaByPath(source).thumbnail_path)).size>0);
});

test('a failed refresh cannot leave an old thumbnail permanently trusted',async t=>{
  const f=await fixture(t);if(!f)return;
  const command=process.env.FFMPEG_PATH;
  f.db.db.prepare('UPDATE media SET mtime=0 WHERE id=?').run(f.item.id);
  try{
    process.env.FFMPEG_PATH=join(f.root,'unavailable-ffmpeg');
    const failed=await f.scan();assert.equal(failed.errors,1);assert.equal(f.db.getMedia(f.item.id).thumbnail_path,null);
  }finally{if(command===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=command;}
  const retried=await f.scan();assert.equal(retried.errors,0);assert.equal(retried.thumbnailsGenerated,1);
  assert.ok(f.db.getMedia(f.item.id).thumbnail_path);
});

test('failed probing of a changed source leaves technical details retryable rather than restoring stale dimensions',async t=>{
  const f=await fixture(t);if(!f)return;
  const command=process.env.FFPROBE_PATH;
  f.db.db.prepare('UPDATE media SET mtime=0 WHERE id=?').run(f.item.id);
  try{
    process.env.FFPROBE_PATH=join(f.root,'unavailable-ffprobe');
    await f.scan();assert.equal(f.db.getMedia(f.item.id).width,null);
  }finally{if(command===undefined)delete process.env.FFPROBE_PATH;else process.env.FFPROBE_PATH=command;}
  await f.scan();assert.equal(f.db.getMedia(f.item.id).width,320);
});

test('Windows rescans repair every historical path alias without losing IDs or personal state',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);if(!f)return;
  const columns=f.db.db.prepare('PRAGMA table_info(media)').all().map(column=>column.name).filter(name=>!['id','path'].includes(name));
  const duplicateId=Number(f.db.db.prepare(`INSERT INTO media(path,${columns.join(',')}) SELECT ?,${columns.join(',')} FROM media WHERE id=?`)
    .run(f.source.toLowerCase(),f.item.id).lastInsertRowid);
  const missing=join(f.data,'thumbnails',duplicateId+'.jpg');
  f.db.db.prepare('UPDATE media SET thumbnail_path=?,metadata_revision=0 WHERE id=?').run(missing,duplicateId);
  const accounts=new Accounts(f.db.db),owner=accounts.save({username:'owner'},await hashPassword('1'),undefined,true);
  f.db.setLike(f.item.id,true);f.db.setProgress(f.item.id,1,4);
  f.db.setLike(duplicateId,true,owner.id);
  f.db.db.prepare('INSERT INTO user_progress(user_id,media_id,position,duration,completed,updated_at) VALUES(?,?,20,60,0,?)').run(owner.id,duplicateId,Date.now());
  const personal=()=>JSON.stringify(['progress','likes','user_progress','user_likes'].map(table=>f.db.db.prepare(`SELECT * FROM ${table} ORDER BY media_id`).all()));
  const before=personal(),original=await fingerprint(f.source),image=await fingerprint(f.item.thumbnail_path);
  const resumed=f.db.getHome(accounts.scope(owner)).continueWatching;
  assert.equal(resumed.length,1);assert.equal(resumed[0].id,f.item.id);assert.equal(resumed[0].progress_position,20,'history on the alias remains visible on the single catalog card');
  const existing=await f.scan();assert.equal(existing.thumbnailsRepaired,1);assert.equal(existing.updated,1);assert.equal(existing.errors,0);
  assert.equal(f.db.getMedia(duplicateId).thumbnail_path,f.item.thumbnail_path,'a healthy image is shared without re-encoding');
  assert.deepEqual(await fingerprint(f.item.thumbnail_path),image);
  await rm(f.item.thumbnail_path);
  const rebuilt=await f.scan();assert.equal(rebuilt.thumbnailsRepaired,1);assert.equal(rebuilt.errors,0);
  for(const id of [f.item.id,duplicateId]){
    const item=f.db.getMedia(id);assert.equal(item.id,id);assert.equal(item.thumbnail_path,f.item.thumbnail_path);
    assert.ok(item.metadata_revision>0);assert.ok((await stat(item.thumbnail_path)).size>0);
  }
  assert.equal(personal(),before,'both legacy and per-account histories and favorites are untouched');
  assert.deepEqual(await fingerprint(f.source),original);
  const healthy=await f.scan();assert.equal(healthy.skipped,1);assert.equal(healthy.thumbnailsRepaired,0);
});

test('Windows upserts reuse the existing spelling instead of inserting case-variant media IDs',{skip:process.platform!=='win32'},async t=>{
  const f=await fixture(t);if(!f)return;
  const repeated=f.db.upsertMedia({...f.item,path:f.source.toUpperCase()});
  assert.equal(repeated.id,f.item.id);assert.equal(repeated.path,f.item.path);
  assert.equal(f.db.db.prepare('SELECT COUNT(*) AS total FROM media').get().total,1);
});

test('case-sensitive platforms never share images between distinct filenames',{skip:process.platform==='win32'},async t=>{
  const f=await fixture(t);if(!f)return;
  const other=f.db.upsertMedia({...f.item,path:join(f.media,'example.mp4'),thumbnail_path:null});
  assert.notEqual(other.id,f.item.id);
  f.db.shareThumbnail(f.item.path,f.item.thumbnail_path,true);
  assert.equal(f.db.getMedia(other.id).thumbnail_path,null);
});

test('thumbnail failures are counted, stay retryable, and never leave a partial successful image',async t=>{
  const f=await fixture(t);if(!f)return;
  const thumbnail=f.item.thumbnail_path;await rm(thumbnail);
  await writeFile(f.source,'not a playable video');
  const original=await fingerprint(f.source),failed=await f.scan();
  assert.equal(failed.errors,1);assert.equal(failed.thumbnailsRepaired,0);await assert.rejects(stat(thumbnail));
  assert.deepEqual(await readdir(join(f.data,'thumbnails')),[]);
  assert.deepEqual(await fingerprint(f.source),original);
  const second=await f.scan();assert.equal(second.errors,1);assert.equal(second.thumbnailsRepaired,0);
  assert.equal(await makeThumbnail(f.source,thumbnail,4),false);await assert.rejects(stat(thumbnail));
});

test('thumbnail repair never follows a generated-folder junction into original media folders',async t=>{
  const f=await fixture(t);if(!f)return;
  const original=await fingerprint(f.source);
  await rm(join(f.data,'thumbnails'),{recursive:true});
  await symlink(f.media,join(f.data,'thumbnails'),process.platform==='win32'?'junction':'dir');
  const failed=await f.scan();assert.equal(failed.errors,1);assert.equal(failed.thumbnailsRepaired,0);
  assert.deepEqual(await readdir(f.media),['Example.mp4']);assert.deepEqual(await fingerprint(f.source),original);
});

test('rescan repairs missing downloaded artwork only when enabled and respects cleared metadata',async t=>{
  const f=await fixture(t);if(!f)return;
  const previousFetch=globalThis.fetch,previousKey=process.env.VIRELO_TMDB_API_KEY;delete process.env.VIRELO_TMDB_API_KEY;
  let requests=0;
  globalThis.fetch=async input=>{
    requests++;const url=String(input);
    if(url.includes('/catalog/movie/'))return Response.json({metas:[{id:'fixture',name:'Example'}]});
    if(url.endsWith('/meta/movie/fixture.json'))return Response.json({meta:{id:'fixture',name:'Example',poster:'https://images.example/poster.jpg',background:'https://images.example/backdrop.jpg'}});
    if(url.startsWith('https://images.example/'))return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=','base64'),{headers:{'content-type':'image/png'}});
    throw Error('Unexpected request: '+url);
  };
  try{
    f.db.updateSettings({externalMetadataEnabled:true});
    assert.equal((await refreshMissingMetadata(f.db,f.data)).updated,1);
    let item=f.db.getMedia(f.item.id);assert.ok(item.poster_path&&item.backdrop_path);
    await rm(join(f.data,'artwork'),{recursive:true});
    f.db.updateSettings({externalMetadataEnabled:false});
    const baseline=requests;await f.scan();await refreshMissingMetadata(f.db,f.data);
    assert.equal(requests,baseline,'offline scans never contact a provider');
    item=f.db.getMedia(f.item.id);assert.equal(item.poster_path,null);assert.equal(item.backdrop_path,null);
    assert.equal(item.external_id,'cinemeta:movie:fixture','missing artwork does not discard the metadata match');
    f.db.updateSettings({externalMetadataEnabled:true});
    assert.equal((await refreshMissingMetadata(f.db,f.data)).updated,1);
    item=f.db.getMedia(f.item.id);assert.ok((await stat(item.poster_path)).size>0);assert.ok((await stat(item.backdrop_path)).size>0);
    await writeFile(item.poster_path,'');await f.scan();
    assert.equal((await refreshMissingMetadata(f.db,f.data)).updated,1);assert.ok((await stat(item.poster_path)).size>0,'empty downloaded images are fetched again');
    f.db.clearAllExternalMetadata();
    const afterClear=requests;await f.scan();assert.equal((await refreshMissingMetadata(f.db,f.data)).attempted,0);
    assert.equal(requests,afterClear);assert.equal(f.db.getMedia(item.id).metadata_blocked,1);
  }finally{
    globalThis.fetch=previousFetch;
    if(previousKey===undefined)delete process.env.VIRELO_TMDB_API_KEY;else process.env.VIRELO_TMDB_API_KEY=previousKey;
  }
});
