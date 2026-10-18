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

const status=()=>({running:true,total:0,scanned:0,added:0,updated:0,skipped:0,thumbnailsRepaired:0,errors:0,message:''});
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
  const initial=await scan();assert.equal(initial.added,1);assert.equal(initial.thumbnailsRepaired,1);assert.equal(initial.errors,0);
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
    const repaired=await scan();assert.equal(repaired.scanned,1);assert.equal(repaired.updated,1);assert.equal(repaired.thumbnailsRepaired,1);assert.equal(repaired.errors,0);
    const after=db.getMedia(item.id);
    for(const key of ['id','path','size','mtime','added_at','title','year','overview','external_id','liked','progress_position','progress_duration'])assert.equal(after[key],before[key],key+' is preserved');
    assert.ok(after.metadata_revision>before.metadata_revision,'image URL changes so failed browser images can retry');
    assert.ok((await stat(after.thumbnail_path)).size>0);
    assert.deepEqual(await fingerprint(source),original,'source content and timestamp never change');
    assert.equal(await readFile(join(playbackCache,'index.m3u8'),'utf8'),'keep active playback','thumbnail-only repair never clears playback cache');
  }
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
    if(url.startsWith('https://images.example/'))return new Response(new Uint8Array([255,216,255,217]),{headers:{'content-type':'image/jpeg'}});
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
