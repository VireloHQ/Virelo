import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {isMediaFile,isVideoPath,mediaWatchFilter} from '../dist/media-files.js';
import {scanLibrary} from '../dist/scanner.js';
import {createVireloServer} from '../dist/server.js';
import {refreshMissingMetadata} from '../dist/metadata.js';
import {execFileSync} from 'node:child_process';
import {hasFfmpeg,hasFfprobe} from '../dist/ffmpeg.js';
process.env.VIRELO_LOG_LEVEL='silent';

async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'virelo-discovery-'));
  t.after(async()=>{
    const target=relative(resolve(tmpdir()),root);
    assert.ok(target.startsWith('virelo-discovery-')&&!target.includes('..'));
    await rm(root,{recursive:true,force:true});
  });
  return root;
}

test('TS recordings remain supported without treating TypeScript or declarations as videos',async t=>{
  const root=await fixture(t);
  for(const stride of [188,192,204]){
    const path=join(root,`recording-${stride}.TS`),buffer=Buffer.alloc(stride*5);
    const offset=stride===192?4:0;
    for(let packet=0;packet<5;packet++)buffer[offset+packet*stride]=0x47;
    await writeFile(path,buffer);const before=await stat(path);
    assert.equal(await isMediaFile(path),true);
    assert.deepEqual(await readFile(path),buffer);assert.equal((await stat(path)).mtimeMs,before.mtimeMs);
  }
  for(const name of ['source.ts','types.d.ts','empty.ts']){
    const path=join(root,name);await writeFile(path,name==='empty.ts'?'':'export interface Media { title: string; }');
    assert.equal(await isMediaFile(path),false,name);
  }
  assert.equal(isVideoPath('Film.MP4'),true);assert.equal(isVideoPath('source.ts'),true);
  assert.equal(await isMediaFile(join(root,'note.txt')),false);
});

test('scan and watcher exclusions agree, including explicitly selected hidden/nested roots',async t=>{
  const root=join(await fixture(t),'.private','media');await mkdir(root,{recursive:true});
  const dir=await stat(root),filePath=join(root,'movie.mp4');await writeFile(filePath,'fixture');const file=await stat(filePath);
  const ignored=mediaWatchFilter([root]);
  assert.equal(ignored(root,dir),false);assert.equal(ignored(filePath,file),false);
  assert.equal(ignored(join(root,'collection'),dir),false);
  for(const name of ['node_modules','NODE_MODULES','.cache'])assert.equal(ignored(join(root,name),dir),true);
  assert.equal(ignored(join(root,'node_modules','nested','movie.mp4'),file),true);
  assert.equal(ignored(join(root,'readme.md'),file),true);
  assert.equal(ignored(join(root,'shortcut'),{isDirectory:()=>false,isFile:()=>false}),true);
  assert.equal(ignored(join(root,'unrelated'),undefined),false,'wait for stats before ignoring an unknown directory');
  const explicit=join(root,'node_modules','videos');
  assert.equal(mediaWatchFilter([root,explicit])(join(explicit,'movie.mp4'),file),false,'explicit roots override ancestor exclusions');
});

test('a non-video project skips dependencies and TypeScript while yielding to requests during discovery',async t=>{
  const root=await fixture(t),source=join(root,'source.ts');await writeFile(source,'export const version = 1;');
  for(const dir of ['node_modules/pkg/nested','.cache']){
    await mkdir(join(root,dir),{recursive:true});await writeFile(join(root,dir,'hidden.mp4'),'must not be probed');
  }
  await Promise.all(Array.from({length:250},(_,i)=>mkdir(join(root,'folder-'+i))));
  const state={total:0,scanned:0,added:0,updated:0,skipped:0,errors:0,message:''};
  let prune=false,ticks=0;const messages=[];
  let message='';Object.defineProperty(state,'message',{get:()=>message,set:value=>{message=value;messages.push(value);}});
  const heartbeat=setInterval(()=>ticks++,0);t.after(()=>clearInterval(heartbeat));
  const db={libraryForPath(){throw Error('non-video reached catalog');},deleteMissingForLibrary(id,paths){
    assert.equal(id,1);assert.ok(paths.has(source),'an existing rejected TS is not pruned as if its file were deleted');prune=true;
  }};
  await scanLibrary(db,{id:1,path:root,label:'Project'},root,state);
  assert.equal(state.total,0);assert.equal(state.scanned,0);assert.equal(state.errors,0);assert.equal(prune,true);
  assert.ok(ticks>0,'discovery yields to the event loop');assert.ok(messages.some(value=>value.includes('folder-')));
  assert.ok(!messages.some(value=>value.includes('node_modules')||value.includes('.cache')));
  assert.equal(await readFile(source,'utf8'),'export const version = 1;');
});

