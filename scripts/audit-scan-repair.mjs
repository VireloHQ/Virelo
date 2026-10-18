import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVireloServer } from '../dist/server.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-rescan-ui-'));
const fingerprint=async path=>({sha256:createHash('sha256').update(await readFile(path)).digest('hex'),mtime:(await stat(path)).mtimeMs});
process.env.VIRELO_LOG_LEVEL='silent';
let server,browser,page;
try{
  const media=join(root,'media');await mkdir(media);
  const source=join(media,'Example.mp4');
  execFileSync(process.env.VIRELO_TEST_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x334455:s=640x360:r=5:d=60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',source],{windowsHide:true});
  const original=await fingerprint(source);
  server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[media],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const setup=await server.app.inject({method:'POST',url:'/api/auth/setup',headers:{'x-virelo-request':'1'},payload:{username:'owner',password:'1'}});
  assert.equal(setup.statusCode,200,setup.body);
  await server.runScan();while(server.scanStatus.running)await new Promise(done=>setTimeout(done,10));
  const item=server.db.getMediaByPath(source);assert.ok(item.thumbnail_path);
  server.db.setProgress(item.id,20,60,1);server.db.setLike(item.id,true,1);
  await rm(item.thumbnail_path);
  await server.app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+server.app.server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  await context.addCookies([{name:'virelo_session',value:setup.headers['set-cookie'].split(';')[0].split('=')[1],url:base,httpOnly:true,sameSite:'Strict'}]);
  page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const firstCard=()=>page.locator('.media-card img').first();
  const waitBroken=async()=>{
    await page.getByRole('heading',{name:'Continue watching',exact:true}).waitFor();
    await page.locator('.media-card').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>document.querySelector('.media-card img')?.style.display==='none');
  };
  const waitRepaired=async()=>{
    await page.locator('.media-card').first().scrollIntoViewIfNeeded();
    await page.waitForFunction(()=>{const image=document.querySelector('.media-card img');return image?.naturalWidth>1&&image.style.display!=='none';});
    await page.locator('.hero-backdrop').waitFor();
    assert.ok(await page.locator('.hero-backdrop').evaluate(image=>image.naturalWidth)>1);
  };
  await page.goto(base);await waitBroken();
  const originalUrl=await firstCard().getAttribute('src'),documentTime=await page.evaluate(()=>performance.timeOrigin);
  await page.getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('.settings-sidebar').getByRole('button',{name:'Libraries',exact:true}).click();
  await page.getByText('Scan checks video files, fills in missing technical details',{exact:false}).waitFor();
  await page.getByRole('button',{name:'Scan',exact:true}).click();
  await page.locator('.scan-strip').filter({hasText:'1 thumbnail restored'}).waitFor();
  assert.equal(server.scanStatus.errors,0);assert.equal(server.scanStatus.updated,1);
  await page.locator('.desktop-nav').getByRole('link',{name:'Home',exact:true}).click();
  await waitRepaired();
  assert.notEqual(await firstCard().getAttribute('src'),originalUrl);
  assert.equal(await page.evaluate(()=>performance.timeOrigin),documentTime,'SPA navigation restores previously failed images without reloading');
  console.log('scan: Libraries Scan restores deleted thumbnail, reports repair count and refreshes Continue watching + hero');
  await rm(item.thumbnail_path);await page.reload();await waitBroken();
  const secondDocument=await page.evaluate(()=>performance.timeOrigin);
  const scan=await page.request.post(base+'/api/scan',{headers:{'x-virelo-request':'1'}});assert.equal(scan.status(),200);
  await waitRepaired();
  assert.equal(await page.evaluate(()=>performance.timeOrigin),secondDocument,'global scan completion refreshes an already-mounted Home without navigation');
  assert.deepEqual(await fingerprint(source),original);
  const after=server.db.getMedia(item.id,{userId:1,libraryIds:null});assert.equal(after.liked,1);assert.equal(after.progress_position,20);
  await page.screenshot({path:join(repo,'node_modules/.cache/rescan-repaired-home.png')});
  assert.deepEqual(errors,[]);
  console.log('scan: background completion retries failed images without reload and preserves source file, favorites and progress');
}catch(error){
  if(page&&!page.isClosed())await page.screenshot({path:join(repo,'node_modules/.cache/rescan-failure.png')}).catch(()=>{});
  throw error;
}finally{
  if(browser)await browser.close();
  if(server){while(server.scanStatus.running)await new Promise(done=>setTimeout(done,10));await server.app.close();}
  const target=relative(resolve(tmpdir()),resolve(root));assert.ok(target.startsWith('virelo-rescan-ui-')&&!target.includes('..'));
  await rm(root,{recursive:true,force:true});
}
