// Full-file decoding runs in the media-regression job, separately from CPU-heavy account tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess, { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { copyFile, mkdtemp, mkdir, readFile, rm, stat, symlink, rename, utimes, writeFile } from 'node:fs/promises';
import { renameSync, utimesSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeAudio, parseLoudnessReport, scanAudioLoudness } from '../dist/audio-loudness.js';
import { VireloDB } from '../dist/db.js';
import { scanAll, scanLibrary } from '../dist/scanner.js';
import { mediaScheduler } from '../dist/media-work.js';
import { hasFfmpeg, hasFfprobe } from '../dist/ffmpeg.js';

const requiresMedia={skip:!await hasFfmpeg()||!await hasFfprobe()?'FFmpeg and ffprobe are required':false};

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const status=()=>({running:true,startedAt:null,finishedAt:null,total:0,scanned:0,added:0,updated:0,skipped:0,errors:0,message:''});
const tone=(amplitude=.4,duration=3)=>`aevalsrc=${amplitude}*sin(2*PI*1000*t):s=48000:d=${duration}`;
const isAnalysis=args=>args?.some(value=>value.startsWith('loudnorm='));
const fingerprint=async path=>{
  const info=await stat(path);
  return {sha256:createHash('sha256').update(await readFile(path)).digest('hex'),size:info.size,mtime:info.mtimeMs};
};

function generate(source,inputs=[tone()],metadata='') {
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',[
    '-nostdin','-hide_banner','-loglevel','error','-y','-threads','2','-filter_threads','1',
    '-f','lavfi','-i','color=c=black:s=160x90:r=5:d=3',
    ...inputs.flatMap(input=>['-f','lavfi','-i',input]),
    '-map','0:v',...inputs.flatMap((_,index)=>['-map',`${index+1}:a`]),
    '-c:v','ffv1','-threads','2','-c:a','pcm_f32le',
    ...(inputs.length>1?['-disposition:a:0','0','-disposition:a:1','default']:[]),
    ...(metadata?['-metadata',`comment=${metadata}`,'-metadata:s:a:0',`title=${metadata}`]:[]),source
  ],{windowsHide:true,timeout:20000,stdio:'pipe'});
}

async function fixture(t,inputs=[tone()],metadata='') {
  const root=await mkdtemp(join(repository,'.virelo-audio-test-'));
  let db;
  t.after(async()=>{
    await mediaScheduler.closeScope(join(root,'data'));
    db?.close();
    assert.match(relative(repository,root),/^\.virelo-audio-test-[^\\/]+$/);
    await rm(root,{recursive:true,force:true});
  });
  const data=join(root,'data'),media=join(root,'media'),source=join(media,'Synthetic.mkv');
  await mkdir(data);await mkdir(media);
  generate(source,inputs,metadata);
  db=new VireloDB(data);
  db.updateSettings({externalMetadataEnabled:false,libraryWatchEnabled:false});
  const library=db.addLibrary(media,'Synthetic media');
  const regular=status();await scanLibrary(db,library,data,regular);
  assert.equal(regular.added,1);assert.equal(regular.errors,0);
  const item=db.getMediaByPath(source);
  return {root,data,media,source,db,library,item,
    enable:()=>db.updateSettings({audioAnalysisEnabled:true}),
    scan:async(signal,scope)=>{const state=status();await scanAudioLoudness(db,data,state,scope,signal);return state;},
    cached:()=>db.getMedia(item.id).audio_loudness,
    setCache:value=>db.db.prepare('UPDATE media SET audio_loudness=? WHERE id=?').run(value,item.id)};
}

function watchSpawns(t,callback=()=>{},realtime=false) {
  const spawn=childProcess.spawn,calls=[];
  const mock=t.mock.method(childProcess,'spawn',function(command,args,...rest){
    if(realtime&&isAnalysis(args)){args=[...args];args.splice(args.indexOf('-i'),0,'-re');}
    const child=spawn.call(this,command,args,...rest);
    calls.push({command,args});callback(child,args);
    return child;
  });
  syncBuiltinESMExports();
  t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  return calls;
}

