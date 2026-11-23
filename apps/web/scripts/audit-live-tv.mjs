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
  const tv=page.locator('main').getByRole('link',{name:'Live TV',exact:true});
  const [document]=await Promise.all([page.waitForResponse(response=>response.url()===base+'/media/iptv/'&&response.request().isNavigationRequest()),tv.click()]);
  assert.equal(document.status(),200);
  assert.match(document.headers()['content-security-policy'],/connect-src 'self' blob: https:;/);
  assert.equal(requests.length,0,'opening the screen never connects to a provider');
  await page.getByLabel('Playlist name').fill('Test channels');
  await page.getByLabel('Playlist link',{exact:true}).fill(provider+'/channels');
  await page.getByRole('button',{name:'Add playlist',exact:true}).click();
  const first=page.getByRole('button',{name:'Studio One',exact:true}),second=page.getByRole('button',{name:'Studio Two',exact:true});
  await first.waitFor();
  assert.deepEqual(requests,['/channels'],'import does not probe the channels');
  assert.deepEqual(playerModules,[],'HLS code is not fetched before choosing a channel');
  await page.getByLabel('Channel group').selectOption('Music');
  assert.ok(await first.isHidden());
  await page.getByLabel('Channel group').selectOption('');
  await first.click();
  await page.waitForFunction(()=>document.querySelector('video')?.videoWidth===160);
  assert.ok(requests.some(path=>/^\/one\/index\d+\.ts$/.test(path)));
  assert.ok(!requests.some(path=>path.startsWith('/two/')));
  await second.click();
  await page.waitForFunction(()=>document.querySelector('video[aria-label="Studio Two"]')?.videoWidth===160);
  assert.ok(requests.some(path=>path.startsWith('/two/')));
  assert.ok(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1));
  await page.reload();await first.waitFor();
  assert.equal(await page.locator('video').count(),0,'reload does not restart a stream');
  const [returnDocument]=await Promise.all([
    page.waitForResponse(response=>response.request().isNavigationRequest()&&new URL(response.url()).pathname.endsWith('/library')),
    page.getByRole('link',{name:'Library',exact:true}).click()
  ]);
  assert.match(returnDocument.headers()['content-security-policy'],/connect-src 'self' blob:;/);
  assert.deepEqual(errors,[]);
  console.log('PASS isolated Live TV CSP, M3U import, deferred HLS playback, switching, persistence and mobile layout');
} finally {
  await browser?.close();
  child?.kill();
  const target=relative(resolve(tmpdir()),resolve(directory));
  assert.match(target,/^virelo-live-tv-[^/\\]+$/);
  await rm(directory,{recursive:true,force:true});
}