test('folder monitoring ignores code and dependencies but detects videos under an explicitly selected hidden root',async t=>{
  const root=await fixture(t),media=join(root,'.private'),dependency=join(media,'node_modules','example');
  await mkdir(dependency,{recursive:true});
  const server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[media],host:'127.0.0.1',port:0});
  try {
  server.db.updateSettings({externalMetadataEnabled:false});await server.app.ready();
  const idle=async()=>{while(server.scanStatus.running)await new Promise(done=>setTimeout(done,10));};
  await server.runScan();await idle();
  const started=server.scanStatus.startedAt;
  await writeFile(join(media,'source.ts'),'export const version = 1;');
  await writeFile(join(media,'notes.txt'),'not media');
  await writeFile(join(dependency,'fixture.mp4'),'ignored dependency');
  await new Promise(done=>setTimeout(done,3200));
  assert.equal(server.scanStatus.startedAt,started,'non-video changes do not trigger scans');
  const path=join(media,'video.mp4');await writeFile(path,'synthetic video fixture');
  const deadline=Date.now()+10000;
  while((!server.db.getMediaByPath(path)||server.scanStatus.running)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25));
  assert.ok(server.db.getMediaByPath(path),'a new video is automatically discovered');
  assert.notEqual(server.scanStatus.startedAt,started);await idle();
  assert.equal(server.db.listMedia({}).length,1);
  } finally {await server.app.close();}
});

test('closing the server finishes an in-flight discovery before closing its database',async t=>{
  const root=await fixture(t),media=join(root,'media');await mkdir(media);
  await Promise.all(Array.from({length:150},(_,i)=>mkdir(join(media,'folder-'+i))));
  const server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[media],host:'127.0.0.1',port:0});
  try {
  await server.app.ready();await server.runScan();assert.equal(server.scanStatus.running,true);
  await server.app.close();assert.equal(server.scanStatus.running,false);assert.equal(server.scanStatus.errors,0);
  assert.equal(await server.runScan(),false,'shutdown cannot start another scan against a closed database');
  } finally {await server.app.close();}
});

test('folder changes during an active scan are scanned again and receive thumbnails', {timeout:20000}, async t=>{
  if(!await hasFfmpeg()||!await hasFfprobe()){t.skip('FFmpeg and ffprobe are required');return;}
  const root=await fixture(t),media=join(root,'media');await mkdir(media);
  const source=join(media,'First.mp4'),added=join(media,'Added.mp4');
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x334455:s=160x90:r=5:d=2','-c:v','libx264','-pix_fmt','yuv420p',source],{windowsHide:true});
  const original=await readFile(source),fetchOriginal=globalThis.fetch;
  let release,entered=false;
  const metadataGate=new Promise(resolve=>{release=resolve;});
  globalThis.fetch=async()=>{entered=true;await metadataGate;return new Response(JSON.stringify({metas:[]}));};
  const server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[media],host:'127.0.0.1',port:0});
  try {
    server.db.updateSettings({externalMetadataEnabled:true,externalImagesEnabled:false});await server.app.ready();
    await server.runScan();
    const waiting=Date.now()+5000;
    while(!entered&&Date.now()<waiting)await new Promise(done=>setTimeout(done,10));
    assert.ok(entered,'the scan has finished its file snapshot and is still matching metadata');
    await writeFile(added,original);
    await new Promise(done=>setTimeout(done,3500));
    assert.equal(server.scanStatus.running,true,'the watcher debounce expires while the first scan is still active');
    release();
    const deadline=Date.now()+7000;
    while((!server.db.getMediaByPath(added)?.thumbnail_path||server.scanStatus.running)&&Date.now()<deadline)await new Promise(done=>setTimeout(done,25));
    const item=server.db.getMediaByPath(added);
    assert.ok(item?.thumbnail_path,'the queued scan generates artwork for the newly added video');
    assert.ok((await stat(item.thumbnail_path)).size>0);
    assert.deepEqual(await readFile(source),original);assert.deepEqual(await readFile(added),original);
  } finally {release();await server.app.close();globalThis.fetch=fetchOriginal;}
});

test('cancelled discovery never prunes records and shutdown stops scheduling metadata jobs',async t=>{
  const root=await fixture(t),abort=new AbortController();abort.abort();
  const state={total:0,scanned:0,errors:0,message:''};
  await scanLibrary({deleteMissingForLibrary(){assert.fail('cancelled discovery cannot prune history');}},
    {id:1,path:root,label:'Media'},root,state,abort.signal);
  assert.equal(state.errors,0);
  const stop=new AbortController();let attempts=0;
  const db={getSettings:()=>({externalMetadataEnabled:true}),listMetadataCandidates:()=>[{id:1},{id:2}],
    getMedia(){attempts++;throw Error('Unmatchable fixture');}};
  const result=await refreshMissingMetadata(db,root,()=>stop.abort(),undefined,stop.signal);
  assert.equal(attempts,1);assert.equal(result.attempted,1);assert.equal(result.failed,1);
});
