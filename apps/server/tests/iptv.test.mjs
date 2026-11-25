import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';
import { parseIptvChannels,IPTV_MAX_BYTES,sniffIptvManifest } from '../dist/iptv-parser.js';
import { approvedIptvUrl,publicIptvAddress,readIptvOrigins } from '../dist/iptv-network.js';
import { relayIptvManifest } from '../dist/iptv-manifest.js';

const provider='https://channels.example';
const c='#EXTM3U\n#EXTINF:-1 tvg-name="Local, News" group-title="News;Local",Other\n./news.m3u8\n#EXTINF:-1,Weather\n#EXTGRP:Local\nhttps://channels.example/weather\n';
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=120000\nvariant.m3u8\n';
const media='#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nsegment.m4s\n#EXT-X-ENDLIST\n';

test('M3U labels, groups, relative entries and single HLS import survive the shared parser',()=>{
  assert.deepEqual(parseIptvChannels('\uFEFF'+c.replaceAll('\n','\r\n'),'Fixture',provider+'/playlists/all'),[
    {name:'Local, News',groups:['News','Local'],url:provider+'/playlists/news.m3u8'},
    {name:'Weather',groups:['Local'],url:provider+'/weather'}
  ]);
  assert.deepEqual(parseIptvChannels(master,'Single',provider+'/extensionless'),[{name:'Single',groups:[],url:provider+'/extensionless'}]);
  assert.throws(()=>parseIptvChannels(media,'Manifest'),/HTTPS link/);
  assert.throws(()=>parseIptvChannels('#EXTM3U\nhttp://channels.example/source','HTTP'),/No HTTPS channels/);
  assert.throws(()=>parseIptvChannels('x'.repeat(IPTV_MAX_BYTES+1),'Too large'),/too large/);
});

test('the relay accepts only configured HTTPS origins and publicly routable addresses',()=>{
  const origins=new Set(readIptvOrigins([provider,provider+'/']));
  assert.deepEqual([...origins],[provider]);
  assert.equal(approvedIptvUrl('variant.m3u8',origins,provider+'/hls/').href,provider+'/hls/variant.m3u8');
  assert.throws(()=>approvedIptvUrl('https://other.example/playlist',origins),/not allowed/);
  assert.throws(()=>readIptvOrigins([provider+'/playlist']),/HTTPS origins/);
  for(const address of ['127.0.0.1','10.1.2.3','169.254.0.1','::1','::ffff:127.0.0.1','fc00::1','fe80::1','2001:db8::1'])
    assert.equal(publicIptvAddress(address),false,address);
  assert.equal(publicIptvAddress('8.8.8.8'),true);
  assert.equal(publicIptvAddress('2606:4700::1111'),true);
  const references=[];
  const map=(value,kind)=>{references.push({value,kind});return '/media/'+references.length;};
  assert.match(relayIptvManifest(master,map),/\/media\/1/);
  assert.match(relayIptvManifest(media,map),/URI="\/media\/2"/);
  assert.deepEqual(references,[{value:'variant.m3u8',kind:'manifest'},{value:'init.mp4',kind:'segment'},{value:'segment.m4s',kind:'segment'}]);
  assert.throws(()=>relayIptvManifest(media.replace('#EXTINF','#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF'),map),/unencrypted HLS/);
});

test('connection checks identify an HLS playlist with bounded reads',async()=>{
  const chunks=['#EXT','M3U\r\n#EXT-X-TARGET','DURATION:2\r\n'];
  let reads=0;
  assert.equal(await sniffIptvManifest(async()=>Buffer.from(chunks[reads++])),true);
  assert.equal(reads,3);
  reads=0;
  assert.equal(await sniffIptvManifest(async()=>{reads++;return Buffer.alloc(65536,32);}),false);
  assert.equal(reads,1);
  assert.equal(await sniffIptvManifest(async()=>Buffer.from('<html>Not a stream</html>')),false);
});

