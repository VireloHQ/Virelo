import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, open, rm, stat } from 'node:fs/promises';
import { get } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { VireloDB } from '../dist/db.js';
import { controlProfile, readRecentLog, sendControl } from '../dist/server-control.js';
import { waitForStop } from '../dist/server-process.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'virelo-server-recovery-'));
const data = join(root, 'data'), folder = join(root, 'videos'), path = join(folder, 'paused.mp4');
const run = (...args) => promisify(execFile)(process.execPath, [cli, ...args, '--data', data], {cwd:root, windowsHide:true, timeout:25000});
let profile, browser, stream, occupied;
try {
  await mkdir(folder);
  const file = await open(path, 'wx');
  try { await file.truncate(64 * 1024 * 1024); } finally { await file.close(); }
  const source = await stat(path);
  profile = await controlProfile(data);
  await run('--background', '--random-port', '--no-open');
  const before = await sendControl(profile, {action:'status'});
  assert.equal(before?.ok,true);
  const origin = before.status.url;
  const db = new VireloDB(data);
  let id;
  try {
    const library = db.addLibrary(folder, 'Test videos');
    id = db.upsertMedia({library_id:library.id,path,filename:'paused.mp4',title:'Paused stream',sort_title:'Paused stream',kind:'video',folder:'',size:source.size,mtime:source.mtimeMs,duration:60,width:320,height:180,video_codec:'h264',audio_codec:'aac',container:'mp4',series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id;
  } finally { db.close(); }
  browser = await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context = await browser.newContext({serviceWorkers:'block'});
  const page = await context.newPage();
  const setup = await page.request.post(origin+'/api/auth/setup',{headers:{'X-Virelo-Request':'1'},data:{username:'owner',password:'test-only-passphrase'}});
  assert.equal(setup.status(),200,await setup.text());
  await page.goto(origin+'/settings#server');
  await page.getByRole('button',{name:'Restart server',exact:true}).waitFor();

  occupied=createServer();occupied.listen(0,'127.0.0.1');await once(occupied,'listening');
  const port=occupied.address().port, target='http://127.0.0.1:'+port;
  const portField=page.getByRole('spinbutton',{name:'HTTP port'});
  await portField.fill(String(port));
  await page.getByRole('button',{name:'Save settings',exact:true}).click();
  await page.getByText('Settings saved.',{exact:true}).waitFor();
  const conflict=await page.request.post(origin+'/api/server/management/restart',{headers:{'X-Virelo-Request':'1'}});
  assert.equal(conflict.status(),409,await conflict.text());
  assert.equal((await sendControl(profile,{action:'status'})).status.pid,before.status.pid);
  await new Promise(resolve=>occupied.close(resolve));occupied=undefined;

  const cookie=(await context.cookies(origin)).map(({name,value})=>name+'='+value).join('; ');
  stream=await new Promise((resolve,reject)=>get(origin+'/api/media/'+id+'/stream',{headers:{cookie}},resolve).on('error',reject));
  stream.on('error',()=>{});stream.pause();
  assert.equal(stream.statusCode,200);
  assert.equal(stream.complete,false);
  let probes=0;
  await page.route(target+'/server-ready?**',async route=>{
    if(++probes>1)return route.continue();
    await route.fulfill({json:{proof:'0'.repeat(64)},headers:{'Access-Control-Allow-Origin':origin}});
  });
  await page.getByRole('button',{name:'Restart server',exact:true}).click();
  const recoveryResponse=page.waitForResponse(response=>response.url().startsWith(origin+'/server-recovery?'));
  await page.getByRole('dialog').getByRole('button',{name:'Restart server',exact:true}).click();
  const recovery=await recoveryResponse;
  assert.equal(recovery.status(),200,await recovery.text());
  await page.waitForURL(target+'/settings#server',{timeout:45000});
  await page.getByRole('button',{name:'Restart server',exact:true}).waitFor();
  const after=await sendControl(profile,{action:'status'});
  assert.ok(probes>=2,'Recovery must reject the first, invalid proof');
  assert.equal(after?.ok,true);assert.equal(after.status.port,port);assert.notEqual(after.status.pid,before.status.pid);
  const auth=await page.request.get(target+'/api/auth/status');
  assert.equal(auth.status(),200);
  assert.equal((await auth.json()).user?.username,'owner');
  assert.equal((await stat(path)).mtimeMs,source.mtimeMs);
  assert.equal((await stat(path)).size,source.size);
  console.log('server recovery: occupied port rejected, paused stream released, authenticated navigation to the new port, original file unchanged');
} catch(error){
  if(profile)console.error(await readRecentLog(profile).catch(()=>''));
  throw error;
} finally {
  stream?.destroy();
  if(occupied?.listening)await new Promise(resolve=>occupied.close(resolve));
  await browser?.close();
  if(profile){
    if((await sendControl(profile,{action:'status'}))?.ok)await run('stop');
    await waitForStop(profile);
  }
  const rel=relative(resolve(tmpdir()),resolve(root));
  assert.ok(rel.startsWith('virelo-server-recovery-')&&!rel.includes('..'));
  await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200});
}
