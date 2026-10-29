import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createVireloServer} from '../dist/server.js';
import {VireloDB} from '../dist/db.js';
import {hashPassword} from '../dist/accounts.js';
import {libraryName,libraryFolder} from '../dist/library-names.js';
import {libraryName as browserName,libraryFolder as browserFolder} from '../web/src/utils/library-names.ts';
import {libraryFolderChildren,folderDisplayName} from '../web/src/utils/library-folder-children.ts';

test('display-name validation agrees in both editions and rejects unsafe folder identifiers',()=>{
  for(const validate of [libraryName,browserName]){
    assert.equal(validate('  名前 📁  '),'名前 📁');
    assert.equal(validate('x'.repeat(200)).length,200);
    for(const value of [undefined,null,{},'',' ','x'.repeat(201),'a\nb','a\0b'])
      assert.throws(()=>validate(value),error=>error.statusCode===400);
  }
  for(const validate of [libraryFolder,browserFolder]){
    for(const folder of ['','Shows/Season 1','__proto__','constructor'])assert.equal(validate(folder),folder);
    for(const folder of [null,1,'/absolute','../escape','Shows/../escape','Shows//Empty','Shows/','Shows\\\\Season','x'.repeat(4097),'a\nb'])
      assert.throws(()=>validate(folder),error=>error.statusCode===400);
  }
});

test('folder navigation keeps physical identity separate from labels and other libraries',()=>{
  const libraries=[{id:1,label:'A',folderLabels:{Shows:'Series'}},{id:2,label:'B'}];
  const entries=[{library_id:1,folder:'Shows/Season 1',count:2},{library_id:2,folder:'Shows/Season 1',count:3},{library_id:3,folder:'Private',count:9},{library_id:1,folder:'',count:1}];
  assert.deepEqual(libraryFolderChildren(entries,libraries,null,null),[
    {libraryId:1,folder:'Shows',name:'Shows',count:2},{libraryId:2,folder:'Shows',name:'Shows',count:3}
  ]);
  assert.deepEqual(libraryFolderChildren(entries,libraries,1,'Shows'),[{libraryId:1,folder:'Shows/Season 1',name:'Season 1',count:2}]);
  assert.equal(folderDisplayName(libraries[0],'Shows','Shows'),'Series');
  assert.equal(folderDisplayName(libraries[1],'Shows','Shows'),'Shows');
  assert.equal(folderDisplayName({folderLabels:{}},'constructor','Original'),'Original');
  assert.equal(folderDisplayName({folderLabels:JSON.parse('{"__proto__":"Named folder"}')},'__proto__','Original'),'Named folder');
});

