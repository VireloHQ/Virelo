import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { createConnection, createServer } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireStartupLock, controlProfile, createControlServer, sendControl } from '../dist/server-control.js';

function fakeSnapshot(dataDir) {
  return {
    pid: process.pid, url: 'http://127.0.0.1:41777', version: 'test',
    startedAt: Date.now(), libraries: 0, media: 0, scanRunning: false,
    host: '127.0.0.1', port: 41777, dataDir
  };
}

const nonce=()=>randomBytes(32).toString('hex');
const proof=(secret,kind,client,server,payload='')=>createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify([2,kind,client,server,payload])).digest('hex');
async function exchange(profile,secret,request,transform=frame=>frame,split=false){
  return await new Promise((resolve,reject)=>{
    const client=nonce(),socket=createConnection(profile.endpoint);let text='',server;
    socket.setEncoding('utf8');socket.setTimeout(2000,()=>socket.destroy(new Error('Test exchange timed out')));
    socket.on('connect',()=>socket.write(JSON.stringify({v:2,nonce:client})+'\n'));
    socket.on('data',chunk=>{
      text+=chunk;const end=text.indexOf('\n');if(end<0)return;
      try{
        const message=JSON.parse(text.slice(0,end));text=text.slice(end+1);
        if(!server){
          server=message.nonce;assert.equal(message.proof,proof(secret,'server',client,server));
          const payload=JSON.stringify(request),frame=transform({payload,proof:proof(secret,'request',client,server,payload)},client,server);
          const raw=Buffer.from(JSON.stringify(frame)+'\n');
          if(split){const index=raw.indexOf(Buffer.from('映'))+1;assert.ok(index>1);socket.write(raw.subarray(0,index));setTimeout(()=>socket.write(raw.subarray(index)),12);}
          else socket.write(raw);
        }else{
          assert.equal(message.proof,proof(secret,'reply',client,server,message.payload));
          socket.destroy();resolve(JSON.parse(message.payload));
        }
      }catch(error){socket.destroy();reject(error);}
    });socket.on('error',reject);
  });
}

test('local control IPC enforces authentication, supports status and cleans up', { timeout: 12000 }, async () => {
  const folder = await mkdtemp(join(tmpdir(), 'virelo-control-test-'));
  const profile = await controlProfile(folder);
  let server;
  try {
    assert.equal(await sendControl(profile, { action:'status' }), null);
    const expected = fakeSnapshot(profile.dataDir);
    server = await createControlServer(profile, async req => {
      assert.equal(req.action, 'status');
      return { ok: true, status: expected };
    });
    const reply = await sendControl(profile, { action:'status' });
    assert.equal(reply?.ok, true);
    assert.equal(reply.status.pid, process.pid);

    const secret=(await readFile(profile.tokenFile,'utf8')).trim();
    const unauthorized=await exchange(profile,secret,{action:'status'},frame=>({...frame,proof:'0'.repeat(64)}));
    assert.deepEqual(unauthorized, { ok: false, error: 'Not authorized.' });
    await assert.rejects(createControlServer(profile, async () => ({ ok:true,status: expected })), /already running|EADDRINUSE/);
  } finally {
    if (server) await server.close();
    assert.equal(await sendControl(profile, { action:'status' }), null);
    await rm(folder, { recursive:true, force:true });
  }
});

test('IPC keeps Unicode paths intact when a message is split inside a UTF-8 character', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'virelo-control-unicode-'));
  const profile = await controlProfile(folder);
  let server;
  try {
    const unicode = '映画・ドラマ';
    let received = '';
    server = await createControlServer(profile, async request => {
      received = request.path;
      return {ok:true,status:fakeSnapshot(profile.dataDir)};
    });
    const secret = (await readFile(profile.tokenFile,'utf8')).trim();
    const response=await exchange(profile,secret,{action:'addMedia',path:unicode},frame=>frame,true);
    assert.equal(response.ok,true);
    assert.equal(received,unicode);
  } finally {
    if (server) await server.close();
    await rm(folder,{recursive:true,force:true});
  }
});

test('IPC authenticates the peer before sending commands, rejects replay and modified replies, and bounds trickle responses',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'virelo-control-peer-')),profile=await controlProfile(folder);
  const real=await createControlServer(profile,async()=>({ok:true,status:fakeSnapshot(profile.dataDir)}));
  await real.close();const secret=(await readFile(profile.tokenFile,'utf8')).trim();
  for(const mode of ['wrong-peer','replayed-proof','changed-reply','trickle']){
    let seen='';const sockets=new Set(),timers=[];
    const server=createServer(socket=>{
      sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});socket.setEncoding('utf8');
      let raw='',challenged=false;
      socket.on('data',chunk=>{
        seen+=chunk;raw+=chunk;const end=raw.indexOf('\n');if(end<0)return;
        const message=JSON.parse(raw.slice(0,end));raw=raw.slice(end+1);
        if(!challenged){
          challenged=true;
          if(mode==='trickle'){timers.push(setInterval(()=>socket.write(' '),15));return;}
          const serverNonce=nonce();socket.testClient=message.nonce;socket.testServer=serverNonce;
          socket.write(JSON.stringify({v:2,nonce:serverNonce,proof:mode==='wrong-peer'?'0'.repeat(64):proof(secret,'server',mode==='replayed-proof'?nonce():message.nonce,serverNonce)})+'\n');
        }else{
          const payload=JSON.stringify({ok:true,status:{...fakeSnapshot(profile.dataDir),pid:999}});
          socket.end(JSON.stringify({payload,proof:proof(secret,'reply',socket.testClient,socket.testServer,JSON.stringify({ok:false,error:'original'}))})+'\n');
        }
      });
    });
    try{
      await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(profile.endpoint,resolve);});
      await assert.rejects(sendControl(profile,{action:'stop'},mode==='trickle'?120:2000),mode==='changed-reply'?/signature/:mode==='trickle'?/timed out/:/authenticated/);
      assert.ok(!seen.includes(secret),'Shared key never crosses IPC');
      if(mode!=='changed-reply')assert.ok(!seen.includes('stop'),'Command waits for valid peer proof');
    }finally{timers.forEach(clearInterval);for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}
  }
  await rm(folder,{recursive:true,force:true});
});

test('IPC binds commands to a fresh connection and their exact payload',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'virelo-control-replay-')),profile=await controlProfile(folder);let calls=0;
  const server=await createControlServer(profile,async()=>{calls++;return {ok:true,status:fakeSnapshot(profile.dataDir)};});
  try{
    const secret=(await readFile(profile.tokenFile,'utf8')).trim();let captured;
    assert.equal((await exchange(profile,secret,{action:'status'},frame=>{captured=frame;return frame;})).ok,true);
    assert.equal((await exchange(profile,secret,{action:'status'},()=>captured)).ok,false);
    assert.equal((await exchange(profile,secret,{action:'status'},frame=>({...frame,payload:JSON.stringify({action:'stop'})}))).ok,false);
    assert.equal(calls,1);
  }finally{await server.close();await rm(folder,{recursive:true,force:true});}
});

test('startup locks are exclusive and releasable', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'virelo-control-lock-'));
  const profile = await controlProfile(folder);
  try {
    const release = await acquireStartupLock(profile);
    try { await assert.rejects(acquireStartupLock(profile), /already starting/); }
    finally { await release(); }
    const releaseAgain = await acquireStartupLock(profile);
    await releaseAgain();
  } finally { await rm(folder, { recursive:true, force:true }); }
});
