import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createVireloServer} from '../dist/server.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-startup-audit-'));
process.env.VIRELO_LOG_LEVEL='silent';
let server,browser,release=()=>{};
try{
  const media=join(root,'project');await mkdir(media);
  await Promise.all(Array.from({length:400},async(_,i)=>{
    const folder=join(media,'folder-'+i);await mkdir(folder);
    await writeFile(join(folder,'types.d.ts'),'export interface Media { title: string; }');
  }));
  await mkdir(join(media,'node_modules','dependency'),{recursive:true});
  await writeFile(join(media,'node_modules','dependency','fixture.mp4'),'must not be indexed');
  const source=join(media,'source.ts');await writeFile(source,'export const version = 1;');
  server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[media],host:'127.0.0.1',port:0});
  server.db.updateSettings({externalMetadataEnabled:false});
  await server.app.listen({host:'127.0.0.1',port:0});
  const base='http://127.0.0.1:'+server.app.server.address().port;
  await server.runScan();assert.equal(server.scanStatus.running,true);
  const timings=await Promise.all(Array.from({length:12},async(_,i)=>{
    const started=performance.now(),response=await fetch(base+(i%2?'/startup.js':'/api/auth/status'));
    assert.equal(response.status,200);await response.text();return Math.round(performance.now()-started);
  }));
  console.log('startup request timings (ms): '+timings.join(', '));
  assert.ok(Math.max(...timings)<3000,'startup requests remain responsive during folder discovery: '+Math.max(...timings)+'ms');
  while(server.scanStatus.running)await new Promise(done=>setTimeout(done,10));
  assert.equal(server.scanStatus.scanned,0);assert.equal(server.scanStatus.errors,0);
  assert.equal(server.db.listMedia({}).length,0);
  assert.equal(await readFile(source,'utf8'),'export const version = 1;');
  console.log('non-video project: 400 folders, no false videos, maximum concurrent shell/API latency '+Math.max(...timings)+'ms');

  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const stalled=new Promise(done=>{release=done;});
  await page.route(/\/(?:startup\.js|assets\/index-[^/?]+\.(?:js|css))$/,async route=>{await stalled;await route.continue();});
  await page.goto(base,{waitUntil:'commit'});
  await page.locator('#startup-loading').waitFor({state:'visible',timeout:3000});
  assert.equal(await page.locator('#startup-loading').innerText(),'Virelo\nLoading…');
  assert.ok(await page.locator('link[data-startup-style]').count()>0,'built CSS must be nonblocking');
  assert.equal(await page.locator('#root').isVisible(),false);
  await page.screenshot({path:join(repo,'node_modules/.cache/startup-loading.png')});
  release();
  await page.getByRole('heading',{name:'Create administrator',exact:true}).waitFor();
  await page.locator('#startup-loading').waitFor({state:'hidden'});
  await page.locator('#startup-error').waitFor({state:'hidden'});
  console.log('cold startup: loading screen paints while startup JS, entry JS and CSS are all stalled; setup appears after release');

  const faultContext=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
  const fault=await faultContext.newPage();fault.setDefaultTimeout(20000);
  fault.on('pageerror',error=>errors.push(error.message));
  await fault.route(/\/assets\/index-[^/?]+\.css$/,route=>route.abort('failed'));
  await fault.goto(base,{waitUntil:'domcontentloaded'});
  await fault.locator('#startup-error').waitFor({state:'visible'});
  assert.equal(await fault.locator('#root').isVisible(),false);
  await fault.unrouteAll();
  await fault.getByRole('button',{name:'Try again',exact:true}).click();
  await fault.getByRole('heading',{name:'Create administrator',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('failed startup CSS: readable recovery and explicit retry, without exposing unstyled UI');
}finally{
  release();
  if(browser)await browser.close();
  if(server){while(server.scanStatus.running)await new Promise(done=>setTimeout(done,10));await server.app.close();}
  const target=relative(resolve(tmpdir()),root);assert.ok(target.startsWith('virelo-startup-audit-')&&!target.includes('..'));
  await rm(root,{recursive:true,force:true});
}
