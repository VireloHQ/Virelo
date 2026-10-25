import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandDefinition, CustomCommands } from '../dist/custom-commands.js';
import { createVireloServer } from '../dist/server.js';
import { authenticatedInjector } from './auth-helper.mjs';

process.env.VIRELO_LOG_LEVEL='silent';

const fixture = fileURLToPath(new URL('./fixtures/custom-command.mjs', import.meta.url));
const definition = (mode='hold') => ({ name:'Test tool', executable:process.execPath, args:[fixture,mode,'{url}'], publicUrl:'', urlDomain:'share.example' });
async function until(read, accept, milliseconds=5000) {
  const end=Date.now()+milliseconds;
  do { const value=await read(); if(accept(value))return value; await new Promise(resolve=>setTimeout(resolve,30)); } while(Date.now()<end);
  assert.fail('Expected command state was not reached.');
}
const alive = pid => { try { process.kill(pid,0);return true; } catch { return false; } };

test('command validation is bounded and public URLs are exact HTTPS origins',()=>{
  assert.equal(commandDefinition({...definition(),publicUrl:'https://media.example/',urlDomain:''}).publicUrl,'https://media.example');
  assert.equal(commandDefinition({...definition(),urlDomain:'SHARE.EXAMPLE'}).urlDomain,'share.example');
  for(const value of [null,[],{}, {...definition(),name:''}, {...definition(),executable:'\0'}, {...definition(),args:'--argument'},
    {...definition(),args:Array(129).fill('x')}, {...definition(),args:['x\ny']}, {...definition(),args:['x'.repeat(4097)]},
    {...definition(),publicUrl:'http://media.example',urlDomain:''}, {...definition(),publicUrl:'https://user:password@media.example',urlDomain:''},
    {...definition(),publicUrl:'https://media.example/path',urlDomain:''}, {...definition(),publicUrl:'https://media.example/?token=x',urlDomain:''},
    {...definition(),publicUrl:'https://media.example',urlDomain:'share.example'}, {...definition(),urlDomain:'*.example.com'}, {...definition(),urlDomain:'com'}])assert.throws(()=>commandDefinition(value));
});

test('commands use literal arguments, bounded plain-text output and scoped URL discovery',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-run-')),sql=new DatabaseSync(join(root,'data.db'));
  const commands=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43210');
  const original=join(root,'original.mp4');await writeFile(original,'do not change');
  try{
    const saved=commands.save({...definition('echo'),args:[fixture,'echo','spaces stay together','"quoted"','$(never execute)','; & | >','{url}','',original]});
    assert.equal(saved.status,'stopped');assert.equal(saved.output,'');
    await commands.start(saved.id);
    const done=await until(()=>commands.list()[0],value=>value.status==='exited');
    assert.deepEqual(JSON.parse(done.output),['spaces stay together','"quoted"','$(never execute)','; & | >','http://127.0.0.1:43210','',original]);
    assert.equal(await readFile(original,'utf8'),'do not change');
    const noisy=commands.save(definition('noisy'));await commands.start(noisy.id);
    const active=await until(()=>commands.list().find(c=>c.id===noisy.id),value=>Boolean(value.activeUrl));
    assert.equal(active.activeUrl,'https://ready.share.example');assert.ok(active.output.length<=32768);assert.ok(!active.output.includes('\x1b'));
    assert.equal(commands.allowsHost('ready.share.example'),true);
    for(const host of ['outside.example','wrong.share.example.attacker.test','secret.share.example','query.share.example','other.share.example'])assert.equal(commands.allowsHost(host),false,host);
    assert.throws(()=>commands.save(definition(),noisy.id),/Stop the command/);assert.throws(()=>commands.remove(noisy.id),/Stop the command/);
    await assert.rejects(commands.start(noisy.id),/Stop the command/);
    await commands.stop(noisy.id);assert.equal(commands.allowsHost('ready.share.example'),false);
    assert.equal(commands.list().find(c=>c.id===noisy.id).status,'stopped');
    assert.equal(await readFile(original,'utf8'),'do not change');
  }finally{await commands.close();sql.close();await rm(root,{recursive:true,force:true});}
});

