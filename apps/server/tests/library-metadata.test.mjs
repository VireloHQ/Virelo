import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { refreshMetadata, refreshMissingMetadata } from '../dist/metadata.js';
import { parseMediaName } from '../dist/scanner.js';
import { createVireloServer } from '../dist/server.js';

process.env.VIRELO_LOG_LEVEL='silent';
delete process.env.VIRELO_TMDB_API_KEY;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=', 'base64');

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),'virelo-library-metadata-'));
  await Promise.all(['data','Family','Movies'].map(dir=>mkdir(join(root,dir))));
  return root;
}

function insert(db, library, filename, thumbnail=null) {
  const path=join(library.path,filename), {title,year}=parseMediaName(path);
  return db.upsertMedia({
    library_id:library.id,path,filename:basename(path),title,sort_title:title.toLowerCase(),kind:'movie',year,
    series_title:null,season:null,episode:null,duration:60,width:640,height:360,video_codec:'h264',audio_codec:null,
    container:'mp4',folder:'',size:1,mtime:1,thumbnail_path:thumbnail,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null
  });
}

test('only an administrator can opt out a library, clearing just its external matches', async () => {
  const root=await fixture(), dataDir=join(root,'data');
  const {db,app}=await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
  const originalFetch=globalThis.fetch;
  try {
    db.updateSettings({externalMetadataEnabled:false,libraryWatchEnabled:false,externalImagesEnabled:false});
    const family=db.addLibrary(join(root,'Family'),'Family'), movies=db.addLibrary(join(root,'Movies'),'Movies');
    const poster=join(dataDir,'artwork','shared.png'), thumb=join(dataDir,'thumbnails','home.png');
    await Promise.all([writeFile(poster,png),writeFile(thumb,png)]);
    const home=insert(db,family,'Family clip (2019).mp4',thumb), movie=insert(db,movies,'Feature (2021).mp4');
    const reset=insert(db,family,'Unmatched.mp4');
    await writeFile(home.path,'original home video'); await writeFile(movie.path,'original movie');
    const match={title:'Provider match',overview:'Description',genres:'Drama',year:2024,poster_path:poster,backdrop_path:poster,external_id:'fixture'};
    for (const item of [home,movie]) db.updateExternalMetadata(item.id,match);
    db.clearExternalMetadata(reset.id,parseMediaName(reset.path));
    const call=(method,url,payload,cookie)=>app.inject({method,url,payload,remoteAddress:'127.0.0.1',headers:{'x-virelo-request':'1',...(cookie?{cookie}:{})}});
    const account={username:'owner',password:'1234'};
    const setup=await call('POST','/api/auth/setup',account);
    assert.equal(setup.statusCode,200,setup.body);
    const owner=setup.headers['set-cookie'].split(';')[0], ownerId=setup.json().user.id;
    const saved=await call('POST','/api/accounts',{...account,username:'manager',allLibraries:true,permissions:{manageLibraries:true,manageMetadata:true}},owner);
    assert.equal(saved.statusCode,201,saved.body);
    const login=await call('POST','/api/auth/login',{...account,username:'manager'});
    assert.equal(login.statusCode,200,login.body);
    const manager=login.headers['set-cookie'].split(';')[0];
    db.setLike(home.id,true,ownerId);
    db.setProgress(home.id,23,60,ownerId);
    const endpoint='/api/libraries/'+family.id+'/metadata', detail='/api/media/'+home.id;
    assert.equal((await call('PUT',endpoint,{enabled:false},manager)).statusCode,403);
    assert.equal((await call('PUT',endpoint,{enabled:'false'},owner)).statusCode,400);
    assert.equal((await call('PUT','/api/libraries/99999/metadata',{enabled:false},owner)).statusCode,404);
    assert.equal((await call('GET',detail,undefined,owner)).json().title,match.title);

    const disabled=await call('PUT',endpoint,{enabled:false},owner);
    assert.equal(disabled.statusCode,200,disabled.body);
    assert.deepEqual(disabled.json(),{enabled:false});
    const item=(await call('GET',detail,undefined,owner)).json();
    assert.equal(item.libraryMetadataEnabled,false);
    assert.equal(item.title,home.title);
    assert.equal(item.year,2019);
    assert.equal(item.thumbnail_path,thumb);
    assert.equal(item.progress_position,23);
    assert.equal(item.liked,1);
    for (const field of ['external_id','overview','genres','poster_path','backdrop_path']) assert.equal(item[field],null,field);
    assert.deepEqual((await call('GET','/api/libraries',undefined,owner)).json().map(l=>l.metadata_enabled),[0,1]);
    assert.equal((await call('GET',detail+'/artwork/poster',undefined,owner)).statusCode,404);
    assert.equal((await call('GET',detail+'/artwork/thumbnail',undefined,owner)).statusCode,200);
    assert.equal((await call('GET','/api/media/'+movie.id+'/artwork/poster',undefined,owner)).statusCode,200);
    assert.equal(db.getMedia(movie.id).title,match.title);
    assert.equal(await readFile(home.path,'utf8'),'original home video');
    assert.ok(!db.listMetadataCandidates(100,true).some(item=>item.library_id===family.id));

    const requests=[];
    globalThis.fetch=async url=>{
      requests.push(String(url));
      return String(url).includes('/catalog/') ? Response.json({metas:[{id:'found',name:'Rematched title'}]})
        : Response.json({meta:{name:'Rematched title'}});
    };
    const added=insert(db,family,'New clip.mp4');
    db.updateSettings({externalMetadataEnabled:true});
    assert.equal((await call('POST',detail+'/metadata/refresh',undefined,owner)).statusCode,400);
    assert.equal((await refreshMissingMetadata(db,dataDir)).attempted,0);
    assert.equal(requests.length,0,'no requests while the library is off, including for new videos');
    assert.equal((await call('PUT',endpoint,{enabled:true},owner)).statusCode,200);
    assert.equal((await refreshMissingMetadata(db,dataDir)).updated,2);
    assert.equal(db.getMedia(home.id).title,'Rematched title');
    assert.equal(db.getMedia(added.id).title,'Rematched title');
    assert.equal(db.getMedia(reset.id).metadata_blocked,1,'individual clears stay cleared');
    assert.equal(db.getMedia(reset.id).external_id,null);
  } finally {
    globalThis.fetch=originalFetch;
    await app.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('a lookup started before opt-out cannot request more details or put back a match', async () => {
  const root=await fixture(), data=join(root,'data'), db=new VireloDB(data);
  const originalFetch=globalThis.fetch;
  let release;
  try {
    const library=db.addLibrary(join(root,'Family'),'Family'), item=insert(db,library,'Family clip.mp4');
    let requests=0;
    globalThis.fetch=()=>{
      ++requests;
      return new Promise(resolve=>{release=()=>resolve(Response.json({metas:[{id:'pending'}]}));});
    };
    const lookup=refreshMetadata(db,data,item.id);
    assert.equal(requests,1);
    db.setLibraryMetadataEnabled(library.id,false);
    db.setLibraryMetadataEnabled(library.id,true);
    release();
    await assert.rejects(lookup,/refresh was canceled/);
    assert.equal(requests,1);
    assert.equal(db.getMedia(item.id).external_id,null);
  } finally {
    release?.();
    globalThis.fetch=originalFetch;
    db.close();
    await rm(root,{recursive:true,force:true});
  }
});

test('upgrading defaults to enabled; opt-out survives reopening and clears matches transferred from a parent', async () => {
  const root=await fixture(), data=join(root,'data'), parentPath=join(root,'Family'), nestedPath=join(parentPath,'Local');
  await mkdir(nestedPath);
  let db=new VireloDB(data);
  try {
    const parent=db.addLibrary(parentPath,'Parent'), nested=db.addLibrary(nestedPath,'Local');
    db.db.exec('ALTER TABLE libraries DROP COLUMN metadata_enabled');
    db.close(); db=new VireloDB(data);
    assert.equal(db.isLibraryMetadataEnabled(parent.id),true);
    assert.equal(db.isLibraryMetadataEnabled(nested.id),true);
    db.setLibraryMetadataEnabled(nested.id,false);
    db.removeLibrary(nested.id);
    const clip=insert(db,parent,'Local/Clip.mp4');
    db.updateExternalMetadata(clip.id,{title:'Matched clip',external_id:'fixture'});
    assert.equal(db.getMedia(clip.id).title,'Matched clip');
    assert.equal(db.addLibrary(nestedPath,'Local again').id,nested.id);
    assert.equal(db.getMedia(clip.id).library_id,nested.id);
    assert.equal(db.getMedia(clip.id).external_id,null);
    db.close(); db=new VireloDB(data);
    assert.equal(db.isLibraryMetadataEnabled(nested.id),false);
    assert.equal(db.getMedia(clip.id).title,'Clip');
    assert.equal(db.upsertMedia({...clip,library_id:nested.id,title:'Stale scan',external_id:'stale'}).external_id,null);
  } finally {
    db.close();
    await rm(root,{recursive:true,force:true});
  }
});