test('library and folder display names are scoped, persistent and never rename source files',async t=>{
  process.env.VIRELO_LOG_LEVEL='silent';
  const root=await mkdtemp(join(tmpdir(),'virelo-library-names-')),data=join(root,'data');
  let server=await createVireloServer({dataDir:data,mediaPaths:[],host:'127.0.0.1',port:0});
  const originals=[];
  try {
    server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
    const libraries=[];
    for(const name of ['A','B']){
      const path=join(root,name);await mkdir(join(path,'Shows','Season 1'),{recursive:true});
      const library=server.db.addLibrary(path,name),source=join(path,'Shows','Season 1','Clip.mp4');
      await writeFile(source,'Original source '+name);originals.push([source,await readFile(source)]);
      const item=server.db.upsertMedia({library_id:library.id,path:source,filename:'Clip.mp4',title:'Clip '+name,sort_title:'clip '+name,kind:'movie',series_title:null,season:null,episode:null,year:null,duration:120,width:320,height:180,video_codec:'h264',audio_codec:null,container:'mp4',folder:'Shows/Season 1',size:1,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null});
      libraries.push({...library,mediaId:item.id});
    }
    const setup=await server.app.inject({method:'POST',url:'/api/auth/setup',headers:{'x-virelo-request':'1'},payload:{username:'owner',password:'1'}});
    assert.equal(setup.statusCode,200,setup.body);
    const owner=setup.headers['set-cookie'].split(';')[0];
    const login=async username=>{const result=await server.app.inject({method:'POST',url:'/api/auth/login',headers:{'x-virelo-request':'1'},payload:{username,password:'1'}});assert.equal(result.statusCode,200,result.body);return result.headers['set-cookie'].split(';')[0];};
    const call=(method,url,body,cookie=owner)=>server.app.inject({method,url,payload:body,headers:{cookie,'x-virelo-request':'1'}});
    await server.accounts.save({username:'viewer',allLibraries:false,libraryIds:[libraries[0].id]},await hashPassword('1'));
    await server.accounts.save({username:'delegate',allLibraries:false,libraryIds:[libraries[0].id],permissions:{manageLibraries:true}},await hashPassword('1'));
    const viewer=await login('viewer'),delegate=await login('delegate'),url='/api/libraries/'+libraries[0].id;
    server.db.setLike(libraries[0].mediaId,true,1);server.db.setProgress(libraries[0].mediaId,37,120,1);
    const playlist=await call('POST','/api/playlists',{name:'Keep references',mediaIds:[libraries[0].mediaId]});assert.equal(playlist.statusCode,200,playlist.body);
    assert.equal((await call('PATCH',url,{label:'Denied'},viewer)).statusCode,403);
    assert.equal((await call('PATCH','/api/libraries/'+libraries[1].id,{label:'Hidden'},delegate)).statusCode,404);
    assert.equal((await server.app.inject({method:'PATCH',url,headers:{cookie:owner},payload:{label:'No CSRF header'}})).statusCode,403);
    for(const body of [{label:''},{label:'x'.repeat(201)},{label:'Bad\nName'},{label:'Name',folder:'../escape'},{label:'Name',folder:'/absolute'}])
      assert.equal((await call('PATCH',url,body)).statusCode,400);
    assert.equal((await call('PATCH',url,{label:'Missing',folder:'Missing'})).statusCode,404);
    for(const body of [{label:'Renamed library'},{label:'Series',folder:'Shows'},{label:'First season',folder:'Shows/Season 1'}]){
      const result=await call('PATCH',url,body,delegate);assert.equal(result.statusCode,200,result.body);
    }
    const visible=(await call('GET','/api/libraries',undefined,delegate)).json();
    assert.equal(visible.length,1);assert.equal(visible[0].label,'Renamed library');
    assert.deepEqual(visible[0].folderLabels,{Shows:'Series','Shows/Season 1':'First season'});
    assert.deepEqual(server.db.folderLabels(libraries[1].id),{});
    const item=server.db.getMedia(libraries[0].mediaId,{userId:1,libraryIds:null});
    assert.equal(item.path,originals[0][0]);assert.equal(item.folder,'Shows/Season 1');assert.equal(item.liked,1);assert.equal(item.progress_position,37);
    assert.equal((await call('GET','/api/playlists/'+playlist.json().id)).json().items[0].id,item.id);
    server.db.addLibrary(join(libraries[0].path,'Shows','Season 1'),'Private nested library');
    const restricted=(await call('GET','/api/libraries',undefined,delegate)).json();
    assert.deepEqual(restricted[0].folderLabels,{},'stale aliases cannot disclose a folder reassigned to a hidden nested library');
    assert.equal((await call('PATCH',url,{label:'Private alias',folder:'Shows'},delegate)).statusCode,404);
    assert.deepEqual((await call('PATCH',url,{label:'Renamed library'},delegate)).json().folderLabels,{},'rename responses enforce the same nested visibility');
    await server.app.close();server=null;
    const db=new VireloDB(data);
    try {assert.equal(db.addLibrary(libraries[0].path,'Original startup name').label,'Renamed library');assert.equal(db.folderLabels(libraries[0].id)['Shows/Season 1'],'First season');}
    finally {db.close();}
    for(const [source,bytes] of originals)assert.deepEqual(await readFile(source),bytes);
  } finally {if(server)await server.app.close();await rm(root,{recursive:true,force:true});}
});