test('loudnorm parser validates numbers and treats unmeasurable audio as null',()=>{
  const report=(input_i,input_tp)=>JSON.stringify({input_i,input_tp});
  assert.deepEqual(parseLoudnessReport(report('-18.25','-3.12')),{integratedLufs:-18.25,truePeakDb:-3.12});
  assert.deepEqual(parseLoudnessReport(report(-100,-120)),{integratedLufs:-100,truePeakDb:-120});
  assert.deepEqual(parseLoudnessReport(report(20,20)),{integratedLufs:20,truePeakDb:20});
  for(const peak of ['-inf','-7.96'])assert.equal(parseLoudnessReport(report('-inf',peak)),null);
  for(const value of [null,true,false,'',' ','NaN','inf','Infinity',[],{},'0x10','1e309',21]) {
    assert.throws(()=>parseLoudnessReport(report(value,'-3')),'invalid integrated value '+JSON.stringify(value));
    assert.throws(()=>parseLoudnessReport(report('-18',value)),'invalid peak '+JSON.stringify(value));
  }
  assert.throws(()=>parseLoudnessReport(report(-101,-3)));
  assert.throws(()=>parseLoudnessReport(report(-18,-121)));
  for(const peak of [null,true,'',{},'-121','21'])assert.throws(()=>parseLoudnessReport(report('-inf',peak)));
  assert.throws(()=>parseLoudnessReport(report('-18','-inf')));
  for(const report of ['', '{}', '{"input_i":"-18"}', '{"input_i":'])assert.throws(()=>parseLoudnessReport(report));
  const valid=report('-18','-3');
  assert.throws(()=>parseLoudnessReport(valid+'\n{"input_i":'));
  assert.throws(()=>parseLoudnessReport('{"input_i":1e309,"input_tp":-3}'));
  assert.deepEqual(parseLoudnessReport('metadata '+report('0','0')+'\n'+valid),{integratedLufs:-18,truePeakDb:-3});
  assert.deepEqual(parseLoudnessReport(('x'.repeat(4000)+'\n'+valid+'\nend').slice(-1000)),{integratedLufs:-18,truePeakDb:-3});
});

test('real FFmpeg measures each full audio stream, default track, short/silent/gated audio without changing originals',requiresMedia,async t=>{
  const f=await fixture(t,[tone(),tone(.04),tone(.4,.1),'anullsrc=r=48000:cl=mono:d=3',tone(.000001)],
    'metadata '.repeat(400)+'{"input_i":"0","input_tp":"0"}');
  const before=await fingerprint(f.source),calls=watchSpawns(t),work=[];
  const run=mediaScheduler.run;
  t.mock.method(mediaScheduler,'run',function(task,options){work.push(options);return run.call(this,task,options);});
  const result=await analyzeAudio(f.source,0,f.data);
  assert.equal(result.defaultAudioStream,2);
  assert.deepEqual(result.tracks.map(track=>track.index),[1,2,3,4,5]);
  const [loud,quiet,short,silent,gated]=result.tracks.map(track=>track.loudness);
  assert.ok(Math.abs(loud.integratedLufs+11)<.4,JSON.stringify(loud));
  assert.ok(Math.abs(loud.truePeakDb+7.96)<.1,JSON.stringify(loud));
  assert.ok(Math.abs(loud.integratedLufs-quiet.integratedLufs-20)<.2);
  assert.ok(Math.abs(loud.truePeakDb-quiet.truePeakDb-20)<.2);
  assert.equal(short,null);assert.equal(silent,null);assert.equal(gated,null);
  const processes=calls.filter(call=>isAnalysis(call.args));assert.equal(processes.length,5);
  for(const {args} of processes) {
    assert.equal(args.at(-1),'-');assert.equal(args[args.indexOf('-f')+1],'null');
    assert.ok(!args.includes('-ss')&&!args.includes('-t'),'whole streams, never a sample');
    assert.ok(args.includes('-nostats')&&args.includes('-nostdin'));
    assert.equal(args[args.indexOf('-filter_threads')+1],'1');
  }
  for(const {args} of calls)assert.equal(args[args.indexOf('-protocol_whitelist')+1],'file,pipe','both ffprobe and FFmpeg are network-restricted');
  assert.ok(work.length>=5);assert.ok(work.every(options=>options.kind==='background'&&options.owner==='scan'&&options.scope===f.data));
  assert.deepEqual(await fingerprint(f.source),before);
});

