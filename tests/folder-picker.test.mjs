import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {pickNativeFolder} from '../dist/folder-picker.js';
import {createVireloServer} from '../dist/server.js';

process.env.VIRELO_LOG_LEVEL='silent';
async function fixture(t,close=async()=>{}) {
  const root=await mkdtemp(join(tmpdir(),'virelo-folder-picker-'));
  t.after(async()=>{
    await close();
    const target=relative(resolve(tmpdir()),resolve(root));
    assert.ok(target.startsWith('virelo-folder-picker-')&&!target.includes('..'));
    await rm(root,{recursive:true,force:true});
  });
  return root;
}

test('native choosers return existing paths without passing them to a shell',async t=>{
  const root=await fixture(t),folder=join(root,"日本語 Virelo's $(test); folder");await mkdir(folder);
  const signal=new AbortController().signal;
  for(const [platform,command] of [['win32','powershell.exe'],['darwin','/usr/bin/osascript'],['linux','zenity']]) {
    let calls=0;
    const run=async(file,args,options)=>{
      calls++;assert.equal(file,command);assert.equal(options.shell,false);assert.equal(options.windowsHide,true);
      assert.equal(options.timeout,300_000);assert.equal(options.signal,signal);
      assert.ok(!args.some(arg=>arg.includes(folder)),'selected paths are output, never executable input');
      return {stdout:(platform==='win32'?JSON.stringify(folder):folder)+'\r\n'};
    };
    assert.equal(await pickNativeFolder(signal,run,platform),folder);assert.equal(calls,1);
  }
});

test('cancellation is harmless; unavailable, invalid or timed-out dialogs allow manual fallback',async t=>{
  const root=await fixture(t),file=join(root,'file');await writeFile(file,'not a folder');
  const signal=new AbortController().signal;
  for(const platform of ['win32','darwin']) assert.equal(await pickNativeFolder(signal,async()=>({stdout:''}),platform),null);
  assert.equal(await pickNativeFolder(signal,async()=>{throw {code:1,stderr:''};},'linux'),null);
  const calls=[];
  assert.equal(await pickNativeFolder(signal,async command=>{
    calls.push(command);if(command==='zenity')throw {code:'ENOENT'};return {stdout:root+'\n'};
  },'linux'),root);
  assert.deepEqual(calls,['zenity','kdialog']);
  for(const [platform,run] of [
    ['win32',async()=>({stdout:'not JSON'})],
    ['win32',async()=>({stdout:JSON.stringify(file)})],
    ['darwin',async()=>({stdout:'relative/path'})],
    ['linux',async()=>({stdout:join(root,'missing')})],
    ['linux',async()=>{throw {code:1,stderr:'Cannot open display'};}],
    ['linux',async()=>{throw {code:1,killed:true};}],
    ['linux',async()=>{throw {code:'ENOENT'};}],
    ['win32',async()=>{throw {code:'ABORT_ERR'};}]
  ]) await assert.rejects(pickNativeFolder(signal,run,platform),error=>error.statusCode===503&&/manually/.test(error.message));
});

test('only authenticated direct-local library managers can open a single folder chooser',async t=>{
  let server;
  const root=await fixture(t,async()=>server?.app.close());let calls=0,choose=async()=>root;
  server=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0},async signal=>{calls++;return choose(signal);});
  const call=(url='/api/libraries/pick',payload,extra={})=>server.app.inject({method:'POST',url,payload,remoteAddress:'127.0.0.1',...extra,
    headers:{'x-virelo-request':'1',...extra.headers}});
  const setup=await call('/api/auth/setup',{username:'owner',password:'1'});
  assert.equal(setup.statusCode,200,setup.body);
  const cookie=setup.headers['set-cookie'].split(';')[0];
  const pick=(extra={})=>call('/api/libraries/pick',undefined,{...extra,headers:{cookie,...extra.headers}});
  assert.equal((await call()).statusCode,401);
  for(const extra of [
    {remoteAddress:'192.168.1.2'},
    {headers:{host:'192.168.1.3'}},
    {headers:{forwarded:'for=127.0.0.1'}},
    {headers:{'x-forwarded-for':'127.0.0.1'}},
    {headers:{'x-real-ip':'127.0.0.1'}},
    {headers:{origin:'https://other.example'}},
    {headers:{'x-virelo-request':''}}
  ]) assert.equal((await pick(extra)).statusCode,403);
  const viewer=await call('/api/accounts',{username:'viewer',password:'2'},{headers:{cookie}});
  assert.equal(viewer.statusCode,201,viewer.body);
  const login=await call('/api/auth/login',{username:'viewer',password:'2'});
  assert.equal((await pick({headers:{cookie:login.headers['set-cookie'].split(';')[0]}})).statusCode,403);
  assert.equal(calls,0,'denied requests never launch a native dialog');
  const manager=await call('/api/accounts',{username:'manager',password:'3',permissions:{manageLibraries:true}},{headers:{cookie}});
  assert.equal(manager.statusCode,201,manager.body);
  const managerLogin=await call('/api/auth/login',{username:'manager',password:'3'});
  assert.deepEqual((await pick({headers:{cookie:managerLogin.headers['set-cookie'].split(';')[0]}})).json(),{path:root},'delegated local library managers can also browse');
  assert.deepEqual((await pick()).json(),{path:root});
  assert.equal(server.db.listLibraries().length,0,'browsing does not add a library before confirmation');
  choose=async()=>null;assert.deepEqual((await pick()).json(),{path:null});
  let release,started;
  const ready=new Promise(resolve=>{started=resolve;});
  choose=()=>new Promise(resolve=>{release=resolve;started();});
  const opening=pick();await ready;
  assert.equal((await pick()).statusCode,409,'duplicate clicks cannot open more dialogs');
  release(null);assert.equal((await opening).statusCode,200);
  choose=async()=>{throw new Error('chooser unavailable');};assert.equal((await pick()).statusCode,500);
  choose=async()=>root;assert.equal((await pick()).statusCode,200,'failures release the busy guard');
  choose=async()=>{server.accounts.save({displayName:'Changed'},undefined,setup.json().user.id);return root;};
  assert.equal((await pick()).statusCode,401,'a session revoked while choosing cannot receive a host path');
});
