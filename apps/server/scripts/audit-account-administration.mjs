import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';

process.env.VIRELO_LOG_LEVEL='silent';
const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-admin-ui-'));
let server,browser;
try {
  server=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const clip=execFileSync(process.env.VIRELO_TEST_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x334455:s=320x180:r=5:d=60','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true});
  const folder=join(root,'Shared');await mkdir(folder);const path=join(folder,'clip.mp4');await writeFile(path,clip);
  const library=server.db.addLibrary(folder,'Shared');
  const item=server.db.upsertMedia({library_id:library.id,path,filename:'clip.mp4',title:'Example video',sort_title:'Example video',kind:'video',folder:'',size:clip.length,mtime:1,duration:60,width:320,height:180,video_codec:'h264',audio_codec:'aac',container:'mp4',series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null});
  const hash=await hashPassword('1');
  server.accounts.save({username:'owner',displayName:'Owner'},hash,undefined,true);
  const viewer=server.accounts.save({username:'viewer',displayName:'Viewer',libraryIds:[library.id]},hash);
  server.db.setLike(item.id,true,viewer.id);server.db.setProgress(item.id,2,60,viewer.id);
  await server.app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+server.app.server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
  const owner=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}}),guest=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});
  for(const context of [owner,guest])await context.addInitScript(()=>{Object.defineProperty(Crypto.prototype,'randomUUID',{value:undefined,configurable:true});});
  const page=await owner.newPage(),view=await guest.newPage(),errors=[];
  for(const current of [page,view]){current.setDefaultTimeout(12000);current.on('pageerror',error=>errors.push(error.message));}
  const login=async(current,username)=>{
    await current.getByLabel('Username',{exact:true}).fill(username);await current.getByLabel('Password',{exact:true}).fill('1');await current.getByRole('button',{name:'Sign in',exact:true}).click();await current.locator('.desktop-nav').waitFor({state:'attached'});
  };
  await page.goto(base+'/settings#accounts');await login(page,'owner');
  await page.getByRole('button',{name:'Edit Viewer',exact:true}).waitFor();
  assert.equal(await page.locator('.account-users tbody tr').count(),2);
  assert.ok((await page.locator('.account-users tbody tr').first().boundingBox()).height<100,'user rows stay compact');
  await page.getByRole('textbox',{name:'Search users',exact:true}).fill('viewer');assert.equal(await page.locator('.account-users tbody tr').count(),1);await page.getByRole('textbox',{name:'Search users',exact:true}).fill('');
  await page.screenshot({path:join(repo,'node_modules/.cache/admin-users-desktop.png')});
  await page.setViewportSize({width:390,height:844});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.ok((await page.getByRole('button',{name:'Edit Viewer',exact:true}).boundingBox()).x<300,'mobile edit is visible without horizontal scrolling');
  await page.screenshot({path:join(repo,'node_modules/.cache/admin-users-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Edit Viewer',exact:true}).click();
  await page.getByRole('tab',{name:'Profile',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Libraries',exact:true}).getAttribute('aria-selected'),'true');
  await page.getByRole('tab',{name:'Data',exact:true}).click();await page.getByRole('button',{name:'Clear watch history',exact:true}).waitFor();
  await page.getByRole('button',{name:'Clear watch history',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal(server.db.db.prepare('SELECT COUNT(*) n FROM user_progress WHERE user_id=?').get(viewer.id).n,1);
  await page.getByRole('button',{name:'Clear watch history',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Clear data',exact:true}).click();await page.getByRole('alertdialog').waitFor({state:'hidden'});
  assert.equal(server.db.db.prepare('SELECT COUNT(*) n FROM user_progress WHERE user_id=?').get(viewer.id).n,0);
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'data controls fit '+width);
    await page.screenshot({path:join(repo,`node_modules/.cache/admin-user-data-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/settings#admin');
  await page.getByRole('switch',{name:'Monitor activity',exact:true}).focus();await page.keyboard.press('Space');await page.getByRole('button',{name:'Save monitoring settings',exact:true}).click();
  await page.locator('.activity-disclosure-compact summary').waitFor();
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:join(repo,'node_modules/.cache/admin-settings-desktop.png')});
  await view.goto(base);await view.locator('.activity-disclosure').getByText('Activity monitoring is on',{exact:true}).waitFor();
  await login(view,'viewer');await view.locator('.activity-disclosure-compact summary').waitFor();
  await view.goto(base+'/watch/'+item.id);
  await view.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&video.currentTime>0;});
  await page.goto(base+'/settings#activity');
  const online=page.locator('.admin-table').first();await online.getByRole('row').filter({hasText:'Viewer'}).filter({hasText:'Playing'}).waitFor();
  assert.equal(await online.getByRole('row').filter({hasText:'Viewer'}).count(),1,'reloads reuse the same tab presence');
  await page.locator('.activity-events').getByRole('row').filter({hasText:'Started playback'}).waitFor();
  assert.equal((await guest.request.get(base+'/api/accounts/activity')).status(),403);
  await view.goto(base+'/settings#account');await view.locator('.account-profile').waitFor();
  assert.equal(await view.locator('#settings-nav-admin,#settings-nav-activity,#settings-nav-accounts').count(),0);
  await page.getByRole('button',{name:'Refresh',exact:true}).click();await online.getByRole('row').filter({hasText:'Viewer'}).filter({hasText:'Online'}).waitFor();
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'activity fits '+width);
    await page.screenshot({path:join(repo,`node_modules/.cache/admin-activity-${width}.png`)});
  }
  await page.setViewportSize({width:1440,height:1000});await page.goto(base+'/settings#accounts');await page.getByRole('button',{name:'Edit Viewer',exact:true}).click();await page.getByRole('tab',{name:'Activity',exact:true}).click();await page.getByRole('button',{name:'Refresh',exact:true}).click();
  assert.equal(await page.locator('.activity-events').getByRole('row').filter({hasText:'Owner'}).count(),0,'user activity is filtered');
  await page.getByRole('tab',{name:'Data',exact:true}).click();await page.getByRole('button',{name:'Sign out devices',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Sign out devices',exact:true}).click();
  await view.reload();await view.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
  assert.ok((await readFile(path)).equals(clip));assert.deepEqual(errors,[]);
  console.log('administration: compact table, keyboard tabs, scoped data clears, responsive layouts, visible notice, live playback, retained history and session revocation passed');
} finally {
  await browser?.close();await server?.app.close();const rel=relative(resolve(tmpdir()),resolve(root));assert.ok(rel.startsWith('virelo-admin-ui-')&&!rel.includes('..'));await rm(root,{recursive:true,force:true});
}
