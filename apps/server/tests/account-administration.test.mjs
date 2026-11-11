import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { hashPassword, sessionDigest } from '../dist/accounts.js';
import { AccountActivity } from '../dist/account-activity.js';

process.env.VIRELO_LOG_LEVEL='silent';
test('account administration: disclosed monitoring, scope, retention and database-only user data controls', {timeout:30000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-administration-'));
  let server=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
  t.after(async()=>{await server.app.close();assert.ok(relative(resolve(tmpdir()),resolve(root)).startsWith('virelo-administration-'));await rm(root,{recursive:true,force:true});});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const call=(method,url,payload,cookie,headers={})=>server.app.inject({method,url,payload,remoteAddress:'127.0.0.1',headers:{'x-virelo-request':'1',...(cookie?{cookie}:{}),...headers}});
  const cookieOf=result=>{assert.equal(result.statusCode,200,result.body);return result.headers['set-cookie'].split(';')[0];};
  const owner=cookieOf(await call('POST','/api/auth/setup',{username:'owner',password:'1'}));
  const ownerId=server.accounts.list()[0].id;
  const items=[];
  for(const label of ['Shared','Secret']){
    const folder=join(root,label);await mkdir(folder);const path=join(folder,label+'.mp4');await writeFile(path,'Original '+label);
    const library=server.db.addLibrary(folder,label);
    items.push(server.db.upsertMedia({library_id:library.id,path,filename:label+'.mp4',title:label,sort_title:label,kind:'video',folder:'',size:15,mtime:1,duration:60,width:160,height:90,video_codec:'h264',audio_codec:'aac',container:'mp4',series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}));
  }
  const hash=await hashPassword('1');
  const viewer=server.accounts.save({username:'viewer',displayName:'Viewer',libraryIds:[items[0].library_id]},hash);
  const other=server.accounts.save({username:'other',libraryIds:items.map(item=>item.library_id)},hash);
  const restricted=server.accounts.save({username:'restricted',isAdmin:true,allLibraries:false,libraryIds:[items[0].library_id]},hash);
  const session=user=>'virelo_session='+server.accounts.createSession(user);
  let viewerCookie=session(viewer);const otherCookie=session(other),restrictedCookie=session(restricted);
  let policy=(await call('GET','/api/accounts/monitoring',undefined,owner)).json();
  const heartbeat=(cookie,mediaId=null,state='idle',noticeVersion=policy.revision,tabId='administration-test-tab')=>call('POST','/api/auth/activity',{mediaId,state,position:12,noticeVersion,tabId},cookie);
  const events=async(cookie=owner,url='/api/accounts/activity')=>{const response=await call('GET',url,undefined,cookie);assert.equal(response.statusCode,200,response.body);return response.json();};

  await t.test('monitoring is off by default; policy is public but user data is administrator-only',async()=>{
    assert.deepEqual(policy,{enabled:false,retentionDays:30,revision:0,maxEvents:10000});
    assert.deepEqual((await heartbeat(viewerCookie,items[0].id,'playing')).json(),{accepted:false});
    assert.deepEqual((await events()).events,[]);
    for(const [method,url,payload] of [['GET','/api/accounts/activity'],['DELETE','/api/accounts/activity'],['GET','/api/accounts/monitoring'],['POST','/api/accounts/monitoring',policy],['GET',`/api/accounts/${ownerId}/data`],['DELETE',`/api/accounts/${ownerId}/data`,{category:'history'}]]){
      assert.equal((await call(method,url,payload,viewerCookie)).statusCode,403,method+url);
      assert.equal((await call(method,url,payload)).statusCode,401,method+url);
    }
    assert.equal((await server.app.inject({method:'POST',url:'/api/accounts/monitoring',payload:{...policy,enabled:true},headers:{cookie:owner}})).statusCode,403);
    const publicStatus=(await call('GET','/api/auth/status')).json();assert.deepEqual(publicStatus.monitoring,policy);assert.equal(publicStatus.user,null);assert.ok(!JSON.stringify(publicStatus).includes('Viewer'));
  });
  await t.test('collection waits for a current notice and policy changes invalidate old acknowledgements',async()=>{
    for(const patch of [{enabled:'yes'},{retentionDays:1},{retentionDays:'30'}])assert.equal((await call('POST','/api/accounts/monitoring',{...policy,...patch},owner)).statusCode,400);
    const enabled=await call('POST','/api/accounts/monitoring',{...policy,enabled:true},owner);assert.equal(enabled.statusCode,200,enabled.body);policy=enabled.json();
    assert.equal((await call('POST','/api/accounts/monitoring',{...policy,revision:0},owner)).statusCode,409);
    await call('POST',`/api/media/${items[0].id}/like`,{liked:true},viewerCookie);
    assert.equal((await events()).events.some(event=>event.actorId===viewer.id),false,'no pre-notice operation logging');
    assert.deepEqual((await heartbeat(viewerCookie,null,'idle',0)).json(),{accepted:false});
    assert.deepEqual((await heartbeat(viewerCookie)).json(),{accepted:true});
    await call('POST',`/api/media/${items[0].id}/like`,{liked:false},viewerCookie);
    assert.ok((await events()).events.some(event=>event.action==='favorites.updated'&&event.actorId===viewer.id));
    const staleRevision=policy.revision;
    policy=(await call('POST','/api/accounts/monitoring',{...policy,retentionDays:7},owner)).json();
    assert.deepEqual((await heartbeat(viewerCookie,null,'idle',staleRevision)).json(),{accepted:false});
    const count=(await events()).events.length;
    await call('POST',`/api/media/${items[0].id}/like`,{liked:true},viewerCookie);
    assert.equal((await events()).events.length,count,'old notice does not authorize logs under new policy');
    await heartbeat(viewerCookie);await heartbeat(owner);
    const login=await call('POST','/api/auth/login',{username:'viewer',password:'1',noticeVersion:policy.revision});viewerCookie=cookieOf(login);
    assert.ok((await events()).events.some(event=>event.action==='auth.login'&&event.actorId===viewer.id));
  });
  await t.test('playback events deduplicate, reject inaccessible media and mask titles outside administrator access',async()=>{
    assert.equal((await heartbeat(viewerCookie,items[1].id,'playing')).statusCode,404);
    for(const patch of [{tabId:'x'},{position:-1},{state:'bad'},{state:['idle']},{noticeVersion:1.5},{mediaId:1,state:'idle'},{mediaId:true,state:'playing'}]){
      assert.equal((await call('POST','/api/auth/activity',{mediaId:null,state:'idle',position:0,noticeVersion:policy.revision,tabId:'administration-test-tab',...patch},viewerCookie)).statusCode,400);
    }
    await heartbeat(viewerCookie,items[0].id,'playing');const count=(await events()).events.length;
    await heartbeat(viewerCookie,items[0].id,'playing');assert.equal((await events()).events.length,count);
    await heartbeat(viewerCookie,items[0].id,'paused');await heartbeat(viewerCookie,items[0].id,'playing');await heartbeat(viewerCookie);
    const actions=(await events()).events.filter(event=>event.actorId===viewer.id).map(event=>event.action);
    for(const action of ['playback.started','playback.paused','playback.resumed','playback.stopped'])assert.ok(actions.includes(action),action);
    await heartbeat(otherCookie,items[1].id,'playing');
    const scoped=await events(restrictedCookie);assert.ok(!JSON.stringify(scoped).includes('Secret'));
    const hidden=scoped.active.find(entry=>entry.userId===other.id);assert.equal(hidden.mediaId,null);assert.equal(hidden.title,'Unavailable or restricted video');
    assert.ok(scoped.events.some(event=>event.actorId===other.id&&event.mediaId===null&&event.title==='Unavailable or restricted video'));
    const all=await events();assert.ok(all.active.some(entry=>entry.userId===other.id&&entry.title==='Secret'));
    for(const forbidden of ['digest','password','remoteAddress',root,viewerCookie.split('=')[1]])assert.ok(!JSON.stringify(all).includes(forbidden));
    server.accounts.revoke(other.id);assert.equal((await events()).active.some(entry=>entry.userId===other.id),false);
  });
  await t.test('per-user clears are isolated and never change originals or other accounts',async()=>{
    for(const [id,cookie] of [[viewer.id,viewerCookie],[ownerId,owner]]){
      server.db.setLike(items[0].id,true,id);server.db.setProgress(items[0].id,25,60,id);
      const playlist=await call('POST','/api/playlists',{name:'Saved videos',mediaIds:[items[0].id]},cookie);assert.equal(playlist.statusCode,200,playlist.body);
    }
    const summary=await call('GET',`/api/accounts/${viewer.id}/data`,undefined,owner);assert.equal(summary.statusCode,200,summary.body);
    assert.equal(summary.json().history,1);assert.equal(summary.json().favorites,1);assert.equal(summary.json().playlists,1);assert.equal(summary.json().playlistItems,1);assert.ok(summary.json().sessions>0);
    for(const category of ['__proto__','path','media',null])assert.equal((await call('DELETE',`/api/accounts/${viewer.id}/data`,{category},owner)).statusCode,400);
    for(const category of ['history','favorites','playlists','activity']){
      const result=await call('DELETE',`/api/accounts/${viewer.id}/data`,{category},owner);assert.equal(result.statusCode,200,result.body);
      if(category!=='activity')assert.equal(result.json()[category],0);
    }
    const own=(await call('GET',`/api/accounts/${ownerId}/data`,undefined,owner)).json();assert.equal(own.history,1);assert.equal(own.favorites,1);assert.equal(own.playlists,1);
    assert.equal(server.db.db.prepare('SELECT COUNT(*) n FROM playlist_items').get().n,1,'deleted playlist entries cascade');
    await heartbeat(viewerCookie,items[0].id,'playing');
    const revoked=await call('DELETE',`/api/accounts/${viewer.id}/data`,{category:'sessions'},owner);assert.equal(revoked.statusCode,200,revoked.body);assert.equal(revoked.json().sessions,0);
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).statusCode,401);assert.equal((await events()).active.some(entry=>entry.userId===viewer.id),false);
    for(const item of items)assert.equal(await readFile(item.path,'utf8'),'Original '+item.title);
    assert.equal((await call('GET','/api/accounts/999999/data',undefined,owner)).statusCode,404);
  });
  await t.test('logs persist, expire, paginate and remain bounded; disabling stops new collection',async()=>{
    const activity=new AccountActivity(server.db,server.accounts),insert=server.db.db.prepare('INSERT INTO account_activity(created_at,actor_id,action,retention_days) VALUES(?,?,?,?)');
    assert.doesNotThrow(()=>activity.record(999999,'library.scanned',null,null,true),'completion after account deletion does not resurrect personal events');
    insert.run(Date.now()-8*86400_000,ownerId,'expired',7);
    policy=(await call('POST','/api/accounts/monitoring',{...policy,retentionDays:90},owner)).json();
    assert.equal(server.db.db.prepare("SELECT COUNT(*) n FROM account_activity WHERE action='expired'").get().n,0,'a policy increase never extends an older event beyond its original notice');
    server.db.db.exec('BEGIN');for(let i=0;i<10005;i++)insert.run(Date.now(),ownerId,'library.scanned',90);server.db.db.exec('COMMIT');
    activity.record(ownerId,'library.scanned',null,null,true);
    assert.equal(server.db.db.prepare('SELECT COUNT(*) n FROM account_activity').get().n,10000);
    assert.equal(server.db.db.prepare("SELECT COUNT(*) n FROM account_activity WHERE action='expired'").get().n,0);
    const page=await events();assert.equal(page.events.length,50);assert.ok(page.nextBefore);
    const older=await events(owner,'/api/accounts/activity?before='+page.nextBefore);assert.ok(older.events.every(event=>event.id<page.nextBefore));
    const filtered=await events(owner,'/api/accounts/activity?userId='+viewer.id);assert.ok(filtered.events.every(event=>event.actorId===viewer.id||event.targetId===viewer.id));
    const token=owner.split('=')[1];server.db.db.prepare('UPDATE account_sessions SET last_seen=? WHERE digest=?').run(Date.now()-2*86400_000,sessionDigest(token));
    assert.equal((await call('GET','/api/accounts/activity',undefined,owner)).statusCode,401);
    const replacement=cookieOf(await call('POST','/api/auth/login',{username:'owner',password:'1',noticeVersion:policy.revision}));
    policy=(await call('POST','/api/accounts/monitoring',{...policy,enabled:false},replacement)).json();
    const before=server.db.db.prepare('SELECT COUNT(*) n FROM account_activity').get().n;
    await heartbeat(replacement,items[0].id,'playing');assert.equal(server.db.db.prepare('SELECT COUNT(*) n FROM account_activity').get().n,before);assert.deepEqual((await events(replacement)).active,[]);
    await server.app.close();server=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
    assert.deepEqual((await call('GET','/api/accounts/monitoring',undefined,replacement)).json(),policy);assert.equal((await events(replacement)).events.length,50);
    assert.equal((await call('DELETE','/api/accounts/activity',undefined,replacement)).statusCode,200);assert.equal((await events(replacement)).events.length,0);
  });
});