test('optional analysis defaults OFF; scanAll enables it after normal discovery and reuses valid caches',requiresMedia,async t=>{
  const f=await fixture(t),before=await fingerprint(f.source),calls=watchSpawns(t);
  assert.equal(f.db.getSettings().audioAnalysisEnabled,false);
  assert.equal(f.cached(),null);
  await f.scan();await scanAll(f.db,f.data,status());
  assert.equal(calls.length,0,'OFF does not start analysis or an unnecessary probe');
  f.enable();
  const first=status();await scanAll(f.db,f.data,first);
  assert.equal(first.audioTotal,1);assert.equal(first.audioAnalyzed,1);
  assert.equal(first.errors,0);assert.match(first.message,/^Analyzing audio · Synthetic\.mkv$/);
  const cache=f.cached(),data=JSON.parse(cache),item=f.db.getMedia(f.item.id);
  assert.deepEqual(Object.keys(data).sort(),['defaultAudioStream','mtime','size','tracks','version']);
  assert.equal(data.version,1);assert.equal(data.size,item.size);assert.equal(data.mtime,item.mtime);
  assert.equal(data.defaultAudioStream,1);assert.equal(data.tracks[0].index,1);
  const count=calls.length;
  await f.scan();await scanAll(f.db,f.data,status());
  assert.equal(calls.length,count,'valid cache does not invoke FFmpeg or ffprobe');assert.equal(f.cached(),cache);
  assert.deepEqual(await fingerprint(f.source),before);
});

test('audio progress counts pending files across visible libraries, not tracks or cached files',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();await f.scan();
  generate(join(f.media,'Pending.mkv'),[tone(),tone(.04)]);
  await scanLibrary(f.db,f.library,f.data,status());
  const other=join(f.root,'other-media');await mkdir(other);generate(join(other,'Other.mkv'));
  const library=f.db.addLibrary(other,'Other');await scanLibrary(f.db,library,f.data,status());
  const state=status(),progress=[];
  watchSpawns(t,(_child,args)=>{if(isAnalysis(args))progress.push([state.audioTotal,state.audioAnalyzed]);});
  await scanAudioLoudness(f.db,f.data,state);
  assert.equal(state.errors,0);assert.equal(state.audioTotal,2);assert.equal(state.audioAnalyzed,2);
  assert.deepEqual(progress,[[2,0],[2,0],[2,1]],'progress stays incomplete until each whole file finishes');
  const cached=await f.scan();assert.equal(cached.audioTotal,0);assert.equal(cached.audioAnalyzed,0);
});

test('mtime-only and size changes invalidate cached measurements after scanLibrary',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();await f.scan();
  const initial=JSON.parse(f.cached()),before=await fingerprint(f.source);
  // Whole seconds round-trip exactly through both POSIX microseconds and Windows timestamps.
  await utimes(f.source,new Date(),new Date(Math.floor(before.mtime/1000)*1000+4000));
  const touched=await fingerprint(f.source);assert.equal(touched.sha256,before.sha256);assert.equal(touched.size,before.size);
  await scanLibrary(f.db,f.library,f.data,status());assert.equal(f.cached(),null);
  assert.equal((await f.scan()).errors,0);assert.equal(JSON.parse(f.cached()).mtime,Math.trunc(touched.mtime));
  assert.notEqual(JSON.parse(f.cached()).mtime,initial.mtime);assert.deepEqual(await fingerprint(f.source),touched);
  generate(f.source,[tone(.04),tone(.02)]);
  await utimes(f.source,new Date(),new Date(touched.mtime));
  const replaced=await fingerprint(f.source);assert.notEqual(replaced.size,touched.size);
  assert.equal(Math.trunc(replaced.mtime),Math.trunc(touched.mtime),'size alone invalidates the cache');
  await scanLibrary(f.db,f.library,f.data,status());assert.equal(f.cached(),null);
  assert.equal((await f.scan()).errors,0);
  const refreshed=JSON.parse(f.cached());assert.equal(refreshed.size,replaced.size);assert.equal(refreshed.tracks.length,2);
  assert.ok(refreshed.tracks[0].loudness.integratedLufs<initial.tracks[0].loudness.integratedLufs-19);
  assert.deepEqual(await fingerprint(f.source),replaced);
});