test('Live TV sources and relay sessions are private, bounded to allowed origins and stream the original segment',async t=>{
  // Act as a public upstream without using a network service or weakening the production resolver.
  const fetched=[];
  t.mock.method(https,'get',(url,options,callback)=>{
    fetched.push(url.href);
    const payloads={
      '/list':c,
      '/playlists/news.m3u8':master,
      '/playlists/variant.m3u8':media,
      '/playlists/segment.m4s':'generated test segment'
    };
    const body=Buffer.from(payloads[url.pathname]??'');
    const ret=Readable.from(body);
    ret.statusCode=url.pathname==='/weather'?302:Object.hasOwn(payloads,url.pathname)?200:404;
    ret.headers=ret.statusCode===302?{location:'https://other.example/moved'}:{'content-length':String(body.length)};
    assert.equal(options.headers['Accept-Encoding'],'identity');
    setImmediate(()=>callback(ret));
    return new EventEmitter();
  });
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  const directory=await mkdtemp(join(tmpdir(),'virelo-iptv-test-'));
  process.env.VIRELO_LOG_LEVEL='silent';
  const {app,accounts}=await createVireloServer({dataDir:directory,mediaPaths:[],host:'127.0.0.1',port:0});
  t.after(async()=>{
    await app.close();
    assert.match(relative(resolve(tmpdir()),resolve(directory)),/^virelo-iptv-test-[^/\\]+$/);
    await rm(directory,{recursive:true,force:true});
  });
  const call=(method,url,payload,cookie)=>app.inject({method,url,payload,headers:{'x-virelo-request':'1',...(cookie?{cookie}:{})}});
  const setup=await call('POST','/api/auth/setup',{username:'admin',password:'1234'});
  assert.equal(setup.statusCode,200,setup.body);
  const admin=setup.headers['set-cookie'].split(';')[0];
  const user=accounts.save({username:'viewer'},await hashPassword('1234'));
  const viewer='virelo_session='+accounts.createSession(user);
  const prefix='/api/iptv';
  assert.equal((await call('GET',prefix+'/sources')).statusCode,401);
  assert.equal((await call('PUT',prefix+'/origins',{origins:[provider]},viewer)).statusCode,403);
  assert.equal((await call('PUT',prefix+'/origins',{origins:[provider]},admin)).statusCode,200);
  const directInput={name:'Direct Weather',streamUrl:provider+'/playlists/news.m3u8?key=fixture-token'};
  const beforeDirect=fetched.length;
  assert.equal((await call('POST',prefix+'/sources',{...directInput,url:provider+'/list'},viewer)).statusCode,400);
  assert.equal((await call('POST',prefix+'/sources',{...directInput,streamUrl:'http://channels.example/live.m3u8'},viewer)).statusCode,400);
  assert.equal((await call('POST',prefix+'/sources',{...directInput,streamUrl:'https://other.example/live.m3u8'},viewer)).statusCode,403);
  const direct=await call('POST',prefix+'/sources',directInput,viewer);
  assert.equal(direct.statusCode,201,direct.body);
  const directId=direct.json().id;
  const directInfo=await call('GET',prefix+'/sources/'+directId,undefined,viewer);
  assert.deepEqual(directInfo.json().channels,[{name:'Direct Weather',groups:[]}]);
  assert.ok(!directInfo.body.includes('fixture-token'));
  assert.equal(fetched.length,beforeDirect,'registration does not download the manifest');
  const directSession=await call('POST',prefix+'/sessions',{sourceId:directId,channel:0},viewer);
  assert.equal(directSession.statusCode,201,directSession.body);
  const directManifest=await call('GET',directSession.json().url,undefined,viewer);
  assert.equal(directManifest.statusCode,200,directManifest.body);
  assert.deepEqual(fetched.slice(beforeDirect),[directInput.streamUrl]);
  const source=await call('POST',prefix+'/sources',{name:'Fixture',url:provider+'/playlist/../list?key=fixture-token'},viewer);
  assert.equal(source.statusCode,201,source.body);
  assert.ok(!source.body.includes('fixture-token'));
  const id=source.json().id;
  assert.deepEqual((await call('GET',prefix+'/sources',undefined,admin)).json(),[]);
  assert.equal((await call('GET',prefix+'/sources/'+id,undefined,admin)).statusCode,404);
  const info=await call('GET',prefix+'/sources/'+id,undefined,viewer);
  assert.ok(!info.body.includes(provider));
  assert.deepEqual(info.json().checks,[]);
  // Use the relative reference at its expected base.
  const other=await call('POST',prefix+'/sources',{name:'Second',text:c.replace('./news.m3u8',provider+'/playlists/news.m3u8?key=fixture-token')},viewer);
  const probe={sourceId:other.json().id,channel:0};
  const before=fetched.length;
  assert.equal((await call('POST',prefix+'/check',probe)).statusCode,401);
  assert.equal((await call('POST',prefix+'/check',probe,admin)).statusCode,404);
  assert.equal((await call('POST',prefix+'/check',{...probe,channel:200},viewer)).statusCode,404);
  assert.equal(fetched.length,before);
  const reachable=await call('POST',prefix+'/check',probe,viewer);
  assert.equal(reachable.statusCode,200,reachable.body);
  assert.equal(reachable.json().status,'responding');
  assert.ok(reachable.json().milliseconds>0);
  assert.ok(reachable.json().checkedAt>0);
  assert.ok(!reachable.body.includes('fixture-token'));
  assert.deepEqual(fetched.slice(before),[provider+'/playlists/news.m3u8?key=fixture-token']);
  const saved=await call('GET',prefix+'/sources/'+probe.sourceId,undefined,viewer);
  assert.deepEqual(saved.json().checks,[{...reachable.json(),index:0}]);
  assert.ok(!saved.body.includes('fixture-token'));
  assert.equal((await call('GET',prefix+'/sources/'+probe.sourceId,undefined,admin)).statusCode,404);
  assert.equal(fetched.length,before+1,'opening cached checks does not probe again');
  const session=await call('POST',prefix+'/sessions',{sourceId:other.json().id,channel:0},viewer);
  assert.equal(session.statusCode,201,session.body);
  const {url}=session.json();
  assert.equal((await call('GET',url,undefined,admin)).statusCode,404);
  const manifest=await call('GET',url,undefined,viewer);
  assert.equal(manifest.statusCode,200,manifest.body);
  assert.equal(manifest.headers['cache-control'],'private, no-store');
  assert.ok(!manifest.body.includes('fixture-token'));
  const variant=manifest.body.split('\n').find(line=>line.startsWith(prefix));
  const child=await call('GET',variant,undefined,viewer);
  assert.equal(child.statusCode,200,child.body);
  const segment=child.body.split('\n').find(line=>line.startsWith(prefix));
  assert.equal((await call('GET',segment,undefined,viewer)).body,'generated test segment');
  const redirect=await call('POST',prefix+'/sessions',{sourceId:id,channel:1},viewer);
  assert.equal((await call('GET',redirect.json().url,undefined,viewer)).statusCode,403);
  assert.equal((await call('POST',prefix+'/check',{sourceId:id,channel:1},viewer)).json().status,'not-allowed');
  assert.ok(fetched.every(value=>value.startsWith(provider)));
  assert.equal((await call('PUT',prefix+'/origins',{origins:[]},admin)).statusCode,200);
  assert.deepEqual((await call('GET',prefix+'/sources/'+probe.sourceId,undefined,viewer)).json().checks,[],'allowlist changes discard results from the old policy');
  const beforeBlocked=fetched.length;
  assert.equal((await call('POST',prefix+'/check',probe,viewer)).json().status,'not-allowed');
  assert.equal(fetched.length,beforeBlocked);
  assert.equal((await call('GET',url,undefined,viewer)).statusCode,404);
});
