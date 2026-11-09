import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
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

    const unauthorized = await new Promise((resolve, reject) => {
      const socket = createConnection(profile.endpoint);
      let text = '';
      socket.on('connect', () => socket.write(JSON.stringify({ v: 1, action: 'status', key: randomUUID().replace(/-/g,'').repeat(2) }) + '\n'));
      socket.on('data', chunk => { text += chunk; });
      socket.on('end', () => {
        try { resolve(JSON.parse(text.trim())); } catch(e) { reject(e); }
      });
      socket.on('error', reject);
    });
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
    const raw = Buffer.from(JSON.stringify({v:1,key:secret,action:'addMedia',path:unicode})+'\n');
    const split = raw.indexOf(Buffer.from('映')) + 1;
    assert.ok(split>1);
    const response = await new Promise((resolve, reject) => {
      const socket = createConnection(profile.endpoint);
      let text = '';
      socket.setEncoding('utf8');
      socket.on('connect', () => {
        socket.write(raw.subarray(0,split));
        setTimeout(() => socket.write(raw.subarray(split)), 12);
      });
      socket.on('data',chunk=>{text+=chunk;});
      socket.on('end',()=>{try{resolve(JSON.parse(text.trim()));}catch(e){reject(e);}});
      socket.on('error',reject);
    });
    assert.equal(response.ok,true);
    assert.equal(received,unicode);
  } finally {
    if (server) await server.close();
    await rm(folder,{recursive:true,force:true});
  }
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
