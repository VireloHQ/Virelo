import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { authenticatedInjector } from './auth-helper.mjs';
import { readServerSettings } from '../dist/server-settings.js';

process.env.VIRELO_LOG_LEVEL = 'silent';

test('server management is admin-only; network changes require localhost and an explicit restart', {timeout:25000}, async () => {
  const data = await mkdtemp(join(tmpdir(), 'virelo-server-management-'));
  let server;
  try {
    server = await createVireloServer({dataDir:data,mediaPaths:[],host:'127.0.0.1',port:41777});
    assert.equal((await server.app.inject({method:'GET',url:'/api/server/management'})).statusCode,401);
    assert.equal((await server.app.inject({method:'POST',url:'/server-recovery'})).statusCode,401);
    const request = await authenticatedInjector(server.app);
    assert.equal((await request({method:'POST',url:'/server-recovery'})).statusCode,403);
    assert.equal((await request({method:'POST',url:'/server-recovery',headers:{origin:'http://localhost:41778'}})).statusCode,403);
    assert.equal((await request({method:'POST',url:'/server-recovery',headers:{origin:'null','sec-fetch-site':'same-site','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).statusCode,403);
    const current = await request({method:'GET',url:'/api/server/management'});
    assert.equal(current.statusCode,200,current.body);
    assert.equal(current.json().host,'127.0.0.1');
    assert.equal(current.json().desired.port,41777);
    assert.equal(current.json().restartRequired,false);

    for (const bad of [{host:'example.com',port:123},{host:'0.0.0.0',port:-2},
      {host:'127.0.0.1',port:41777,debug:'x'},{host:'0.0.0.0',port:'8080'}]) {
      const reply = await request({method:'POST',url:'/api/server/management/config',payload:bad});
      assert.equal(reply.statusCode,400,reply.body);
    }
    assert.equal(await readServerSettings(data),null);

    const invalidOrigin = await request({method:'POST',url:'/api/server/management/config',
      payload:{host:'127.0.0.1',port:59999},headers:{origin:'https://attacker.invalid'}});
    assert.equal(invalidOrigin.statusCode,403);

    const remote = await request({method:'POST',url:'/api/server/management/config',
      remoteAddress:'198.51.100.5',payload:{host:'0.0.0.0',port:8888}});
    assert.equal(remote.statusCode,403,remote.body);
    assert.equal(await readServerSettings(data),null);

    const saved = await request({method:'POST',url:'/api/server/management/config',
      payload:{host:'0.0.0.0',port:59999}});
    assert.equal(saved.statusCode,200,saved.body);
    assert.deepEqual(await readServerSettings(data),{host:'0.0.0.0',port:59999});
    assert.equal(saved.json().restartRequired,true);
    assert.equal(saved.json().host,'127.0.0.1','changing config must not silently open the current server to the LAN');
    assert.equal(saved.json().port,41777);
    assert.deepEqual(saved.json().desired,{host:'0.0.0.0',port:59999});

    for (const action of ['stop','restart']) {
      assert.equal((await server.app.inject({method:'POST',url:'/api/server/management/'+action,
        headers:{'x-virelo-request':'1'}})).statusCode,401);
      assert.equal((await request({method:'POST',url:'/api/server/management/'+action,
        remoteAddress:'198.51.100.5'})).statusCode,403);
      const unmanaged = await request({method:'POST',url:'/api/server/management/'+action});
      assert.equal(unmanaged.statusCode,409,unmanaged.body);
    }
  } finally {
    if(server) await server.app.close();
    await rm(data,{recursive:true,force:true});
  }
});
