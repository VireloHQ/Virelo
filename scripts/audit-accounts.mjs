import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVireloServer } from '../dist/server.js';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-account-ui-'));
const password='A private browser test passphrase';
async function checkFieldFocus(page,label) {
  const input=page.getByLabel(label,{exact:true});
  await input.click();
  assert.equal(await input.evaluate(element=>getComputedStyle(element).boxShadow),'none',label+' has no outer mouse-focus ring');
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');
  const focus=await input.evaluate(element=>({visible:element.matches(':focus-visible'),outline:getComputedStyle(element).outlineStyle,width:getComputedStyle(element).outlineWidth,offset:getComputedStyle(element).outlineOffset,shadow:getComputedStyle(element).boxShadow}));
  assert.equal(focus.visible,true,label+' remains keyboard-focusable');
  assert.equal(focus.shadow,'none',label+' has no outer keyboard-focus ring');
  assert.equal(focus.outline,'solid',label+' retains a visible focus indicator');
  assert.equal(focus.width,'2px');assert.equal(focus.offset,'-2px',label+' focus indicator stays inside the field');
}
process.env.VIRELO_LOG_LEVEL='silent';
let browser,server,diagnosticPage;
try {
  server=await createVireloServer({dataDir:root,mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const clip=execFileSync(process.env.VIRELO_TEST_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x334455:s=640x360:r=5:d=60',
    '-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true});
  const ids=[];
  for(const label of ['Shared','Hidden']){
    const folder=join(root,label);await mkdir(folder);const file=join(folder,label+'.mp4');await writeFile(file,clip);
    const library=server.db.addLibrary(folder,label);
    ids.push(server.db.upsertMedia({library_id:library.id,path:file,filename:label+'.mp4',title:label,sort_title:label.toLowerCase(),kind:'movie',series_title:null,season:null,episode:null,
      year:null,duration:60,width:640,height:360,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:clip.length,mtime:1,
      thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id);
  }
  await server.app.listen({host:'127.0.0.1',port:0});const base='http://127.0.0.1:'+server.app.server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
  const owner=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page=await owner.newPage(), errors=[];
  diagnosticPage=page;page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));
  const beforeSetup=[];page.on('request',request=>{if(new URL(request.url()).pathname.startsWith('/api/'))beforeSetup.push(request.url());});
  await page.goto(base);
  await page.getByRole('heading',{name:'Create administrator'}).waitFor();
  assert.equal(beforeSetup.some(url=>/\/api\/(?:home|media|libraries)/.test(url)),false,'catalog must not load before sign-in');
  await checkFieldFocus(page,'Username');await checkFieldFocus(page,'Password');
  await page.screenshot({path:join(repo,'node_modules/.cache/accounts-focus-setup.png')});
  await page.getByLabel('Username',{exact:true}).fill('owner');await page.getByLabel('Display name',{exact:true}).fill('Owner');
  await page.getByLabel('Password',{exact:true}).fill('short');await page.getByLabel('Confirm password',{exact:true}).fill('short');
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'15–128'}).waitFor();
  await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Create administrator',exact:true}).click();
  await page.locator('.desktop-nav').getByRole('link',{name:'Home',exact:true}).waitFor();
  const settings=async current=>{await current.goto(base+'/settings');await current.getByRole('heading',{name:'Settings',exact:true}).waitFor();};
  const section=(current,name)=>current.locator('.settings-sidebar').getByRole('button',{name,exact:true}).click();
  await settings(page);await section(page,'Account Manager');
  await page.getByRole('button',{name:'Add user',exact:true}).click();
  await checkFieldFocus(page,'Username');await checkFieldFocus(page,'Password');
  await page.getByLabel('Username',{exact:true}).fill('viewer');await page.getByLabel('Display name',{exact:true}).fill('Viewer');
  await page.getByLabel('Password',{exact:true}).fill(password);await page.getByLabel('Confirm password',{exact:true}).fill(password);
  await page.getByRole('switch',{name:'Shared',exact:true}).focus();await page.keyboard.press('Space');
  await page.getByRole('button',{name:'Create user',exact:true}).click();
  await page.getByRole('button',{name:'Save user',exact:true}).waitFor();
  assert.equal(await page.getByRole('switch',{name:'Shared',exact:true}).isChecked(),true);
  assert.equal(await page.getByRole('switch',{name:'Hidden',exact:true}).isChecked(),false);
  await page.screenshot({path:join(repo,'node_modules/.cache/accounts-desktop.png')});
  console.log('accounts: production bootstrap and Account Manager create a restricted viewer');

  const viewer=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const view=await viewer.newPage();view.on('pageerror',error=>errors.push(error.message));
  const signIn=async(current,name)=>{
    await current.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
    await checkFieldFocus(current,'Username');await checkFieldFocus(current,'Password');
    await current.getByLabel('Username',{exact:true}).fill(name);await current.getByLabel('Password',{exact:true}).fill(password);
    await current.getByRole('button',{name:'Sign in',exact:true}).click();await current.locator('.desktop-nav').getByRole('link',{name:'Home',exact:true}).waitFor();
  };
  await view.goto(base);await signIn(view,'viewer');
  await view.locator('.media-card').first().waitFor();assert.equal(await view.getByText('Hidden',{exact:true}).count(),0);
  assert.equal((await viewer.request.get(base+'/api/media/'+ids[1])).status(),404);
  assert.equal((await viewer.request.get(base+'/api/accounts')).status(),403);
  await settings(view);assert.equal(await view.locator('.settings-sidebar').getByRole('button',{name:/^Account Manager/}).count(),0);
  await section(view,'Libraries');assert.equal(await view.getByRole('button',{name:'Add folder',exact:true}).count(),0);
  await view.goto(base+'/watch/'+ids[0]);
  await view.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&video.currentTime>0;});
  console.log('accounts: authenticated video playback works; hidden libraries and admin controls stay inaccessible');

  await page.getByRole('switch',{name:'Play videos',exact:true}).locator('xpath=ancestor::label').click();
  await page.getByRole('switch',{name:'Convert audio and video',exact:true}).locator('xpath=ancestor::label').click();
  await page.getByRole('button',{name:'Save user',exact:true}).click();await page.getByRole('button',{name:'Save user',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('.account-editor button[type="submit"]')?.getAttribute('aria-busy')!=='true');
  await view.reload();await signIn(view,'viewer');await view.getByRole('heading',{name:'Playback is disabled',exact:true}).waitFor();
  console.log('accounts: revoking playback signs out the viewer and prevents player mounting');
  await page.getByRole('switch',{name:'Play videos',exact:true}).locator('xpath=ancestor::label').click();await page.getByRole('button',{name:'Save user',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.account-editor button[type="submit"]')?.getAttribute('aria-busy')!=='true');
  await view.evaluate(()=>localStorage.setItem('virelo-playback-quality:v1','90'));
  await view.reload();await signIn(view,'viewer');
  await view.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&video.currentTime>0;});
  await view.locator('.player').hover();await view.getByRole('button',{name:'Quality',exact:true}).click();
  await view.getByText('Video conversion is disabled for this account.',{exact:true}).waitFor();
  assert.equal(await view.getByRole('menu',{name:'Quality',exact:true}).getByRole('menuitemradio').count(),1);
  assert.equal(await view.evaluate(()=>localStorage.getItem('virelo-playback-quality:v1')),'90','policy must not overwrite the saved preference');
  await view.keyboard.press('Escape');await view.evaluate(()=>localStorage.removeItem('virelo-playback-quality:v1'));
  console.log('accounts: conversion-disabled viewers play the original despite a saved lower quality');
  await page.getByRole('switch',{name:'Administrator',exact:true}).locator('xpath=ancestor::label').click();await page.getByRole('button',{name:'Save user',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.account-editor button[type="submit"]')?.getAttribute('aria-busy')!=='true');
  await view.reload();await signIn(view,'viewer');await settings(view);await section(view,'Account Manager');
  assert.equal((await viewer.request.get(base+'/api/home')).ok(),true);
  assert.equal((await viewer.request.get(base+'/api/media/'+ids[1])).status(),404);
  console.log('accounts: a promoted administrator keeps their restricted library browsing');

  await page.getByRole('switch',{name:'Administrators can only access from localhost',exact:true}).locator('xpath=ancestor::label').click();
  await page.getByText('Network access updated. Other administrator sessions have been signed out.',{exact:true}).waitFor();
  assert.equal((await viewer.request.get(base+'/api/home')).status(),401);
  await page.setViewportSize({width:375,height:812});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(repo,'node_modules/.cache/accounts-mobile.png')});
  await page.setViewportSize({width:1440,height:1000});

  // Same-browser tabs must drop private state as soon as one tab signs out or switches account.
  const other=await owner.newPage();await settings(other);await section(page,'Account');
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();await other.getByRole('heading',{name:'Welcome back',exact:true}).waitFor();
  assert.equal(await other.locator('.media-card,.account-manager-list').count(),0);
  await signIn(page,'viewer');await other.locator('.desktop-nav').getByRole('link',{name:'Home',exact:true}).waitFor();
  assert.equal((await owner.request.get(base+'/api/auth/status')).ok(),true);
  assert.equal((await owner.request.get(base+'/api/media/'+ids[1])).status(),404);
  console.log('accounts: logout and account switching invalidate other tabs without exposing the old query cache');
  await settings(page);
  await checkFieldFocus(page,'Display name');await checkFieldFocus(page,'Current password');
  await page.screenshot({path:join(repo,'node_modules/.cache/accounts-focus-profile.png')});
  await page.getByLabel('Display name',{exact:true}).fill('My renamed account');
  await page.getByLabel('Username',{exact:true}).fill('viewer-renamed');
  await page.getByLabel('Current password',{exact:true}).fill('wrong');
  await page.getByLabel('New password',{exact:true}).fill('An updated browser test passphrase');
  await page.getByLabel('Confirm new password',{exact:true}).fill('An updated browser test passphrase');
  await page.getByRole('button',{name:'Save account',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Current password is incorrect.'}).waitFor();
  await page.getByLabel('Current password',{exact:true}).fill(password);
  await page.getByRole('button',{name:'Save account',exact:true}).click();
  await page.getByRole('heading',{name:'My renamed account',exact:true}).waitFor();
  assert.equal((await owner.request.get(base+'/api/auth/status')).ok(),true);
  console.log('accounts: profile username, display name and password changes keep the current session usable');
  assert.deepEqual(errors,[]);
  await owner.close();await viewer.close();
} catch(error) {
  if(diagnosticPage&&!diagnosticPage.isClosed())await diagnosticPage.screenshot({path:join(repo,'node_modules/.cache/accounts-failure.png')}).catch(()=>undefined);
  throw error;
} finally {
  if(browser)await browser.close();if(server)await server.app.close();
  const target=relative(resolve(tmpdir()),resolve(root));assert.ok(target.startsWith('virelo-account-ui-')&&!target.includes('..'));
  await rm(root,{recursive:true,force:true});
}
