import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {VireloDB} from '../dist/db.js';
import {Accounts,hashPassword} from '../dist/accounts.js';
import {createVireloServer} from '../dist/server.js';
import {scanLibrary} from '../dist/scanner.js';
process.env.VIRELO_LOG_LEVEL='silent';

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'virelo-library-lifecycle-'));
  t.after(async()=>{
    const target=relative(resolve(tmpdir()),resolve(root));
    assert.ok(target.startsWith('virelo-library-lifecycle-')&&!target.includes('..'));
    await rm(root,{recursive:true,force:true});
  });
  return root;
}
const media=(library,id=1)=>({
  library_id:library.id,path:join(library.path,'Video '+id+'.mp4'),filename:'Video '+id+'.mp4',title:'Video '+id,sort_title:'video '+id,
  kind:'movie',series_title:null,season:null,episode:null,year:null,duration:60,width:640,height:360,video_codec:'h264',audio_codec:'aac',
  container:'mp4',folder:'',size:1,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null
});
const idle=async server=>{while(server.scanStatus.running)await new Promise(resolve=>setTimeout(resolve,5));};

test('startup folders are temporary; UI additions and promoted folders survive another startup path',async t=>{
  const root=await fixture(t), data=join(root,'data'), first=join(root,'first'), next=join(root,'next'), saved=join(root,'elsewhere');
  await Promise.all([data,first,next,saved].map(path=>mkdir(path)));
  const initial=new VireloDB(data);
  initial.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});initial.close();
  let server=await createVireloServer({dataDir:data,mediaPaths:[first],host:'127.0.0.1',port:0});
  let cookie;
  const call=(method,url,payload)=>server.app.inject({method,url,payload,remoteAddress:'127.0.0.1',headers:{'x-virelo-request':'1',...(cookie?{cookie}:{})}});
  try {
    const setup=await call('POST','/api/auth/setup',{username:'owner',password:'1234'});
    assert.equal(setup.statusCode,200,setup.body);cookie=setup.headers['set-cookie'].split(';')[0];
    const temporary=(await call('GET','/api/libraries')).json();
    assert.equal(temporary.length,1);assert.equal(temporary[0].persistent,0);
    const added=await call('POST','/api/libraries',{path:saved});
    assert.equal(added.statusCode,200,added.body);assert.equal(added.json().persistent,1);await idle(server);
    await server.app.close();
    server=await createVireloServer({dataDir:data,mediaPaths:[next],host:'127.0.0.1',port:0});
    assert.deepEqual((await call('GET','/api/libraries')).json().map(l=>l.path).sort(),[next,saved].sort());
    assert.deepEqual((await call('GET','/api/accounts/libraries')).json().map(l=>l.path).sort(),[next,saved].sort());
    assert.deepEqual((await call('GET','/api/accounts/previous-libraries')).json().map(l=>l.path),[first]);
    const restored=await call('POST','/api/libraries',{path:first});
    assert.equal(restored.json().id,temporary[0].id);assert.equal(restored.json().persistent,1);await idle(server);
    await writeFile(media(restored.json()).path,'test media');
    const item=server.db.upsertMedia(media(restored.json()));
    server.db.setLike(item.id,true,1);server.db.setProgress(item.id,28,60,1);
    await call('DELETE','/api/libraries/'+restored.json().id);
    assert.equal((await call('GET','/api/media/'+item.id)).statusCode,404);
    assert.equal(server.db.getMedia(item.id).id,item.id,'removal keeps the indexed record');
    await call('POST','/api/libraries',{path:first});await idle(server);
    await server.app.close();
    server=await createVireloServer({dataDir:data,mediaPaths:[next],host:'127.0.0.1',port:0});
    assert.equal((await call('GET','/api/libraries')).json().filter(l=>l.persistent).length,2);
    assert.equal(server.db.getMedia(item.id,{userId:1,libraryIds:null}).progress_position,28);
    assert.equal(server.db.getMedia(item.id,{userId:1,libraryIds:null}).liked,1);
  } finally {await idle(server);await server.app.close();}
});

test('legacy folders become recoverable previous folders without erasing metadata or personal state',async t=>{
  const root=await fixture(t);let db=new VireloDB(root);
  const library=db.addLibrary(join(root,'legacy'),'Legacy'), item=db.upsertMedia(media(library));
  db.setLike(item.id,true);db.setProgress(item.id,24,60);
  db.db.exec('ALTER TABLE libraries DROP COLUMN persistent');db.close();
  db=new VireloDB(root);
  try {
    assert.equal(db.visibleLibraries().length,0);assert.equal(db.previousLibraries().length,1);
    db.addLibrary(library.path,library.label);
    assert.equal(db.getMedia(item.id).progress_position,24);assert.equal(db.getMedia(item.id).liked,1);
    assert.equal(db.visibleLibraries()[0].persistent,1);
  } finally {db.close();}
});

test('missing libraries and incomplete scans never prune existing records',async t=>{
  const root=await fixture(t), db=new VireloDB(root);
  try {
    const library=db.addLibrary(join(root,'offline'),'Offline'),item=db.upsertMedia(media(library));
    db.setProgress(item.id,20,60);
    const status={running:true,total:0,scanned:0,added:0,updated:0,skipped:0,errors:0,message:''};
    await scanLibrary(db,library,root,status);
    assert.equal(status.errors,1);assert.equal(db.getMedia(item.id).progress_position,20);
  } finally {db.close();}
});

test('Windows library aliases preserve media IDs, grants, favorites and history',{skip:process.platform!=='win32'},async t=>{
  const root=await fixture(t);let db=new VireloDB(root);
  const first=db.addLibrary(join(root,'Media'),'Media'),item=db.upsertMedia(media(first));
  let accounts=new Accounts(db.db);
  const user=accounts.save({username:'owner',libraryIds:[first.id]},await hashPassword('7'),undefined,true);
  const aliasId=Number(db.db.prepare('INSERT INTO libraries(path,label,created_at,persistent) VALUES(?,?,?,1)').run(first.path.toUpperCase(),'Alias',Date.now()).lastInsertRowid);
  const second=db.upsertMedia({...media({...first,id:aliasId,path:first.path.toUpperCase()},2)});
  accounts.grantLibrary(user.id,aliasId);
  db.setLike(second.id,true,user.id);db.setProgress(second.id,33,60,user.id);db.close();
  db=new VireloDB(root);accounts=new Accounts(db.db);
  try {
    assert.equal(db.listLibraries().length,1);
    assert.equal(db.addLibrary(first.path.toUpperCase(),'Again').id,first.id);
    assert.equal(db.getMedia(item.id).library_id,first.id);assert.equal(db.getMedia(second.id).library_id,first.id);
    assert.deepEqual(accounts.get(user.id).libraryIds,[first.id]);
    assert.equal(db.getMedia(second.id,accounts.scope(accounts.get(user.id))).liked,1);
    db.deleteMissingForLibrary(first.id,new Set([item.path.toUpperCase(),second.path.toLowerCase()]));
    assert.equal(db.getMedia(second.id,accounts.scope(accounts.get(user.id))).progress_position,33);
  } finally {db.close();}
});