test('failed executables and exits are visible and never leave a public Host trusted',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-errors-')),sql=new DatabaseSync(join(root,'data.db'));
  const commands=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43210');
  try{
    const missing=commands.save({...definition(),executable:join(root,'missing-executable'),publicUrl:'https://media.example',urlDomain:''});
    await assert.rejects(commands.start(missing.id),/Could not start/);
    assert.equal(commands.list()[0].status,'error');assert.equal(commands.list()[0].exitCode,null);assert.match(commands.list()[0].output,/ENOENT/);assert.equal(commands.allowsHost('media.example'),false);
    const failing=commands.save(definition('exit'));await commands.start(failing.id);
    const done=await until(()=>commands.list().find(c=>c.id===failing.id),value=>value.status==='error');
    assert.equal(done.exitCode,7);assert.match(done.output,/configuration/);
  }finally{await commands.close();sql.close();await rm(root,{recursive:true,force:true});}
});

test('saved definitions persist but processes never auto-start; shutdown stops only owned process trees',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-tree-')),sql=new DatabaseSync(join(root,'data.db'));
  const commands=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43210');
  try{
    const saved=commands.save(definition('tree'));await commands.start(saved.id);
    const state=await until(()=>commands.list()[0],value=>/CHILD=\d+/.test(value.output));
    const pid=Number(state.output.match(/CHILD=(\d+)/)[1]);assert.ok(alive(pid));
    await commands.close();await until(()=>alive(pid),value=>!value);
    assert.equal(commands.list()[0].status,'stopped');
    await assert.rejects(commands.start(saved.id),/shutting down/);
    const reopened=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43211');
    assert.equal(reopened.list()[0].status,'stopped');assert.equal(reopened.list()[0].output,'');assert.equal(reopened.allowsHost('ready.share.example'),false);
    reopened.remove(saved.id);assert.deepEqual(reopened.list(),[]);await reopened.close();
  }finally{await commands.close();sql.close();await rm(root,{recursive:true,force:true});}
});

test('saved and running command limits do not release another command’s allowed Host',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-limits-')),sql=new DatabaseSync(join(root,'data.db'));
  const commands=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43210');
  try{
    const entries=Array.from({length:8},()=>commands.save(definition()));
    assert.throws(()=>commands.save(definition()),/eight/);
    await Promise.all(entries.slice(0,2).map(entry=>commands.start(entry.id)));
    await assert.rejects(commands.start(entries[2].id),/Two commands/);
    await until(()=>commands.list(),value=>value.slice(0,2).every(entry=>Boolean(entry.activeUrl)));
    await commands.stop(entries[0].id);assert.equal(commands.allowsHost('ready.share.example'),true);
    await commands.stop(entries[1].id);assert.equal(commands.allowsHost('ready.share.example'),false);
  }finally{await commands.close();sql.close();await rm(root,{recursive:true,force:true});}
});

test('POSIX stop also terminates attached children that ignore SIGTERM', {skip:process.platform==='win32'},async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-stubborn-')),sql=new DatabaseSync(join(root,'data.db'));
  const commands=new CustomCommands(sql,root,()=> 'http://127.0.0.1:43210');
  try{
    const entry=commands.save(definition('tree-stubborn'));await commands.start(entry.id);
    const state=await until(()=>commands.list()[0],value=>/CHILD=\d+/.test(value.output));
    const pid=Number(state.output.match(/CHILD=(\d+)/)[1]);assert.ok(alive(pid));
    await commands.stop(entry.id);await until(()=>alive(pid),value=>!value);
  }finally{await commands.close();sql.close();await rm(root,{recursive:true,force:true});}
});

