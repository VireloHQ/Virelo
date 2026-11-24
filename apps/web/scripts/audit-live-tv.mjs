import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const directory=await mkdtemp(join(tmpdir(),'virelo-live-tv-'));
const repo=fileURLToPath(new URL('../',import.meta.url));
const provider='https://live-fixture.example';
const collection='#EXTM3U\n#EXTINF:-1 group-title="News",Studio One\n'+provider+'/one/index.m3u8\n'
  +'#EXTINF:-1 group-title="Music",Studio Two\n'+provider+'/two/index.m3u8\n'
  +Array.from({length:14},(_,i)=>'#EXTINF:-1 group-title="Documentary",Field Station '+(i+1)+'\n'+provider+'/station-'+i+'/index.m3u8\n').join('');
let child,browser;
try {
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=20:d=12',
    '-c:v','libx264','-pix_fmt','yuv420p','-g','20','-hls_time','1','-hls_playlist_type','vod','index.m3u8'
  ],{cwd:directory,windowsHide:true,timeout:20000});
  let base=process.env.VIRELO_TEST_LIVE_TV_URL;
  if(!base){
    child=spawn(process.execPath,[fileURLToPath(new URL('bin/vite.js',import.meta.resolve('vite/package.json'))),
      'preview','--host','127.0.0.1','--port','0'],{cwd:repo,stdio:['ignore','pipe','pipe'],windowsHide:true});
    base=await new Promise((resolve,reject)=>{
      let output='';
      const timer=setTimeout(()=>reject(new Error(output||'Preview did not start')),20000);
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.stderr.on('data',chunk=>output+=chunk);
      child.stdout.on('data',chunk=>{
        output+=chunk.toString().replace(/\x1b\[[0-9;]*m/g,'');
        const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
        if(url){clearTimeout(timer);resolve(url);}
      });
    });
  }
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
  const requests=[];
  let releaseDelayed;
  const delayed=new Promise(resolve=>{releaseDelayed=resolve;});
  await context.route(provider+'/**',async route=>{
    const {pathname}=new URL(route.request().url());
    requests.push(pathname);
    const headers={'Access-Control-Allow-Origin':'*'};
    if(pathname==='/channels')return route.fulfill({body:collection,contentType:'text/plain',headers});
    if(pathname==='/station-0/index.m3u8')return route.fulfill({status:503,headers});
    if(pathname==='/station-1/index.m3u8')return route.abort('failed');
    if(pathname==='/station-12/index.m3u8')await delayed;
    const name=basename(pathname);
    if(name==='index.m3u8'||/^index\d+\.ts$/.test(name))return route.fulfill({
      body:await readFile(join(directory,name)),contentType:name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl',headers
    });
    return route.fulfill({status:404,headers});
  });
  const page=await context.newPage();
  page.setDefaultTimeout(10000);
  const playerModules=[];
  page.on('request',request=>{if(/\/assets\/hls\.light-/.test(request.url()))playerModules.push(request.url());});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const normal=await page.goto(base+'/app/library');
  const csp=normal.headers()['content-security-policy'];
  assert.match(csp,/connect-src 'self' blob:;/);
  const nav=await page.locator('.topbar').elementHandle();
  const tv=page.locator('main').getByRole('link',{name:'Live TV',exact:true});
  const [document]=await Promise.all([page.waitForResponse(response=>response.url()===base+'/media/iptv/'&&response.request().isNavigationRequest()),tv.click()]);
  assert.equal(document.status(),200);
  assert.match(document.headers()['content-security-policy'],/connect-src 'self' blob: https:;/);
  assert.match(document.headers()['content-security-policy'],/frame-ancestors 'self';/);
  assert.equal(new URL(page.url()).pathname,'/app/live-tv');
  assert.ok(await page.locator('.topbar').evaluate((current,previous)=>current===previous,nav),'TV opens without replacing the app shell');
  const dock=page.getByRole('navigation',{name:'Mobile navigation'});
  assert.equal(await dock.getByRole('link').count(),5);
  assert.equal(await dock.getByRole('link',{name:'Library',exact:true}).getAttribute('aria-current'),'location');
  const frame=page.frameLocator('.live-tv-frame');
  await frame.getByRole('heading',{name:'Live TV',exact:true}).waitFor();
  assert.equal(requests.length,0,'opening the screen never connects to a provider');
  await frame.getByLabel('Playlist name').fill('Test channels');
  await frame.getByLabel('Playlist link',{exact:true}).fill(provider+'/channels');
  await frame.getByRole('button',{name:'Add playlist',exact:true}).click();
  const first=frame.getByRole('button',{name:'Studio One',exact:true}),second=frame.getByRole('button',{name:'Studio Two',exact:true});
  await first.waitFor();
  assert.deepEqual(requests,['/channels'],'import does not probe the channels');
  assert.deepEqual(playerModules,[],'HLS code is not fetched before choosing a channel');
  assert.equal(await frame.locator('select,input[type=file]:visible').count(),0,'no native select or file input is visible');
  const groupPicker=frame.getByRole('button',{name:'Channel group',exact:true});
  await groupPicker.focus();await groupPicker.press('Enter');
  await frame.getByRole('option',{name:'Music',exact:true}).click();
  await first.waitFor({state:'hidden'});
  await groupPicker.click();await frame.getByRole('option',{name:'All groups',exact:true}).click();
  const search=frame.getByRole('textbox',{name:'Search channels',exact:true});
  await search.fill('Studio One');await second.waitFor({state:'hidden'});
  const focus=await search.evaluate(element=>{
    const css=getComputedStyle(element);
    return {outline:css.outlineWidth,shadow:css.boxShadow,spellcheck:element.spellcheck};
  });
  assert.deepEqual(focus,{outline:'2px',shadow:'none',spellcheck:false});
  await search.clear();await second.waitFor();
  const list=frame.locator('.live-channels');
  assert.equal(await list.evaluate(node=>getComputedStyle(node).scrollbarWidth),'none');
  assert.ok(await list.evaluate(node=>{node.scrollTop=200;const scrollable=node.scrollTop>0;node.scrollTop=0;return scrollable;}));
  await frame.getByRole('button',{name:'Check visible',exact:true}).click();
  await frame.getByRole('button',{name:/^Check Studio One: [1-9]\d* ms$/}).waitFor();
  await frame.getByRole('button',{name:'Check Field Station 1: Unavailable',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Check Field Station 2: Could not confirm',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Check visible',exact:true}).waitFor();
  assert.ok(!requests.includes('/station-13/index.m3u8'),'checking visible rows does not probe the rest of the playlist');
  assert.ok(requests.every(path=>path==='/channels'||path.endsWith('.m3u8')),'checking never downloads a video segment');
  assert.deepEqual(playerModules,[],'checks do not load the HLS player');
  assert.equal(await frame.locator('video').count(),0);
  const statusPicker=frame.getByRole('button',{name:'Stream status',exact:true});
  await statusPicker.click();await frame.getByRole('option',{name:'Unavailable',exact:true}).click();
  await first.waitFor({state:'hidden'});
  await frame.getByRole('button',{name:'Field Station 1',exact:true}).waitFor();
  await statusPicker.click();await frame.getByRole('option',{name:'All statuses',exact:true}).click();
  await search.fill('Field Station 14');
  await frame.getByRole('button',{name:'Check Field Station 14: Not checked',exact:true}).click();
  await frame.getByRole('button',{name:/^Check Field Station 14: [1-9]\d* ms$/}).waitFor();
  await search.fill('Field Station 13');
  const delayedCheck=frame.getByRole('button',{name:'Check Field Station 13: Not checked',exact:true});
  await Promise.all([page.waitForRequest(provider+'/station-12/index.m3u8'),delayedCheck.click()]);
  await frame.getByRole('button',{name:'Cancel checks',exact:true}).click();
  await delayedCheck.waitFor();
  releaseDelayed();
  await search.clear();
  const checksBeforePlay=requests.length;
  await first.click();
  const player=page.frames().find(child=>child.url()===base+'/media/iptv/');
  await player.waitForFunction(()=>{const video=document.querySelector('video');return video?.videoWidth===160&&!video.paused&&video.currentTime>.05;});
  assert.ok(requests.some(path=>/^\/one\/index\d+\.ts$/.test(path)));
  assert.ok(!requests.slice(checksBeforePlay).some(path=>path.startsWith('/two/')));
  const liveTransport=frame.locator('.player-controls[data-live="true"]');
  await page.evaluate(()=>localStorage.setItem('virelo.appearance.v1',JSON.stringify({controllerStyle:'theater',accentColor:'#c3a6ff'})));
  await player.waitForFunction(()=>document.querySelector('.player-controls')?.getAttribute('data-controller-style')==='theater');
  const video=frame.locator('.live-tv-player video');
  assert.equal(await video.evaluate(element=>element.controls),false);
  assert.equal(await liveTransport.locator('.player-seek,.repeat-control').count(),0);
  const pause=liveTransport.getByRole('button',{name:'Pause',exact:true});
  const play=liveTransport.getByRole('button',{name:'Play',exact:true});
  await video.hover({position:{x:12,y:20}});await pause.click();
  await player.waitForFunction(()=>document.querySelector('.live-tv-player video')?.paused===true);
  await play.waitFor();
  assert.ok(await video.evaluate(element=>element.paused));
  const volume=liveTransport.getByRole('button',{name:'Volume',exact:true});
  await volume.click();
  const volumeDialog=frame.getByRole('dialog',{name:'Volume',exact:true});
  await volumeDialog.getByRole('button',{name:'Mute',exact:true}).click();
  await player.waitForFunction(()=>document.querySelector('.live-tv-player video')?.muted===true);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('virelo-playback-volume:v1')).muted),true);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>localStorage.setItem('virelo-playback-volume:v1',JSON.stringify({volume:.4,muted:false})));
  await player.waitForFunction(()=>{const video=document.querySelector('.live-tv-player video');return video?.volume===.4&&video.muted===false;});
  await video.click({button:'right',position:{x:12,y:20}});
  await frame.getByRole('menu',{name:'Video actions',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  await liveTransport.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await player.waitForFunction(()=>document.fullscreenElement?.classList.contains('live-tv-player'));
  await liveTransport.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await player.waitForFunction(()=>!document.fullscreenElement);
  await play.click();await pause.waitFor();
  await second.click();
  await player.waitForFunction(()=>document.querySelector('video[aria-label="Studio Two"]')?.videoWidth===160);
  assert.ok(requests.some(path=>path.startsWith('/two/')));
  await page.setViewportSize({width:320,height:740});
  await player.waitForFunction(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1);
  assert.ok(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1));
  const remove=frame.getByRole('button',{name:'Remove playlist',exact:true});
  await remove.click();
  const dialog=frame.getByRole('alertdialog');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.goBack();
  assert.equal(new URL(page.url()).pathname,'/app/library');
  assert.ok(await page.locator('.topbar').evaluate((current,previous)=>current===previous,nav));
  await page.locator('.live-tv-frame').waitFor({state:'detached'});
  await page.goForward();await first.waitFor();
  await page.reload();await first.waitFor();
  assert.equal(await frame.locator('video').count(),0,'reload does not restart a stream');
  const importText='#EXTM3U\n#EXTINF:-1,Extra Channel\n'+provider+'/extra/index.m3u8\n';
  for(const mode of ['File','Paste text']){
    await frame.locator('.content-heading').getByRole('button',{name:'Add playlist',exact:true}).click();
    const form=frame.getByRole('form',{name:'Add playlist',exact:true});
    await form.getByRole('button',{name:mode,exact:true}).click();
    if(mode==='File')await form.locator('input[type=file]').setInputFiles({name:'Extra.m3u',mimeType:'audio/x-mpegurl',buffer:Buffer.from(importText)});
    else await form.getByLabel('Playlist text').fill(importText);
    await form.getByRole('button',{name:'Add playlist',exact:true}).click();
    await frame.getByRole('button',{name:'Extra Channel',exact:true}).waitFor();
    await remove.click();
    await dialog.getByRole('button',{name:'Remove playlist',exact:true}).click();
    await first.waitFor();
  }
  await page.setViewportSize({width:1440,height:900});
  const desktop=page.getByRole('navigation',{name:'Main navigation'});
  assert.equal(await desktop.getByRole('link',{name:'Live TV',exact:true}).getAttribute('aria-current'),'page');
  await page.locator('.topbar').getByRole('button',{name:'Settings',exact:true}).click();
  await page.locator('#settings-nav-appearance').click();
  await page.getByRole('button',{name:'Navigation layout',exact:true}).click();
  await page.getByRole('option',{name:'Sidebar',exact:true}).click();
  const rail=page.locator('.app-shell[data-navigation="sidebar"] .topbar');
  await rail.waitFor();
  await desktop.getByRole('link',{name:'Live TV',exact:true}).click();
  await first.waitFor();
  assert.ok(await rail.isVisible());
  assert.equal(await desktop.getByRole('link',{name:'Live TV',exact:true}).getAttribute('aria-current'),'page');
  if(process.env.VIRELO_TEST_LIVE_TV_SCREENSHOT){
    await frame.getByRole('button',{name:'Check visible',exact:true}).click();
    await frame.getByRole('button',{name:/^Check Studio One: [1-9]\d* ms$/}).waitFor();
    await first.click();
    await video.hover({position:{x:12,y:20}});await pause.click();await play.waitFor();
    await page.screenshot({path:process.env.VIRELO_TEST_LIVE_TV_SCREENSHOT});
  }
  const oldLocation=await page.goto(base+'/media/iptv/');
  assert.equal(oldLocation.status(),200);
  await page.waitForURL('**/app/live-tv');
  await first.waitFor();
  await page.route(base+'/media/iptv/',route=>route.fulfill({status:503,contentType:'text/plain',body:'Unavailable'}),{times:1});
  await page.reload();
  await page.getByRole('button',{name:'Try again',exact:true}).click();
  await first.waitFor();
  assert.ok(await rail.isVisible());
  assert.deepEqual(errors,[]);
  console.log('PASS focus, hidden but scrollable guide, visible and individual HLS checks, status filtering, scoped CSP, player controls and navigation');
} finally {
  await browser?.close();
  child?.kill();
  const target=relative(resolve(tmpdir()),resolve(directory));
  assert.match(target,/^virelo-live-tv-[^/\\]+$/);
  await rm(directory,{recursive:true,force:true});
}