test('malformed, stale and wrongly typed caches are reanalyzed instead of trusted',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();await f.scan();
  const valid=JSON.parse(f.cached()),track=valid.tracks[0],calls=watchSpawns(t);
  const invalid=[
    '{',null,{}, {...valid,padding:'x'.repeat(65536)},
    {...valid,version:2},{...valid,size:valid.size+1},{...valid,mtime:valid.mtime+1},
    {...valid,defaultAudioStream:99},{...valid,defaultAudioStream:'1'},
    {...valid,tracks:[null]},{...valid,tracks:[track,track]},
    {...valid,tracks:[{...track,index:-1}]},{...valid,tracks:[{...track,index:1.5}]},
    {...valid,tracks:[{index:1}]},{...valid,tracks:[{index:1,loudness:{integratedLufs:null,truePeakDb:-3}}]},
    {...valid,tracks:[{index:1,loudness:{integratedLufs:'-18',truePeakDb:-3}}]},
    {...valid,tracks:[{index:1,loudness:{integratedLufs:-101,truePeakDb:-3}}]},
    {...valid,tracks:[{index:1,loudness:{integratedLufs:-18,truePeakDb:21}}]}
  ];
  for(const cache of invalid) {
    f.setCache(typeof cache==='string'?cache:JSON.stringify(cache));
    const count=calls.filter(call=>isAnalysis(call.args)).length,state=await f.scan();
    assert.equal(state.errors,0,JSON.stringify(cache));assert.deepEqual(JSON.parse(f.cached()),valid);
    assert.equal(calls.filter(call=>isAnalysis(call.args)).length,count+1,'invalid cache must be remeasured');
  }
});

test('silent, short and video-only null results are reusable and never counted as scan errors',requiresMedia,async t=>{
  const f=await fixture(t,[tone(.4,.1),'anullsrc=r=48000:cl=mono:d=3']);f.enable();
  const before=await fingerprint(f.source);assert.equal((await f.scan()).errors,0);
  const data=JSON.parse(f.cached());assert.deepEqual(data.tracks,[{index:1,loudness:null},{index:2,loudness:null}]);
  const calls=watchSpawns(t);await f.scan();assert.equal(calls.length,0);assert.deepEqual(await fingerprint(f.source),before);
  generate(f.source,[]);await scanLibrary(f.db,f.library,f.data,status());
  const original=await fingerprint(f.source);assert.equal((await f.scan()).errors,0);
  assert.deepEqual(JSON.parse(f.cached()).tracks,[]);assert.equal(JSON.parse(f.cached()).defaultAudioStream,null);
  const count=calls.length;await f.scan();assert.equal(calls.length,count);assert.deepEqual(await fingerprint(f.source),original);
});

test('already-aborted signals and cancellation before controller setup never launch analysis',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();const calls=watchSpawns(t),before=await fingerprint(f.source);
  const controller=new AbortController();controller.abort();
  await assert.rejects(analyzeAudio(f.source,3,f.data,controller.signal),{name:'AbortError'});
  assert.equal((await f.scan(controller.signal)).errors,0);assert.equal(calls.length,0);
  const racing=new AbortController(),state=status();
  Object.defineProperty(state,'message',{set:()=>racing.abort()});
  await scanAudioLoudness(f.db,f.data,state,undefined,racing.signal);
  assert.equal(state.errors,0);assert.equal(calls.length,0);assert.equal(f.cached(),null);
  assert.deepEqual(await fingerprint(f.source),before);
});

