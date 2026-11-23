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
  +'#EXTINF:-1 group-title="Music",Studio Two\n'+provider+'/two/index.m3u8\n';
let child,browser;
try {
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=20:d=4',
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
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  const requests=[];
  await context.route(provider+'/**',async route=>{
    const {pathname}=new URL(route.request().url());
    requests.push(pathname);
    const headers={'Access-Control-Allow-Origin':'*'};
    if(pathname==='/channels')return route.fulfill({body:collection,contentType:'text/plain',headers});
    const name=basename(pathname);
    if(name==='index.m3u8'||/^index\d+\.ts$/.test(name))return route.fulfill({
      body:await readFile(join(directory,name)),contentType:name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl',headers
    });
    return route.fulfill({status:404,headers});
  });
  const page=await context.newPage();
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
  await frame.getByLabel('Channel group').selectOption('Music');
  assert.ok(await first.isHidden());
  await frame.getByLabel('Channel group').selectOption('');
  await first.click();
  const player=page.frames().find(child=>child.url()===base+'/media/iptv/');
  await player.waitForFunction(()=>document.querySelector('video')?.videoWidth===160);
  assert.ok(requests.some(path=>/^\/one\/index\d+\.ts$/.test(path)));
  assert.ok(!requests.some(path=>path.startsWith('/two/')));
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
  if(process.env.VIRELO_TEST_LIVE_TV_SCREENSHOT)await page.screenshot({path:process.env.VIRELO_TEST_LIVE_TV_SCREENSHOT});
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
  console.log('PASS app navigation, scoped Live TV CSP, M3U import, HLS playback, history, persistence, mobile fit and retry');
} finally {
  await browser?.close();
  child?.kill();
  const target=relative(resolve(tmpdir()),resolve(directory));
  assert.match(target,/^virelo-live-tv-[^/\\]+$/);
  await rm(directory,{recursive:true,force:true});
}
