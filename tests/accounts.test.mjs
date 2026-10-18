import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, open, rm, access } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createVireloServer } from '../dist/server.js';
import { hashPassword, verifyPassword, sessionDigest } from '../dist/accounts.js';

process.env.VIRELO_LOG_LEVEL = 'silent';
const password = 'A private test passphrase 2026';
const cookieOf = response => { assert.ok(response.headers['set-cookie']); return response.headers['set-cookie'].split(';')[0]; };

test('passwords use salted scrypt and support long Unicode passphrases', async () => {
  const one = await hashPassword(password), two = await hashPassword(password);
  assert.notEqual(one,two);
  assert.match(one,/^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(password,one),true);
  assert.equal(await verifyPassword(password+'x',one),false);
  assert.equal(await verifyPassword(password),false);
  for (const pin of ['1','1234','short']) assert.equal(await verifyPassword(pin,await hashPassword(pin)),true);
  await assert.rejects(hashPassword(''));
  await assert.rejects(hashPassword('x'.repeat(1025)));
  assert.equal(await verifyPassword('秘密の合言葉を十五文字より長く設定する',await hashPassword('秘密の合言葉を十五文字より長く設定する')),true);
});

test('accounts enforce authentication, catalog privacy and administrative boundaries', {timeout:40000}, async t => {
  const root = await mkdtemp(join(tmpdir(),'virelo-accounts-test-'));
  const server = await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
  const {app,db,accounts} = server;
  t.after(async()=>{await app.close();const rel=relative(resolve(tmpdir()),resolve(root));assert.ok(rel.startsWith('virelo-accounts-test-')&&!rel.includes('..'));await rm(root,{recursive:true,force:true});});
  db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const items=[];
  for (const label of ['Shared','Hidden']) {
    const path=join(root,label);await mkdir(path);
    const library=db.addLibrary(path,label), file=join(path,label+'.mp4'), art=join(path,'thumb.jpg');
    await writeFile(file,Buffer.from('Private video bytes for '+label));await writeFile(art,'private artwork '+label);
    items.push(db.upsertMedia({library_id:library.id,path:file,filename:label+'.mp4',title:label,sort_title:label.toLowerCase(),kind:'movie',
      series_title:null,season:null,episode:null,year:null,duration:120,width:180,height:320,video_codec:'h264',audio_codec:'aac',container:'mp4',
      folder:'',size:30,mtime:1,thumbnail_path:art,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}));
  }
  db.setLike(items[0].id,true);db.setProgress(items[0].id,42,120);
  const call=(method,url,payload,cookie,extra={})=>app.inject({method,url,payload,remoteAddress:'127.0.0.1',...extra,headers:{'x-virelo-request':'1',...(cookie?{cookie}:{}),...extra.headers}});
  let loginNumber=1;
  const login=async(username,secret=password,peer='127.0.0.'+(++loginNumber))=>{
    const result=await call('POST','/api/auth/login',{username,password:secret},undefined,{remoteAddress:peer});
    assert.equal(result.statusCode,200,result.body);return cookieOf(result);
  };
  let ownerCookie, viewerCookie, viewerId;

  await t.test('only a direct localhost client can initialize; setup is atomic',async()=>{
    assert.deepEqual((await call('GET','/api/auth/status')).json(),{setupRequired:true,localAccess:true,user:null});
    for (const extra of [{remoteAddress:'192.168.1.2',headers:{'x-forwarded-for':'127.0.0.1'}},{headers:{forwarded:'for=127.0.0.1'}},{headers:{'x-forwarded-for':'127.0.0.1'}},{headers:{host:'attacker.local',origin:'http://attacker.local'}}])
      assert.equal((await call('POST','/api/auth/setup',{username:'owner',password},undefined,extra)).statusCode,403);
    const results=await Promise.all([1,2].map(()=>call('POST','/api/auth/setup',{username:'owner',password})));
    assert.deepEqual(results.map(result=>result.statusCode).sort(),[200,409]);
    const setup=results.find(result=>result.statusCode===200);ownerCookie=cookieOf(setup);
    assert.match(setup.headers['set-cookie'],/HttpOnly; SameSite=Strict/);
    assert.equal(accounts.list().length,1);
    assert.equal(setup.json().user.isAdmin,true);
    const stored=accounts.db.prepare('SELECT digest FROM account_sessions').get().digest;
    assert.notEqual(stored,ownerCookie.split('=')[1]);assert.equal(stored,sessionDigest(ownerCookie.split('=')[1]));
    assert.equal((await call('POST','/api/auth/setup',{username:'again',password})).statusCode,409);
    assert.deepEqual((await call('GET','/api/auth/status',undefined,undefined,{remoteAddress:'10.0.0.2'})).json(),{setupRequired:false,localAccess:false,user:null});
  });
  await t.test('anonymous clients cannot fetch catalogs, video ranges, artwork, subtitles or cached playback',async()=>{
    for(const url of ['/api/health','/api/settings','/api/home','/api/libraries','/api/folders','/api/media','/api/shorts',`/api/media/${items[0].id}/stream`,
      `/api/media/${items[0].id}/artwork/thumbnail`,`/api/media/${items[0].id}/subtitles/0`,`/hls/${items[0].id}/subtitles/0.vtt`,`/audio/${items[0].id}/audio.m4a`,`/playback/${items[0].id}/stamp/adaptive/default/index.m3u8`]) {
      const response=await call('GET',url,undefined,undefined,{headers:{range:'bytes=0-8'}});
      assert.equal(response.statusCode,401,url);assert.equal(response.headers['cache-control'],'private, no-store');
    }
    assert.equal((await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'owner',password}})).statusCode,403,'custom request header is required');
    assert.equal((await call('POST','/api/auth/login',{username:'owner',password},undefined,{headers:{origin:'https://evil.example'}})).statusCode,403);
  });
  await t.test('the last enabled administrator cannot be removed, disabled or demoted',async()=>{
    const id=accounts.list()[0].id;
    for(const patch of [{isAdmin:false},{enabled:false}]) assert.equal((await call('PATCH','/api/accounts/'+id,patch,ownerCookie)).statusCode,409);
    assert.equal((await call('DELETE','/api/accounts/'+id,undefined,ownerCookie)).statusCode,409);
    assert.equal((await call('PATCH','/api/accounts/not-an-id',{},ownerCookie)).statusCode,400);
  });
  await t.test('new accounts default to no libraries and cannot administer the server',async()=>{
    const result=await call('POST','/api/accounts',{username:'viewer',password},ownerCookie);
    assert.equal(result.statusCode,201,result.body);viewerId=result.json().id;
    assert.equal(result.json().allLibraries,false);assert.deepEqual(result.json().libraryIds,[]);
    assert.ok(!result.body.includes('password_hash'));
    viewerCookie=await login('VIEWER');
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).json().total,0);
    for(const [method,url,payload] of [['GET','/api/accounts'],['POST','/api/accounts',{username:'attacker',password}],['GET','/api/accounts/libraries'],['POST','/api/accounts/security',{adminLocalOnly:true}],['POST','/api/settings',{}],['POST','/api/libraries',{path:root}],['DELETE','/api/metadata'],['POST','/api/scan']])
      assert.equal((await call(method,url,payload,viewerCookie)).statusCode,403,method+url);
    assert.equal((await call('GET','/api/media/'+items[0].id,undefined,viewerCookie)).statusCode,404);
  });
  await t.test('all catalog entry points and direct resources enforce the same library allowlist',async()=>{
    assert.equal((await call('PATCH','/api/accounts/'+viewerId,{libraryIds:[items[0].library_id]},ownerCookie)).statusCode,200);
    const stale=await call('PATCH','/api/accounts/'+viewerId,{revision:1,allLibraries:true},ownerCookie);
    assert.equal(stale.statusCode,409,'stale admin editors cannot overwrite newer access permissions');
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).statusCode,401,'old session is revoked');
    viewerCookie=await login('viewer');
    for(const url of ['/api/media','/api/media?sort=random','/api/media?search=Hidden','/api/media?libraryId='+items[1].library_id,'/api/home','/api/shorts?startId='+items[1].id,'/api/folders','/api/libraries']){
      const result=await call('GET',url,undefined,viewerCookie);assert.equal(result.statusCode,200,result.body);assert.ok(!result.body.includes('Hidden'),url);assert.ok(!result.body.includes(root.replaceAll('\\','\\\\')),url);
    }
    const hidden=items[1].id;
    for(const [method,url,payload] of [['GET',`/api/media/${hidden}`],['GET',`/api/media/${hidden}/stream`],['HEAD',`/api/media/${hidden}/artwork/thumbnail`],['GET',`/api/media/${hidden}/playback`],
      ['GET',`/api/media/${hidden}/subtitles/0`],['GET',`/api/media/${hidden}/transcode/status`],['POST',`/api/media/${hidden}/quality/start`,{}],['POST',`/api/media/${hidden}/like`,{liked:true}],['POST',`/api/media/${hidden}/progress`,{position:80,duration:120}],
      ['DELETE',`/api/media/${hidden}/metadata`],['GET',`/hls/${hidden}/subtitles/0.vtt`],['GET',`/hls/%32/subtitles/0.vtt`],['GET',`/audio/${hidden}/audio.m4a`],['GET',`/playback/${hidden}/stamp/adaptive/default/index.m3u8`]])
      assert.equal((await call(method,url,payload,viewerCookie)).statusCode,404,url);
    const stream=await call('GET',`/api/media/${items[0].id}/stream`,undefined,viewerCookie,{headers:{range:'bytes=0-6'}});
    assert.equal(stream.statusCode,206);assert.equal(stream.body,'Private');assert.equal(stream.headers['cache-control'],'private, no-store');
    assert.equal((await call('GET',`/api/media/${items[0].id}/artwork/thumbnail`,undefined,viewerCookie)).headers['cache-control'],'private, no-store');
    const secretCache=join(root,'cache','hls',String(items[1].id),'subtitles');await mkdir(secretCache,{recursive:true});await writeFile(join(secretCache,'0.vtt'),'SECRET SUBTITLE');
    for(const traversal of ['../','%2e%2e/','..%2f','%252e%252e/','..%5c']) {
      const result=await call('GET',`/hls/${items[0].id}/${traversal}${items[1].id}/subtitles/0.vtt`,undefined,viewerCookie);
      assert.equal(result.statusCode,404,traversal);assert.ok(!result.body.includes('SECRET'));
    }
  });
  await t.test('legacy favorites and progress belong only to the first administrator; each user has independent state',async()=>{
    const url='/api/media/'+items[0].id;
    assert.equal((await call('GET',url,undefined,ownerCookie)).json().liked,1);
    assert.equal((await call('GET',url,undefined,ownerCookie)).json().progress_position,42);
    assert.equal((await call('GET',url,undefined,viewerCookie)).json().liked,0);
    assert.equal((await call('GET',url,undefined,viewerCookie)).json().progress_position,null);
    await call('POST',url+'/progress',{position:15,duration:120},viewerCookie);await call('POST',url+'/like',{liked:true},viewerCookie);
    assert.equal((await call('GET',url,undefined,viewerCookie)).json().progress_position,15);
    assert.equal((await call('GET',url,undefined,ownerCookie)).json().progress_position,42);
    await call('POST',url+'/like',{liked:false},viewerCookie);
    assert.equal((await call('GET','/api/media?liked=1',undefined,viewerCookie)).json().length,0);
    assert.equal((await call('GET','/api/home',undefined,ownerCookie)).json().favorites.length,1);
  });
  await t.test('playback, transcoding and metadata permissions apply before any work begins',async()=>{
    await call('PATCH','/api/accounts/'+viewerId,{permissions:{play:false,transcode:false}},ownerCookie);viewerCookie=await login('viewer');
    assert.equal((await call('GET',`/api/media/${items[0].id}/stream`,undefined,viewerCookie)).statusCode,403);
    assert.equal((await call('GET','/api/media',undefined,viewerCookie)).statusCode,200);
    await call('PATCH','/api/accounts/'+viewerId,{permissions:{play:true}},ownerCookie);viewerCookie=await login('viewer');
    assert.equal((await call('POST',`/api/media/${items[0].id}/quality/start`,{},viewerCookie)).statusCode,403);
    assert.equal((await call('GET',`/playback/${items[0].id}/stamp/adaptive/default/index.m3u8`,undefined,viewerCookie)).statusCode,403);
    assert.equal((await call('DELETE',`/api/media/${items[0].id}/metadata`,undefined,viewerCookie)).statusCode,403);
    await call('PATCH','/api/accounts/'+viewerId,{permissions:{manageMetadata:true}},ownerCookie);viewerCookie=await login('viewer');
    assert.equal((await call('DELETE',`/api/media/${items[0].id}/metadata`,undefined,viewerCookie)).statusCode,200);
    assert.equal((await call('DELETE','/api/metadata',undefined,viewerCookie)).statusCode,403);
  });
  await t.test('delegated library management and scanning remain limited to accessible libraries',async()=>{
    await call('PATCH','/api/accounts/'+viewerId,{permissions:{manageLibraries:true,scanLibraries:true}},ownerCookie);viewerCookie=await login('viewer');
    assert.equal((await call('DELETE','/api/libraries/'+items[1].library_id,undefined,viewerCookie)).statusCode,404);
    const folder=join(root,'Added');await mkdir(folder);
    const added=await call('POST','/api/libraries',{path:folder,label:'Added'},viewerCookie);
    assert.equal(added.statusCode,200,added.body);
    const id=added.json().id;
    assert.ok(accounts.get(viewerId).libraryIds.includes(id));
    assert.equal((await call('GET','/api/libraries',undefined,viewerCookie)).json().length,2);
    while(server.scanStatus.running) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal((await call('POST','/api/scan',{},viewerCookie)).statusCode,200);
    while(server.scanStatus.running) await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(db.getMedia(items[1].id).mtime,1,'a hidden library is never scanned by the viewer');
    assert.equal((await call('GET','/api/scan/status',undefined,viewerCookie)).json().scanned,0,'other library scan details are not disclosed');
    assert.equal((await call('DELETE','/api/libraries/'+id,undefined,viewerCookie)).statusCode,200);
    await call('PATCH','/api/accounts/'+viewerId,{permissions:{manageLibraries:false,scanLibraries:false}},ownerCookie);viewerCookie=await login('viewer');
  });
  await t.test('signing out closes an already-active source stream',async()=>{
    const original=await readFile(items[0].path), file=await open(items[0].path,'r+');
    let response,request,timer;
    try {
      await file.truncate(64*1024*1024);
      await app.listen({host:'127.0.0.1',port:0});
      response=await new Promise((resolve,reject)=>{
        request=get(`http://127.0.0.1:${app.server.address().port}/api/media/${items[0].id}/stream`,{headers:{cookie:viewerCookie}},resolve);
        request.once('error',reject);
      });
      response.on('error',()=>undefined);
      assert.equal(response.statusCode,200);
      await new Promise(resolve=>response.once('data',()=>{response.pause();resolve();}));
      const closed=new Promise(resolve=>response.once('close',resolve));
      assert.equal((await call('POST','/api/auth/logout',{},viewerCookie)).statusCode,200);
      response.resume();
      await Promise.race([closed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Active stream was not revoked')),5000);})]);
      assert.equal(response.complete,false,'the server ends the stream before the complete private file is sent');
    } finally {
      clearTimeout(timer);response?.destroy();request?.destroy();await file.close();await writeFile(items[0].path,original);
    }
    viewerCookie=await login('viewer');
  });
  await t.test('profile changes require the current password and cannot elevate privileges',async()=>{
    assert.equal((await call('PATCH','/api/auth/me',{currentPassword:'wrong',username:'renamed'},viewerCookie)).statusCode,400);
    const result=await call('PATCH','/api/auth/me',{currentPassword:password,username:'renamed',displayName:'Viewer name',password:'A different private passphrase 2026',isAdmin:true,allLibraries:true},viewerCookie);
    assert.equal(result.statusCode,200,result.body);assert.equal(result.json().user.isAdmin,false);assert.equal(result.json().user.allLibraries,false);
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).statusCode,401);viewerCookie=cookieOf(result);
    assert.equal((await call('GET','/api/auth/status',undefined,viewerCookie)).json().user.displayName,'Viewer name');
  });
  await t.test('localhost-only administrator access blocks remote sessions and spoofed forwarding headers',async()=>{
    const remoteCookie=await login('owner',password,'10.0.0.3');
    const result=await call('POST','/api/accounts/security',{adminLocalOnly:true},ownerCookie);
    assert.equal(result.statusCode,200,result.body);ownerCookie=cookieOf(result);
    assert.equal((await call('GET','/api/home',undefined,remoteCookie,{remoteAddress:'10.0.0.3'})).statusCode,401);
    assert.equal((await call('GET','/api/home',undefined,ownerCookie,{remoteAddress:'10.0.0.3',headers:{'x-forwarded-for':'127.0.0.1'}})).statusCode,401);
    assert.equal((await call('GET','/api/home',undefined,ownerCookie,{headers:{forwarded:'for=127.0.0.1'}})).statusCode,401);
    assert.equal((await call('POST','/api/auth/login',{username:'owner',password},undefined,{remoteAddress:'10.0.0.4'})).statusCode,403);
    assert.equal((await call('GET','/api/home',undefined,viewerCookie,{remoteAddress:'10.0.0.5'})).statusCode,200,'regular viewers remain available remotely');
    assert.equal((await call('GET','/api/home',undefined,ownerCookie,{remoteAddress:'::1'})).statusCode,200);
    assert.equal((await call('GET','/api/home',undefined,ownerCookie,{remoteAddress:'::ffff:127.0.0.1'})).statusCode,200);
  });
  await t.test('administrators can have restricted browsing without losing Account Manager',async()=>{
    const owner=accounts.findUsername('owner');
    assert.equal((await call('PATCH','/api/accounts/'+owner,{allLibraries:false,libraryIds:[items[0].library_id]},ownerCookie)).statusCode,200);
    ownerCookie=await login('owner');
    assert.equal((await call('GET','/api/home',undefined,ownerCookie)).json().total,1);
    assert.equal((await call('GET','/api/media/'+items[1].id,undefined,ownerCookie)).statusCode,404);
    assert.equal((await call('GET','/api/accounts/libraries',undefined,ownerCookie)).json().length,2);
    assert.equal((await call('GET','/api/accounts',undefined,ownerCookie)).statusCode,200);
  });
  await t.test('promotions, disabling, password resets and deletion revoke existing sessions',async()=>{
    await call('PATCH','/api/accounts/'+viewerId,{isAdmin:true},ownerCookie);
    viewerCookie=await login('renamed','A different private passphrase 2026');
    assert.equal((await call('GET','/api/accounts',undefined,viewerCookie)).statusCode,200);
    await call('PATCH','/api/accounts/'+viewerId,{isAdmin:false,enabled:false},ownerCookie);
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).statusCode,401);
    const result=await call('PATCH','/api/accounts/'+viewerId,{enabled:true,password:password},ownerCookie);assert.equal(result.statusCode,200,result.body);
    viewerCookie=await login('renamed');
    assert.equal((await call('POST','/api/auth/logout',{},viewerCookie)).statusCode,200);
    assert.equal((await call('GET','/api/home',undefined,viewerCookie)).statusCode,401);
    assert.equal((await call('DELETE','/api/accounts/'+viewerId,undefined,ownerCookie)).statusCode,200);
    await access(items[0].path);assert.equal(db.visibleLibraries().length,2);assert.equal(db.previousLibraries().length,1);
  });
  await t.test('sessions have bounded absolute and idle lifetimes',async()=>{
    const user=accounts.get(accounts.findUsername('owner')), value=accounts.createSession(user);
    assert.ok(accounts.session(value));assert.equal(accounts.session(value,Date.now()+8*86400_000),undefined);
    accounts.db.prepare('UPDATE account_sessions SET last_seen=? WHERE digest=?').run(Date.now()-86400_001,sessionDigest(value));assert.equal(accounts.session(value),undefined);
  });
  await t.test('local recovery preserves libraries and replaces all administrator credentials',async()=>{
    const result=spawnSync(process.execPath,['dist/cli.js','--data',root,'--reset-password','owner'],{encoding:'utf8',windowsHide:true});
    assert.equal(result.status,0,result.stderr);
    const secret=result.stdout.match(/Temporary password: (\S+)/)?.[1];assert.ok(secret);
    assert.equal(await verifyPassword(secret,accounts.passwordHash(accounts.findUsername('owner'))),true);
    assert.equal((await call('GET','/api/home',undefined,ownerCookie)).statusCode,401);await access(items[0].path);
  });
  await t.test('login responses do not enumerate accounts and attempts are rate limited',async()=>{
    let first;
    for(let index=0;index<13;index++){
      const result=await call('POST','/api/auth/login',{username:index%2?'missing':'owner',password:'incorrect'},undefined,{remoteAddress:'10.42.0.2'});
      if(index===0)first=result.body;
      assert.equal(result.statusCode,index<12?401:429);
      if(index<12)assert.equal(result.body,first);
    }
  });
});