test('cancelling an actual scheduled FFmpeg process writes no partial multitrack cache and can retry',requiresMedia,async t=>{
  const f=await fixture(t,[tone(),tone(.04)]);f.enable();const before=await fingerprint(f.source),controller=new AbortController();
  const calls=watchSpawns(t,(_child,args)=>{if(isAnalysis(args))setImmediate(()=>controller.abort());});
  const state=await f.scan(controller.signal);
  assert.equal(state.errors,0);assert.equal(state.audioTotal,1);assert.equal(state.audioAnalyzed,1);
  assert.equal(calls.filter(call=>isAnalysis(call.args)).length,1);assert.equal(f.cached(),null);
  assert.deepEqual(await fingerprint(f.source),before);
  assert.equal((await f.scan()).errors,0);assert.equal(JSON.parse(f.cached()).tracks.length,2);
});

test('disabling analysis during FFmpeg processing cancels without writing or incrementing errors',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();const before=await fingerprint(f.source);let process;
  watchSpawns(t,(child,args)=>{if(isAnalysis(args)){
    process=child;child.stderr.once('data',()=>f.db.updateSettings({audioAnalysisEnabled:false}));
  }},true);
  assert.equal((await f.scan()).errors,0);assert.equal(f.cached(),null);
  assert.equal(process?.killed,true,'the settings polling timer terminates active FFmpeg');
  assert.deepEqual(await fingerprint(f.source),before);
});

test('source mutation after actual measurement prevents stale writes until the library is rescanned',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();const before=await fingerprint(f.source);let changed=false;
  const calls=watchSpawns(t,(child,args)=>{
    if(isAnalysis(args)&&!changed)child.prependOnceListener('close',()=>{
      changed=true;utimesSync(f.source,new Date(),new Date(before.mtime+8000));
    });
  });
  assert.equal((await f.scan()).errors,0);assert.equal(changed,true);assert.equal(f.cached(),null);
  const touched=await fingerprint(f.source);assert.equal(touched.sha256,before.sha256);
  const count=calls.length;await f.scan();assert.equal(calls.length,count,'outdated DB fingerprint is not analyzed');
  await scanLibrary(f.db,f.library,f.data,status());assert.equal((await f.scan()).errors,0);
  assert.equal(JSON.parse(f.cached()).mtime,Math.trunc(touched.mtime));assert.deepEqual(await fingerprint(f.source),touched);
});

test('catalog fingerprint changes and library removal during measurement prevent stale writes',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();let revoke=false;
  watchSpawns(t,(child,args)=>{
    if(isAnalysis(args))child.prependOnceListener('close',()=>{
      if(revoke)f.db.removeLibrary(f.library.id);
      else f.db.db.prepare('UPDATE media SET mtime=mtime+1 WHERE id=?').run(f.item.id);
    });
  });
  assert.equal((await f.scan()).errors,0);assert.equal(f.cached(),null);
  await scanLibrary(f.db,f.library,f.data,status());revoke=true;
  assert.equal((await f.scan()).errors,0);assert.equal(f.cached(),null);
});

test('same-size/same-mtime source replacement is rejected using file identity',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();
  const fixedTime=new Date(1700000000000);
  await utimes(f.source,fixedTime,fixedTime);await scanLibrary(f.db,f.library,f.data,status());
  const before=await fingerprint(f.source),replacement=join(f.media,'replacement.mkv'),saved=join(f.root,'original.mkv');
  await copyFile(f.source,replacement);await utimes(replacement,fixedTime,fixedTime);
  assert.deepEqual(await fingerprint(replacement),before);
  let replaced=false;
  watchSpawns(t,(child,args)=>{
    if(isAnalysis(args))child.prependOnceListener('close',()=>{
      renameSync(f.source,saved);renameSync(replacement,f.source);replaced=true;
    });
  });
  assert.equal((await f.scan()).errors,0);assert.equal(replaced,true);assert.equal(f.cached(),null);
  assert.deepEqual(await fingerprint(saved),before);assert.deepEqual(await fingerprint(f.source),before);
});