test('command APIs reject viewers, LAN, proxies, cross-origin requests and remote administrators',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-api-'));
  const {app,db}=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
  db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  try{
    const inject=await authenticatedInjector(app), endpoints=[['GET','/api/commands'],['POST','/api/commands'],['PUT','/api/commands/1'],['DELETE','/api/commands/1'],['POST','/api/commands/1/start'],['POST','/api/commands/1/stop']];
    const save=await inject({method:'POST',url:'/api/commands',payload:definition()});assert.equal(save.statusCode,201,save.body);
    assert.equal(save.json().id,1);assert.match(save.headers['cache-control'],/no-store/);
    const account=await inject({method:'POST',url:'/api/accounts',payload:{username:'viewer',password:'1'}});assert.equal(account.statusCode,201,account.body);
    const login=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-virelo-request':'1'},payload:{username:'viewer',password:'1'}});
    const viewerCookie=login.headers['set-cookie'].split(';')[0];
    for(const [method,url] of endpoints){
      assert.equal((await app.inject({method,url,headers:{'x-virelo-request':'1'},payload:method==='POST'||method==='PUT'?definition():undefined})).statusCode,401,url);
      assert.equal((await inject({method,url,headers:{cookie:viewerCookie},payload:method==='POST'||method==='PUT'?definition():undefined})).statusCode,403,url);
      assert.equal((await inject({method,url,remoteAddress:'192.168.1.5',payload:method==='POST'||method==='PUT'?definition():undefined})).statusCode,403,url);
      for(const headers of [{'x-forwarded-for':'127.0.0.1'},{'forwarded':'for=127.0.0.1'},{'x-forwarded-proto':'https'},{'x-real-ip':'127.0.0.1'},{host:'media.example'}])
        assert.equal((await inject({method,url,headers,payload:method==='POST'||method==='PUT'?definition():undefined})).statusCode,403,url);
    }
    assert.equal((await inject({method:'POST',url:'/api/commands/1/start',headers:{'x-virelo-request':''}})).statusCode,403);
    assert.equal((await inject({method:'POST',url:'/api/commands/1/start',headers:{origin:'https://other.example'}})).statusCode,403);
    assert.equal((await inject({url:'/api/commands'})).json()[0].status,'stopped');
    const start=await inject({method:'POST',url:'/api/commands/1/start'});assert.equal(start.statusCode,200,start.body);
    await until(async()=> (await inject({url:'/api/commands'})).json()[0],value=>Boolean(value.activeUrl));
    assert.equal((await app.inject({url:'/api/auth/status',headers:{host:'ready.share.example'}})).statusCode,200);
    assert.equal((await app.inject({url:'/api/auth/status',headers:{host:'other.share.example'}})).statusCode,403);
    const remoteLogin=await app.inject({method:'POST',url:'/api/auth/login',headers:{host:'ready.share.example',origin:'https://ready.share.example','x-virelo-request':'1'},payload:{username:'viewer',password:'1'}});
    assert.equal(remoteLogin.statusCode,200,remoteLogin.body);assert.match(remoteLogin.headers['set-cookie'],/; Secure/);
    const localLogin=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-virelo-request':'1'},payload:{username:'viewer',password:'1'}});
    assert.equal(localLogin.statusCode,200);assert.doesNotMatch(localLogin.headers['set-cookie'],/; Secure/);
    assert.equal((await inject({method:'POST',url:'/api/accounts/security',payload:{adminLocalOnly:true}})).statusCode,200);
    const blocked=await app.inject({method:'POST',url:'/api/auth/login',headers:{host:'ready.share.example','x-virelo-request':'1'},payload:{username:'test-admin',password:'A test-only passphrase 2026'}});
    assert.equal(blocked.statusCode,403);assert.match(blocked.body,/limited to localhost/);
    const localAdmin=await app.inject({method:'POST',url:'/api/auth/login',headers:{'x-virelo-request':'1'},payload:{username:'test-admin',password:'A test-only passphrase 2026'}});
    const cookie=localAdmin.headers['set-cookie'].split(';')[0];
    assert.equal((await inject({method:'POST',url:'/api/commands/1/stop',headers:{cookie}})).statusCode,200);
    assert.equal((await app.inject({url:'/api/auth/status',headers:{host:'ready.share.example'}})).statusCode,403);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});

test('URL placeholders preserve an IPv6-only binding and actual selected port',async t=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-command-ipv6-'));
  const {app,db}=await createVireloServer({dataDir:root,mediaPaths:[],host:'::1',port:0});
  db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  try{
    try{await app.listen({host:'::1',port:0});}catch(error){if(['EADDRNOTAVAIL','EAFNOSUPPORT'].includes(error.code)){t.skip('IPv6 unavailable on this host');return;}throw error;}
    const inject=await authenticatedInjector(app),saved=await inject({method:'POST',url:'/api/commands',payload:definition('echo')});
    const id=saved.json().id;
    assert.equal((await inject({method:'POST',url:`/api/commands/${id}/start`})).statusCode,200);
    const result=await until(async()=> (await inject({url:'/api/commands'})).json()[0],value=>value.status==='exited');
    assert.deepEqual(JSON.parse(result.output),[`http://[::1]:${app.server.address().port}`]);
  }finally{await app.close();await rm(root,{recursive:true,force:true});}
});
