import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, readdir, readFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startAdaptiveTranscode, stopAllTranscodes, transcodeStatus, startHlsTranscode } from '../dist/transcode.js';
import { mediaPlaylist, demandManifest, demandSegment, clearPlaybackCache } from '../dist/demand-playback.js';
import { DemandCache } from '../dist/demand-cache.js';
import { hasFfmpeg } from '../dist/ffmpeg.js';

test('VOD playlists address a whole film without generating missing video files',()=>{
  const playlist=mediaPlaylist(7041);
  assert.ok(playlist.includes('#EXT-X-PLAYLIST-TYPE:VOD'));
  assert.ok(playlist.includes('segment-474.ts'));assert.ok(playlist.includes('#EXTINF:3.000000,\nsegment-1173.ts'));
  assert.ok(playlist.includes('#EXT-X-ENDLIST'));assert.ok(!playlist.includes('GAP'));
  for(const duration of [0,NaN,Infinity,-1,7*86400+1])assert.throws(()=>mediaPlaylist(duration));
});
test('legacy whole-film playlists are never reused as demand caches',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-legacy-'));
  try{
    const dir=join(root,'cache','hls','1','default');await mkdir(dir,{recursive:true});
    await writeFile(join(dir,'index.m3u8'),'#EXTM3U\n#EXTINF:2,\nsegment-0.ts\n#EXT-X-ENDLIST\n');
    await writeFile(join(dir,'segment-0.ts'),'old');assert.equal(transcodeStatus(root,1).status,'idle');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('LRU enforces the shared budget, preserves pinned segments and never touches source or DB',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-cache-budget-'));
  try{
    const dir=join(root,'cache','hls');await mkdir(dir,{recursive:true});
    const old=join(dir,'segment-0.ts'),active=join(dir,'segment-1.ts'),recent=join(dir,'segment-2.ts');
    for(const file of [old,active,recent])await writeFile(file,Buffer.alloc(100));
    await utimes(old,new Date(1000),new Date(1000));await utimes(active,new Date(2000),new Date(2000));
    await writeFile(join(root,'virelo.db'),'database');await writeFile(join(root,'original.mkv'),'original');
    await writeFile(join(dir,'unrelated.mp4'),'not a generated cache file');
    const cache=new DemandCache(root,200),release=cache.pin(active);await cache.prune();
    assert.equal(cache.bytes,200);await assert.rejects(stat(old));assert.ok(await stat(active));
    await assert.rejects(cache.prune(150),/cache is busy/);release();await cache.prune(150);assert.equal(cache.bytes,0);
    assert.equal(await readFile(join(root,'virelo.db'),'utf8'),'database');assert.equal(await readFile(join(root,'original.mkv'),'utf8'),'original');
    assert.equal(await readFile(join(dir,'unrelated.mp4'),'utf8'),'not a generated cache file');
    assert.throws(()=>cache.pin(join(root,'virelo.db')),/Invalid cache path/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('preparation creates no renditions; real conversion generates only requested six-second segments',async t=>{
  if(!(await hasFfmpeg()))return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-demand-'));
  try{
    const source=join(root,'source.mkv');
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=320x180:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','19.7','-c:v','libx264','-preset','ultrafast','-c:a','ac3',source],{windowsHide:true});
    const qualities=[{height:180,label:'180p',bitrate:500000},{height:90,label:'90p',bitrate:250000}];
    const result=await startAdaptiveTranscode(root,2,source,{hasAudio:true,sourceWidth:320,sourceHeight:180,qualities,duration:19.7});
    assert.equal(result.status,'ready');assert.equal(result.startTime,0);assert.equal(result.bufferedUntil,19.7);
    assert.deepEqual(await readdir(join(root,'cache')).catch(()=>[]),[]);
    const prefix=result.playlist.replace('/master.m3u8','');assert.ok(demandManifest(root,prefix,'master.m3u8').includes('180/index.m3u8'));
    const signal=new AbortController().signal;
    const [a,b]=await Promise.all([demandSegment(root,prefix,'90/segment-0.ts',signal),demandSegment(root,prefix,'90/segment-0.ts',signal)]);
    assert.equal(a.path,b.path);assert.ok((await stat(a.path)).size>0);a.release();b.release();
    const directory=join(a.path,'..');assert.deepEqual(await readdir(directory),['segment-0.ts']);
    await assert.rejects(stat(join(directory,'..','180')));
    const late=await demandSegment(root,prefix,'90/segment-2.ts',signal);late.release();
    assert.deepEqual((await readdir(directory)).sort(),['segment-0.ts','segment-2.ts']);
    const pts=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','quiet','-show_format','-of','json',late.path],{encoding:'utf8',windowsHide:true})).format;
    assert.ok(Math.abs(Number(pts.start_time)-12)<.1);assert.ok(Number(pts.duration)<6.2);
    await assert.rejects(demandSegment(root,prefix,'720/segment-0.ts',signal),/rendition/);
    await assert.rejects(demandSegment(root,prefix,'90/segment-999.ts',signal),/segment/);
    const aborted=new AbortController();aborted.abort();await assert.rejects(demandSegment(root,prefix,'90/segment-1.ts',aborted.signal),/cancelled/);
    const silentSource=join(root,'silent.mp4');
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','error','-i',source,'-c:v','copy','-an',silentSource],{windowsHide:true});
    const silent=await startAdaptiveTranscode(root,4,silentSource,{hasAudio:false,sourceWidth:320,sourceHeight:180,qualities,duration:19.7});
    const silentSegment=await demandSegment(root,silent.playlist.replace('/master.m3u8',''),'90/segment-0.ts',signal);
    assert.ok((await stat(silentSegment.path)).size>0);
    const cleaned=await clearPlaybackCache(root,()=>{});
    assert.ok(cleaned.deletedFiles>=2);assert.ok((await stat(silentSegment.path)).size>0,'active playback survives cleanup');
    silentSegment.release();
    assert.equal((await clearPlaybackCache(root,()=>{})).deletedFiles,1);
    await assert.rejects(stat(silentSegment.path));
    const regenerated=await demandSegment(root,silent.playlist.replace('/master.m3u8',''),'90/segment-0.ts',signal);
    assert.ok((await stat(regenerated.path)).size>0,'cleared segments regenerate without a new session');regenerated.release();
  }finally{await stopAllTranscodes(root);await rm(root,{recursive:true,force:true});}
});
test('missing sources report a preparation error without starting endless jobs',async t=>{
  if(!(await hasFfmpeg()))return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-demand-error-'));
  try{assert.equal((await startHlsTranscode(root,3,join(root,'missing.mp4'))).status,'error');assert.equal(transcodeStatus(root,3).status,'error');}
  finally{await stopAllTranscodes(root);await rm(root,{recursive:true,force:true});}
});
