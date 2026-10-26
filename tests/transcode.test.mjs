import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, stat, readdir, readFile, utimes, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { extractSubtitleVtt, startAdaptiveTranscode, stopAllTranscodes, transcodeStatus, startHlsTranscode } from '../dist/transcode.js';
import { mediaPlaylist, demandManifest, demandSegment, clearPlaybackCache, SEGMENT_SECONDS } from '../dist/demand-playback.js';
import { DemandCache } from '../dist/demand-cache.js';
import { hasFfmpeg } from '../dist/ffmpeg.js';

test('VOD playlists address a whole film without generating missing video files',()=>{
  const playlist=mediaPlaylist(7041);
  assert.ok(playlist.includes('#EXT-X-PLAYLIST-TYPE:VOD'));
  assert.ok(playlist.includes('segment-474.ts'));assert.ok(playlist.includes('#EXTINF:1.000000,\nsegment-3520.ts'));
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
test('preparation creates no renditions; real conversion generates only requested short segments',async t=>{
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
    assert.ok(Math.abs(Number(pts.start_time)-2*SEGMENT_SECONDS)<.1);assert.ok(Number(pts.duration)<SEGMENT_SECONDS+.2);
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
test('a new segment cache never writes through a junction created after cache initialization',async t=>{
  if(!await hasFfmpeg())return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-segment-links-'));
  try{
    const original=join(root,'originals');await mkdir(original);const source=join(original,'source.mkv');await writeFile(source,'Original data stays untouched');
    const state=await startAdaptiveTranscode(root,5,source,{hasAudio:false,sourceWidth:160,sourceHeight:90,qualities:[{height:90,label:'90p',bitrate:250000}],duration:1});
    await mkdir(join(root,'cache'),{recursive:true});
    try{await symlink(original,join(root,'cache','segments-v2'),process.platform==='win32'?'junction':'dir');}
    catch(error){if(error.code==='EPERM')return t.skip('Filesystem links unavailable');throw error;}
    await assert.rejects(demandSegment(root,state.playlist.replace('/master.m3u8',''),'90/segment-0.ts',new AbortController().signal),/filesystem links/);
    assert.equal(await readFile(source,'utf8'),'Original data stays untouched');assert.deepEqual(await readdir(original),['source.mkv']);
  }finally{await stopAllTranscodes(root);await rm(root,{recursive:true,force:true});}
});

test('missing sources report a preparation error without starting endless jobs',async t=>{
  if(!(await hasFfmpeg()))return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-demand-error-'));
  try{assert.equal((await startHlsTranscode(root,3,join(root,'missing.mp4'))).status,'error');assert.equal(transcodeStatus(root,3).status,'error');}
  finally{await stopAllTranscodes(root);await rm(root,{recursive:true,force:true});}
});

test('compatible segments copy aligned H264 GOPs exactly, and safely encode other boundaries',{timeout:30000},async t=>{
  if(!await hasFfmpeg())return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-copy-video-')),spawn=childProcess.spawn,encoders=[];
  const generate=(name,gop,bframes=0)=>{
    const path=join(root,name);
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=320x180:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-preset','ultrafast','-threads','2','-g',String(gop),'-keyint_min',String(gop),'-sc_threshold','0','-bf',String(bframes),'-c:a','aac',path],{windowsHide:true});
    return path;
  };
  const hashes=(path,start=0)=>execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-threads','2','-ss',String(start),'-i',path,'-t','2','-map','0:v:0','-an','-f','framemd5','pipe:1'],{encoding:'utf8',windowsHide:true}).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>line.split(',').at(-1).trim());
  childProcess.spawn=function(command,args,...rest){if(args?.includes('-output_ts_offset'))encoders.push(args[args.indexOf('-c:v')+1]);return spawn.call(this,command,args,...rest);};syncBuiltinESMExports();
  try{
    const aligned=generate('aligned.mp4',48),original=await readFile(aligned),signal=new AbortController().signal;
    const state=await startHlsTranscode(root,41,aligned,{copyVideo:true,duration:6});assert.equal(state.status,'ready');
    const prefix=state.playlist.replace('/index.m3u8','');
    for(const index of [0,1,2]){
      const segment=await demandSegment(root,prefix,`segment-${index}.ts`,signal);
      assert.equal(encoders.at(-1),'copy','aligned segments retain their encoded video');
      assert.deepEqual(hashes(segment.path),hashes(aligned,index*2),'copied decoded frames match the original exactly');
      const probe=JSON.parse(execFileSync(process.env.FFPROBE_PATH||'ffprobe',['-v','quiet','-show_format','-of','json',segment.path],{encoding:'utf8',windowsHide:true}));
      assert.ok(Math.abs(Number(probe.format.start_time)-index*2)<.1);assert.ok(Number(probe.format.duration)<=2.2);segment.release();
    }
    assert.ok((await readFile(aligned)).equals(original));
    const forced=await startHlsTranscode(root,41,aligned,{copyVideo:false,duration:6});assert.notEqual(forced.playlist,state.playlist);
    const encoded=await demandSegment(root,forced.playlist.replace('/index.m3u8',''),'segment-0.ts',signal);assert.equal(encoders.at(-1),'libx264');encoded.release();
    for(const [name,gop,bframes] of [['long-gop.mp4',240,0],['reordered.mp4',48,2]]){
      const source=generate(name,gop,bframes),state=await startHlsTranscode(root,42,source,{copyVideo:true,duration:6});
      const segment=await demandSegment(root,state.playlist.replace('/index.m3u8',''),'segment-1.ts',signal);
      assert.equal(encoders.at(-1),'libx264','unsafe copied boundaries use a real independent encode');assert.ok(hashes(segment.path).length>40);segment.release();
    }
  }finally{childProcess.spawn=spawn;syncBuiltinESMExports();await stopAllTranscodes(root);await rm(root,{recursive:true,force:true});}
});

test('subtitle extraction shares complete atomic results and changes its cache key with the source',async t=>{
  if(!await hasFfmpeg())return t.skip('FFmpeg is unavailable');
  const root=await mkdtemp(join(tmpdir(),'virelo-subtitle-cache-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const source=join(root,'source.mkv'),caption=join(root,'captions.srt');
  const generate=async text=>{
    await writeFile(caption,`1\n00:00:00,000 --> 00:00:01,000\n${text}\n`);
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=black:s=160x90:r=5:d=2','-i',caption,'-c:v','libx264','-preset','ultrafast','-c:s','srt',source],{windowsHide:true});
  };
  await generate('First caption');
  const firstBytes=await readFile(source),firstStat=await stat(source);
  const [first,concurrent]=await Promise.all([extractSubtitleVtt(root,1,source,1),extractSubtitleVtt(root,1,source,1)]);
  assert.equal(first.path,concurrent.path);assert.match(await readFile(first.path,'utf8'),/^WEBVTT[\s\S]*First caption/);
  assert.deepEqual(await readdir(join(first.path,'..')),['1.vtt']);
  assert.deepEqual(await readFile(source),firstBytes);assert.equal((await stat(source)).mtimeMs,firstStat.mtimeMs);
  await generate('Replacement caption with different text');
  const next=await extractSubtitleVtt(root,1,source,1);
  assert.notEqual(next.path,first.path);assert.match(await readFile(next.path,'utf8'),/Replacement caption/);
  await writeFile(next.path,'');
  await extractSubtitleVtt(root,1,source,1);assert.match(await readFile(next.path,'utf8'),/^WEBVTT/);
  await assert.rejects(extractSubtitleVtt(root,1,source,99));
  assert.deepEqual(await readdir(join(next.path,'..')),['1.vtt'],'failed conversions leave no partial files');
});
