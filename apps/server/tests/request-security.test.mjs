import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { requestHostname, isLoopbackAddress, isTrustedHostname } from '../dist/request-security.js';
import { createVireloServer } from '../dist/server.js';

process.env.VIRELO_LOG_LEVEL = 'silent';

test('Host parsing rejects ambiguous authorities and normalizes literal addresses', () => {
  for (const host of ['', 'localhost@evil.example', 'localhost/path', 'localhost:bad', 'localhost:65536', '[::1]evil', '[::1', 'localhost\\evil', 'localhost#evil', 'localhost?evil', 'localhost\t', 'foo..local', '-bad.local', 'bad-.local', '[fc-attacker.example]'])
    assert.equal(requestHostname(host), '', host);
  for (const [host, expected] of [['LOCALHOST.:41777','localhost'], ['192.168.1.2:80','192.168.1.2'], ['[0:0:0:0:0:0:0:1]:41777','::1'], ['[FD00::1]:443','fd00::1']])
    assert.equal(requestHostname(host), expected, host);
});

test('private-address trust requires an IP, not a matching DNS prefix', () => {
  for (const host of ['10.attacker.example','127.attacker.example','192.168.attacker.example','169.254.attacker.example','172.16.attacker.example','100.64.attacker.example','fc-attacker.example','fd-attacker.example','fe80.attacker.example','2130706433','8.8.8.8','2001:4860:4860::8888','ordinary.example'])
    assert.equal(isTrustedHostname(host, '0.0.0.0', []), false, host);
  for (const host of ['localhost','server-pc','media.local','127.0.0.2','10.0.0.1','192.168.1.2','169.254.1.1','172.16.0.1','172.31.255.255','100.64.0.1','100.127.255.255','::1','fd00::1','fc00::1','fe80::1'])
    assert.equal(isTrustedHostname(host, '0.0.0.0', []), true, host);
  for (const host of ['172.15.0.1','172.32.0.1','100.63.255.255','100.128.0.1','fc::1','fd::1','fe8::1','fbff::1','fec0::1'])
    assert.equal(isTrustedHostname(host, '0.0.0.0', []), false, host);
  assert.equal(isTrustedHostname('media.example', '0.0.0.0', ['media.example']), true);
  assert.equal(isTrustedHostname('media.example', 'media.example', []), true);
  assert.equal(isTrustedHostname('media.example.evil', '0.0.0.0', ['media.example']), false);
});

test('loopback checks accept native and mapped loopback only', () => {
  for (const address of ['127.0.0.1','127.255.255.255','::1','0:0:0:0:0:0:0:1','::ffff:127.0.0.1','::ffff:7f00:1'])
    assert.equal(isLoopbackAddress(address), true, address);
  for (const address of ['127.attacker.example','::ffff:192.168.1.2','::ffff:7e00:1','192.168.1.2','::',''])
    assert.equal(isLoopbackAddress(address), false, address);
});

test('HTTP boundaries reject public prefix lookalikes and proxy setup requests', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'virelo-request-security-'));
  const {app} = await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
  t.after(async () => { await app.close(); await rm(dataDir,{recursive:true,force:true}); });
  for (const host of ['10.attacker.example','127.attacker.example','fc-attacker.example','192.168.attacker.example']) {
    const response = await app.inject({url:'/api/auth/status',headers:{host}});
    assert.equal(response.statusCode,403,host);
    assert.equal(response.json().error,'Untrusted Host header.');
  }
  for (const header of ['forwarded','x-forwarded-for','x-forwarded-port','x-real-ip','cf-connecting-ip','true-client-ip']) {
    const headers = {host:'localhost','x-virelo-request':'1',[header]:'127.0.0.1'};
    const status = await app.inject({url:'/api/auth/status',headers});
    assert.equal(status.json().localAccess,false,header);
    const setup = await app.inject({method:'POST',url:'/api/auth/setup',headers,payload:{username:'owner',password:'1'}});
    assert.equal(setup.statusCode,403,header);
  }
  const local = await app.inject({url:'/api/auth/status',headers:{host:'localhost'}});
  assert.equal(local.statusCode,200);
  assert.equal(local.json().localAccess,true);
});
