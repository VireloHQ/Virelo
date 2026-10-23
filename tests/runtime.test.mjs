import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {assertSupportedNode,SUPPORTED_NODE_RANGE} from '../dist/runtime.js';

test('each supported Node release line has its own security floor',()=>{
  for(const version of ['22.23.4','22.23.5','22.24.0','24.22.1','24.22.2','24.23.0','26.12.1','26.12.2','26.13.0','v22.23.4'])
    assert.doesNotThrow(()=>assertSupportedNode(version),version);
  for(const version of ['18.20.0','20.19.0','22.16.0','22.23.3','23.99.0','24.0.0','24.22.0','25.99.0','26.12.0','27.0.0','28.0.0'])
    assert.throws(()=>assertSupportedNode(version),/Unsupported Node\.js.*22\.23\.4\+.*24\.22\.1\+.*26\.12\.1\+/,version);
  assert.doesNotThrow(()=>assertSupportedNode());
});

test('prereleases and malformed versions cannot bypass the runtime check',()=>{
  for(const version of ['','22','22.23','22.23.4-rc.1','26.12.1-nightly','24.22.1+custom','022.23.4',' 22.23.4','22.23.4\n','22.999999999999999999999.0'])
    assert.throws(()=>assertSupportedNode(version),/Unsupported Node\.js/,JSON.stringify(version));
});

test('package and lockfile declare the same supported versions as the runtime',async()=>{
  const metadata=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../package-lock.json',import.meta.url),'utf8'));
  assert.equal(metadata.engines.node,SUPPORTED_NODE_RANGE);
  assert.equal(lock.packages[''].engines.node,SUPPORTED_NODE_RANGE);
  assert.equal(lock.version,metadata.version);assert.equal(lock.packages[''].version,metadata.version);
});

test('an unsupported runtime stops CLI startup and recovery before filesystem changes',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-runtime-test-'));
  t.after(async()=>{
    const target=relative(resolve(tmpdir()),root);assert.ok(target.startsWith('virelo-runtime-test-')&&!target.includes('..'));
    await rm(root,{recursive:true,force:true});
  });
  const data=join(root,'untouched-data');
  for(const args of [['--no-open','--data',data,'--media',join(root,'missing-media')],['--data',data,'--reset-password','owner']]){
    const script=`Object.defineProperty(process.versions,'node',{value:'24.22.0'});process.argv=[process.execPath,'dist/cli.js',...${JSON.stringify(args)}];await import('./dist/cli.js');`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/Unsupported Node\.js 24\.22\.0/);
    assert.doesNotMatch(result.stderr,/Media directory cannot be read|No Virelo database found|SQLITE/);
    assert.equal(existsSync(data),false,'runtime rejection never initializes or changes data');
  }
});

test('direct server creation also rejects an unsupported runtime before creating data',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-runtime-server-'));
  t.after(async()=>{
    const target=relative(resolve(tmpdir()),root);assert.ok(target.startsWith('virelo-runtime-server-')&&!target.includes('..'));
    await rm(root,{recursive:true,force:true});
  });
  const data=join(root,'untouched-data');
  const script=`Object.defineProperty(process.versions,'node',{value:'26.12.0'});const {createVireloServer}=await import('./dist/server.js');await createVireloServer({dataDir:${JSON.stringify(data)},mediaPaths:[],host:'127.0.0.1',port:0});`;
  const result=spawnSync(process.execPath,['--disable-warning=ExperimentalWarning','--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
  assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/Unsupported Node\.js 26\.12\.0/);
  assert.equal(existsSync(data),false);
});

test('help and version remain available on an unsupported runtime without starting the app',()=>{
  for(const flag of ['--help','--version']){
    const script=`Object.defineProperty(process.versions,'node',{value:'22.23.3'});process.argv=[process.execPath,'dist/cli.js',${JSON.stringify(flag)}];await import('./dist/cli.js');`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000});
    assert.equal(result.status,0,result.stderr);
    if(flag==='--help')assert.match(result.stdout,/Requires Node\.js 22\.23\.4\+/);
  }
});
