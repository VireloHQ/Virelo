import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { dataUsage, assertSeparateCache } from '../dist/data-management.js';
import { DemandCache } from '../dist/demand-cache.js';
import { createVireloServer } from '../dist/server.js';
import { authenticatedInjector } from './auth-helper.mjs';

const fingerprint=async path=>({sha256:createHash('sha256').update(await readFile(path)).digest('hex'),mtime:(await stat(path)).mtimeMs});
const directoryLink=(target,path)=>symlink(target,path,process.platform==='win32'?'junction':'dir');

test('storage usage measures only Virelo data and never follows linked folders',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-storage-usage-'));
  try{
    const data=join(root,'data'),media=join(root,'media');
    for(const path of [data,media,join(data,'thumbnails'),join(data,'cache','hls'),join(data,'unrelated')])await mkdir(path,{recursive:true});
    for(const [path,size] of [[join(data,'virelo.db'),100],[join(data,'virelo.db-wal'),20],[join(data,'virelo.db-shm'),10],
      [join(data,'thumbnails','1.jpg'),30],[join(data,'cache','hls','segment-0.ts'),40],
      [join(media,'original.mp4'),1000],[join(data,'unrelated','original.mp4'),2000]])await writeFile(path,Buffer.alloc(size));
    await directoryLink(media,join(data,'artwork'));
    const before=await fingerprint(join(media,'original.mp4'));
    const usage=await dataUsage(data,512*1024*1024);
    assert.equal(usage.dataDir,data);assert.equal(usage.totalBytes,200);assert.equal(usage.skippedLinks,1);
    assert.deepEqual(usage.categories,{database:{bytes:130,files:3},thumbnails:{bytes:30,files:1},artwork:{bytes:0,files:0},cache:{bytes:40,files:1}});
    assert.deepEqual(await fingerprint(join(media,'original.mp4')),before);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('manual cache cleanup preserves active files, originals, images, database and unknown files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-storage-clean-'));
  try{
    const directory=join(root,'cache','hls','1','default');await mkdir(directory,{recursive:true});
    const cache=new DemandCache(root);await cache.init();
    for(const [name,body] of [['segment-0.ts','unused'],['segment-1.ts','active'],['segment-1.ts.part','encoding'],
      ['segment-2.ts',''],['index.m3u8','playlist'],['0.vtt','subtitle'],['personal.mp4','original'],['notes.txt','notes']])await writeFile(join(directory,name),body);
    await mkdir(join(root,'thumbnails'));await mkdir(join(root,'artwork'));
    const protectedFiles=[join(root,'original.mkv'),join(root,'virelo.db'),join(root,'thumbnails','1.jpg'),join(root,'artwork','poster.jpg'),join(directory,'personal.mp4')];
    for(const path of protectedFiles)await writeFile(path,'keep exactly');
    const before=await Promise.all(protectedFiles.map(fingerprint));
    const release=cache.pin(join(directory,'segment-1.ts'));
    assert.equal(cache.isPinned(join(directory,'segment-1.ts.part')),true);
    const result=await cache.clearUnused();
    assert.deepEqual(result,{deletedFiles:3,freedBytes:14,retainedFiles:3,retainedBytes:22});
    assert.deepEqual((await readdir(directory)).sort(),['0.vtt','notes.txt','personal.mp4','segment-1.ts','segment-1.ts.part']);
    assert.equal(await cache.lookup(join(directory,'segment-1.ts')),true);
    assert.deepEqual(await Promise.all(protectedFiles.map(fingerprint)),before);
    release();
    const results=await Promise.all([cache.clearUnused(),cache.clearUnused()]);
    assert.equal(results.reduce((sum,item)=>sum+item.deletedFiles,0),2);
    assert.deepEqual((await readdir(directory)).sort(),['0.vtt','notes.txt','personal.mp4']);
    await assert.rejects(cache.clearUnused(()=>{throw Error('Permission revoked');}),/Permission revoked/);
    assert.equal(await readFile(join(directory,'0.vtt'),'utf8'),'subtitle');
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cache cleanup refuses junctions introduced after initialization without deleting their targets',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-storage-link-'));
  try{
    const cacheRoot=join(root,'cache'),external=join(root,'originals');
    await mkdir(join(cacheRoot,'hls'),{recursive:true});await mkdir(external);
    const original=join(external,'segment-0.ts');await writeFile(original,'original transport stream');
    const before=await fingerprint(original);
    const cache=new DemandCache(root);await cache.init();
    await rm(join(cacheRoot,'hls'),{recursive:true});await directoryLink(external,join(cacheRoot,'hls'));
    await assert.rejects(cache.clearUnused(),/filesystem links/);
    assert.deepEqual(await fingerprint(original),before);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('cleanup refuses overlapping library roots, including filesystem aliases',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-storage-overlap-'));
  try{
    const data=join(root,'data'),cache=join(data,'cache'),nested=join(cache,'hls');await mkdir(nested,{recursive:true});
    const media=join(root,'media');await mkdir(media);
    assert.doesNotThrow(()=>assertSeparateCache(data,[media,join(root,'data-copy')]));
    for(const library of [root,data,cache,nested])assert.throws(()=>assertSeparateCache(data,[library]),/overlaps a media library/);
    const alias=join(root,'alias');await directoryLink(cache,alias);
    assert.throws(()=>assertSeparateCache(data,[alias]),/overlaps a media library/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('data API is admin-only, same-origin and only clears generated cache without changing catalog or originals',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-storage-api-'));
  let app;
  try{
    const dataDir=join(root,'data'),mediaDir=join(root,'media');await mkdir(mediaDir);
    const server=await createVireloServer({dataDir,mediaPaths:[mediaDir],host:'127.0.0.1',port:0});
    app=server.app;server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
    const inject=await authenticatedInjector(app);
    await inject({method:'POST',url:'/api/settings',payload:{libraryWatchEnabled:false,externalMetadataEnabled:false}});
    const original=join(mediaDir,'original.mp4');await writeFile(original,'source video');const before=await fingerprint(original);
    const library=server.db.visibleLibraries()[0];
    const item=server.db.upsertMedia({library_id:library.id,path:original,filename:'original.mp4',title:'Original',sort_title:'original',kind:'video',series_title:null,season:null,episode:null,year:null,duration:60,width:640,height:360,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:12,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null});
    server.db.setLike(item.id,true,1);server.db.setProgress(item.id,15,60,1);
    const initialMedia=(await inject({url:'/api/media/'+item.id})).json();
    const cacheFile=join(dataDir,'cache','hls','segment-0.ts');await writeFile(cacheFile,'generated');
    for(const url of ['/api/data','/api/data/cache'])assert.equal((await app.inject({url,method:url.endsWith('cache')?'DELETE':'GET',headers:{'x-virelo-request':'1'}})).statusCode,401);
    const viewer=await inject({method:'POST',url:'/api/accounts',payload:{username:'viewer',password:'1',allLibraries:true,permissions:{manageLibraries:true}}});
    assert.equal(viewer.statusCode,201,viewer.body);
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-virelo-request':'1'},payload:{username:'viewer',password:'1'}});
    const viewerCookie=login.headers['set-cookie'].split(';')[0];
    for(const [method,url] of [['GET','/api/data'],['DELETE','/api/data/cache']])assert.equal((await app.inject({method,url,headers:{cookie:viewerCookie,'x-virelo-request':'1'}})).statusCode,403);
    assert.equal((await inject({method:'DELETE',url:'/api/data/cache',headers:{'x-virelo-request':''}})).statusCode,403);
    assert.equal((await inject({method:'DELETE',url:'/api/data/cache',headers:{origin:'https://other.example'}})).statusCode,403);
    assert.equal((await inject({method:'DELETE',url:'/api/data/cache',payload:{path:mediaDir}})).statusCode,400);
    const usage=await inject({url:'/api/data'});assert.equal(usage.statusCode,200,usage.body);
    assert.match(usage.headers['cache-control'],/no-store/);assert.equal(usage.json().dataDir,dataDir);
    assert.equal(usage.json().categories.cache.bytes,9);assert.equal(usage.json().cacheLimitBytes,512*1024*1024);
    const clear=await inject({method:'DELETE',url:'/api/data/cache'});assert.equal(clear.statusCode,200,clear.body);
    assert.deepEqual(clear.json(),{deletedFiles:1,freedBytes:9,retainedFiles:0,retainedBytes:0});
    assert.equal((await inject({url:'/api/data'})).json().categories.cache.bytes,0);
    assert.deepEqual((await inject({url:'/api/media/'+item.id})).json(),initialMedia);
    assert.deepEqual(await fingerprint(original),before);
    assert.equal(server.accounts.list().length,2);assert.deepEqual(server.db.visibleLibraries(),[library]);
    assert.equal((await inject({method:'DELETE',url:'/api/media/'+item.id})).statusCode,404);
    assert.deepEqual(await fingerprint(original),before);
    await writeFile(cacheFile,'generated');
    const previous=server.db.addLibrary(join(dataDir,'cache'),'Previous',false);server.db.removeLibrary(previous.id);
    const blocked=await inject({method:'DELETE',url:'/api/data/cache'});assert.equal(blocked.statusCode,409,blocked.body);
    assert.equal(await readFile(cacheFile,'utf8'),'generated');assert.deepEqual(await fingerprint(original),before);
  }finally{if(app)await app.close();await rm(root,{recursive:true,force:true});}
});