test('analysis respects catalog scope, out-of-root paths and retargeted library junctions',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();const before=await fingerprint(f.source),calls=watchSpawns(t);
  await f.scan(undefined,{userId:1,libraryIds:[]});assert.equal(calls.length,0);
  const outside=join(f.root,'outside');await mkdir(outside);const protectedFile=join(outside,'Synthetic.mkv');
  generate(protectedFile);const protectedBefore=await fingerprint(protectedFile),info=await stat(protectedFile);
  f.db.db.prepare('UPDATE media SET path=?,size=?,mtime=? WHERE id=?').run(protectedFile,info.size,Math.trunc(info.mtimeMs),f.item.id);
  await f.scan();assert.equal(calls.length,0);assert.equal(f.cached(),null);
  f.db.db.prepare('UPDATE media SET path=?,size=?,mtime=? WHERE id=?').run(f.source,f.item.size,f.item.mtime,f.item.id);
  const saved=join(f.root,'saved-media');await rename(f.media,saved);
  await symlink(outside,f.media,process.platform==='win32'?'junction':'dir');
  await f.scan();assert.equal(calls.length,0);assert.equal(f.cached(),null);
  assert.deepEqual(await fingerprint(protectedFile),protectedBefore);assert.deepEqual(await fingerprint(join(saved,'Synthetic.mkv')),before);
});

test('FFmpeg failures stay retryable and do not write successful cache records',requiresMedia,async t=>{
  const f=await fixture(t);f.enable();const command=process.env.FFMPEG_PATH,before=await fingerprint(f.source);
  try {
    process.env.FFMPEG_PATH=join(f.root,'missing-ffmpeg');
    const state=await f.scan();assert.equal(state.errors,1);assert.equal(state.audioTotal,1);assert.equal(state.audioAnalyzed,1);assert.equal(f.cached(),null);
  }finally{if(command===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=command;}
  assert.equal((await f.scan()).errors,0);assert.ok(f.cached());assert.deepEqual(await fingerprint(f.source),before);
});

test('disguised local and remote playlists are rejected without reading referenced media',requiresMedia,async t=>{
  const f=await fixture(t),before=await fingerprint(f.source);
  const playlist=join(f.media,'Playlist.mkv'),diagnostics=[];
  // Retain real FFmpeg/ffprobe execution and inspect its own format-restriction diagnostic.
  const calls=watchSpawns(t,child=>child.stderr.on('data',chunk=>diagnostics.push(String(chunk))));
  for(const content of [
    `ffconcat version 1.0\nfile '${f.source.replaceAll('\\','/')}'\n`,
    '#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nhttps://example.invalid/never-request.ts\n#EXT-X-ENDLIST\n'
  ]) {
    await writeFile(playlist,content);diagnostics.length=0;
    await assert.rejects(analyzeAudio(playlist,3,f.data));
    assert.match(diagnostics.join(''),/not on whitelist|Not detecting m3u8\/hls/);
  }
  assert.equal(calls.filter(call=>isAnalysis(call.args)).length,0,'only format inspection occurs, never decoding referenced streams');
  assert.deepEqual(await fingerprint(f.source),before);
});

test('source junction retargeted while queued is rejected before any media process starts',{...requiresMedia,timeout:10000},async t=>{
  const f=await fixture(t);f.enable();const before=await fingerprint(f.source);
  const outside=join(f.root,'outside');await mkdir(outside);const protectedFile=join(outside,'Synthetic.mkv');
  generate(protectedFile);const protectedBefore=await fingerprint(protectedFile),calls=watchSpawns(t);
  let release;
  const blocker=mediaScheduler.run(()=>new Promise(done=>{release=done;}),{kind:'background',scope:f.data});
  let discovered;
  const ready=new Promise(done=>{discovered=done;}),state=status();
  Object.defineProperty(state,'message',{set:()=>discovered()});
  const scanning=scanAudioLoudness(f.db,f.data,state);
  await ready;
  const saved=join(f.root,'saved-media');
  try {
    await rename(f.media,saved);await symlink(outside,f.media,process.platform==='win32'?'junction':'dir');
  }finally{release();}
  await blocker;await scanning;
  assert.equal(state.errors,0);assert.equal(state.audioTotal,1);assert.equal(state.audioAnalyzed,1);
  assert.equal(calls.length,0);assert.equal(f.cached(),null);
  assert.deepEqual(await fingerprint(protectedFile),protectedBefore);assert.deepEqual(await fingerprint(join(saved,'Synthetic.mkv')),before);
});
