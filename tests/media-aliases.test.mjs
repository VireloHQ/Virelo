import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {VireloDB} from '../dist/db.js';
import {Accounts,hashPassword} from '../dist/accounts.js';

test('Windows collections collapse legacy case aliases before paging while retaining personal state and old links',{skip:process.platform!=='win32'},async t=>{
  const data=await mkdtemp(join(tmpdir(),'virelo-media-aliases-')),db=new VireloDB(data);
  t.after(async()=>{db.close();await rm(data,{recursive:true,force:true});});
  const library=db.addLibrary(join(data,'Media'),'Media');
  const input={library_id:library.id,path:join(library.path,'Example.mp4'),filename:'Example.mp4',title:'Example',sort_title:'example',kind:'movie',
    series_title:null,season:null,episode:null,year:null,duration:120,width:180,height:320,video_codec:'h264',audio_codec:'aac',container:'mp4',
    folder:'',size:1,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null};
  const first=db.upsertMedia(input);
  const columns=db.db.prepare('PRAGMA table_info(media)').all().map(c=>c.name).filter(n=>!['id','path'].includes(n));
  const alias=Number(db.db.prepare(`INSERT INTO media(path,${columns.join(',')}) SELECT ?,${columns.join(',')} FROM media WHERE id=?`).run(input.path.toLowerCase(),first.id).lastInsertRowid);
  const second=db.upsertMedia({...input,path:join(library.path,'Other.mp4'),title:'Other',sort_title:'other'});
  const accounts=new Accounts(db.db),owner=accounts.save({username:'owner'},await hashPassword('1'),undefined,true);
  const viewer=accounts.save({username:'viewer'},await hashPassword('2'));
  const scope=accounts.scope(owner),otherScope={userId:viewer.id,libraryIds:[library.id]};
  db.db.prepare('INSERT INTO user_progress VALUES(?,?,20,120,0,100)').run(owner.id,first.id);
  db.db.prepare('INSERT INTO user_progress VALUES(?,?,40,120,0,200)').run(owner.id,alias);
  db.setLike(alias,true,owner.id);
  db.db.prepare('INSERT INTO progress VALUES(?,30,120,0,100)').run(alias);db.setLike(alias,true);
  const before=()=>JSON.stringify(['progress','likes','user_progress','user_likes'].map(table=>db.db.prepare(`SELECT * FROM ${table} ORDER BY media_id`).all()));
  const snapshot=before();
  for(const access of [undefined,scope]){
    const list=db.listMedia({limit:1,offset:0},access),next=db.listMedia({limit:1,offset:1},access);
    assert.equal(list[0].id,first.id);assert.equal(next[0].id,second.id);assert.equal(db.listMedia({limit:1,offset:2},access).length,0);
    assert.equal(list[0].progress_position,access?40:30);assert.equal(list[0].liked,1);
    assert.deepEqual(db.listMedia({liked:true},access).map(x=>x.id),[first.id]);
    assert.equal(db.getHome(access).total,2);assert.equal(db.getHome(access).continueWatching.length,1);
    assert.equal(db.getFolders(access)[0].count,2);
    assert.equal(db.getShorts({},access).total,2);assert.equal(db.getShorts({startId:alias,limit:1},access).items[0].id,first.id);
    assert.equal(db.getShorts({offset:2},access).items.length,0);
    for(const id of [first.id,alias]){assert.equal(db.getMedia(id,access).id,id);assert.equal(db.getMedia(id,access).liked,1);}
  }
  assert.equal(before(),snapshot,'collection reads never migrate or delete personal records');
  assert.equal(db.getMedia(alias,otherScope).liked,0);assert.equal(db.getMedia(alias,otherScope).progress_position,null);
  assert.equal(db.getMedia(alias,{userId:viewer.id,libraryIds:[]}),undefined);
  assert.equal(db.listMedia({}, {userId:viewer.id,libraryIds:[]}).length,0);
  assert.equal(db.getHome({userId:viewer.id,libraryIds:[]}).total,0);
  db.setLike(first.id,true,viewer.id);db.setProgress(first.id,50,120,viewer.id);
  db.setLike(first.id,false,owner.id);assert.equal(db.listMedia({liked:true},scope).length,0);
  assert.equal(db.getMedia(alias,otherScope).liked,1,'another account keeps its own favorite');
  db.setProgress(first.id,0,120,owner.id);
  for(const id of [first.id,alias])assert.equal(db.getMedia(id,scope).progress_position,0,'new saves cannot resurrect stale alias progress');
  assert.equal(db.getMedia(alias,otherScope).progress_position,50);
  db.setProgress(alias,119,120,owner.id);assert.equal(db.getMedia(first.id,scope).progress_completed,1);
  db.setLike(first.id,false);assert.equal(db.getMedia(alias).liked,0);
  assert.equal(db.db.prepare('SELECT COUNT(*) AS count FROM media').get().count,3,'historical IDs are retained');
  // A hidden older alias must not suppress a file in a visible library.
  const hidden=db.addLibrary(join(data,'Hidden'),'Hidden');
  db.db.prepare('UPDATE media SET library_id=? WHERE id=?').run(hidden.id,first.id);
  const visible=db.listMedia({},otherScope);assert.deepEqual(visible.map(x=>x.id),[alias,second.id]);
  assert.equal(db.getMedia(first.id,otherScope),undefined);
});
