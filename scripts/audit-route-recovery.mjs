// Fault injection against production builds; no access to the user's real library.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const packageName = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).name;
const npmBuild = process.env.VIRELO_NPM_BUILD || fileURLToPath(new URL(packageName === 'virelo' ? '../dist/web/' : '../../virelo/dist/web/',import.meta.url));
const webBuild = process.env.VIRELO_WEB_BUILD || fileURLToPath(new URL(packageName === 'virelo-web' ? '../dist/' : '../../virelo-web/dist/',import.meta.url));
const { chromium } = require('playwright');
const folder = await mkdtemp(join(tmpdir(), 'virelo-route-recovery-'));
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=320x180:r=15:d=40','-f','lavfi','-i','sine=frequency=440:duration=40','-c:v','libx264','-preset','ultrafast','-c:a','aac','-pix_fmt','yuv420p','-movflags','+faststart','-shortest',join(folder,'clip.mp4')]);
const clip = await readFile(join(folder, 'clip.mp4'));
const item = {id:1,library_id:1,path:'clip.mp4',source_path:'clip.mp4',filename:'clip.mp4',title:'Recovery audit video',sort_title:'recovery audit video',kind:'movie',series_title:null,season:null,episode:null,year:2026,duration:40,width:320,height:180,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:clip.length,mtime:100,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,added_at:100,updated_at:100};
const settings = {queueBehavior:'auto',shortsIncludeLandscapes:false,tmdbApiKeyConfigured:false};
const browser = await chromium.launch({headless:true,args:['--autoplay-policy=no-user-gesture-required'],...(process.env.VIRELO_TEST_CHROMIUM ? {executablePath:process.env.VIRELO_TEST_CHROMIUM} : {})});
const servers = [];
const unavailableAssets = new Set();
let checks = 0;
const check = (value, name) => { assert.ok(value, name); checks++; console.log('PASS', name); };
async function serve(root) {
  const server = createServer(async (request,response) => {
    const url = new URL(request.url,'http://127.0.0.1');
    response.setHeader('Cache-Control','no-cache');
    if (unavailableAssets.has(url.pathname)) { response.writeHead(404,{'Content-Type':'text/html'}); response.end('<html>Asset removed after deployment</html>'); return; }
    if (url.pathname === '/__audit/clip.mp4' || url.pathname === '/api/media/1/stream') { response.setHeader('Content-Type','video/mp4'); response.end(clip); return; }
    if (url.pathname.startsWith('/api/')) {
      let value = {};
      if (url.pathname === '/api/settings') value = settings;
      else if (url.pathname === '/api/home') value = {recent:[item],featured:[item],continueWatching:[],liked:[],favorites:[],series:[],shorts:[],movies:[item],nextEpisodes:[],unwatched:[],shortMovies:[],quickWatches:[],genres:[],total:1};
      else if (url.pathname === '/api/media/1') value = item;
      else if (url.pathname === '/api/media') value = [item];
      else if (url.pathname === '/api/libraries') value = [{id:1,path:'audit',label:'Audit',created_at:100}];
      else if (url.pathname === '/api/folders') value = [{library_id:1,folder:'',count:1}];
      else if (url.pathname === '/api/media/1/playback') value = {videoCodec:'h264',width:320,height:180,qualityOptions:[{height:180,label:'180p',bitrate:500000}],audioTracks:[{index:1,typeIndex:0,codec:'aac',language:'eng',channels:1,default:true,supported:true}],subtitleTracks:[],defaultAudioStream:1,requiresTranscode:false,requiresVideoTranscode:false,requiresAudioTranscode:false};
      else if (url.pathname.includes('/artwork/')) { response.writeHead(404); response.end(); return; }
      response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(value)); return;
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(resolve(root) + '/'.replace('/', process.platform === 'win32' ? '\\' : '/')) && path !== resolve(root)) { response.writeHead(403); response.end(); return; }
    let data, extension = extname(path);
    try { data = await readFile(path); }
    catch { if (url.pathname.startsWith('/assets/')) { response.writeHead(404); response.end(); return; } data = await readFile(join(root,'index.html')); extension = '.html'; }
    response.setHeader('Content-Type', {'.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/plain','.png':'image/png','.svg':'image/svg+xml','.ico':'image/x-icon','.woff2':'font/woff2','.webmanifest':'application/manifest+json'}[extension] || 'application/octet-stream');
    response.end(data);
  });
  await new Promise(done => server.listen(0,'127.0.0.1',done));
  servers.push(server);
  return 'http://127.0.0.1:' + server.address().port;
}
async function newPage(mode, base, serviceWorkers = 'block') {
  const context = await browser.newContext({serviceWorkers,viewport:{width:1280,height:900}});
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.addInitScript(() => { window.__documentId = Math.random(); });
  if (mode === 'web') {
    await page.goto(base + '/app/settings');
    await page.locator('.settings-heading').waitFor();
    await page.evaluate(async ({item,settings}) => {
      const root = await navigator.storage.getDirectory();
      const handle = await root.getFileHandle('clip.mp4',{create:true});
      const writable = await handle.createWritable();
      await writable.write(await (await fetch('/__audit/clip.mp4')).blob()); await writable.close();
      const db = await new Promise((resolve,reject) => { const request = indexedDB.open('virelo-web',1); request.onsuccess=()=>resolve(request.result); request.onerror=()=>reject(request.error); });
      await new Promise((resolve,reject) => {
        const tx = db.transaction(['libraries','media','settings'],'readwrite');
        tx.objectStore('libraries').put({id:1,label:'Audit',path:'audit',created_at:100,persistent:true,handle:root});
        tx.objectStore('media').put(item);
        tx.objectStore('settings').put(settings,'current');
        tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
      });
      db.close();
    }, {item,settings});
  }
  await page.goto(base + (mode === 'web' ? '/app' : '') + '/watch/1');
  await page.locator('.player video').waitFor();
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.waitForFunction(() => { const video = document.querySelector('.player video'); return video && !video.paused && video.currentTime > 0.5; });
  await page.evaluate(() => { window.__playingVideo = document.querySelector('.player video'); window.__pauseCount=0; window.__playingVideo.addEventListener('pause',()=>window.__pauseCount++); window.__playingVideo.volume = 0.37; });
  return {context,page};
}
const clickLibrary = page => page.getByRole('link',{name:'Library',exact:true}).first().evaluate(link => link.click());
async function continuity(page, before, label) {
  const actual = await page.evaluate(() => ({same:window.__playingVideo === document.querySelector('.player video'),playing:!window.__playingVideo.paused,time:window.__playingVideo.currentTime,volume:window.__playingVideo.volume,doc:window.__documentId,pauseCount:window.__pauseCount}));
  check(actual.same && actual.playing && actual.time > before.time, label + ' same video element keeps advancing');
  check(actual.doc === before.doc && actual.pauseCount === 0, label + ' no document reload or pause');
  check(Math.abs(actual.volume - 0.37) < 0.001, label + ' volume retained');
}
try {
  for (const [mode,root] of [['npm',npmBuild],['web',webBuild]]) {
    const base = await serve(root), prefix = mode === 'web' ? '/app' : '';
    const legalContext = await browser.newContext({serviceWorkers:'block'});
    const legalPage = await legalContext.newPage();
    await legalPage.goto(base + prefix + '/settings');
    await legalPage.locator('.settings-legal').waitFor();
    check(await legalPage.getByRole('link',{name:'Source code',exact:true}).getAttribute('href') === 'https://github.com/VireloHQ/' + (mode === 'web' ? 'Virelo-Web' : 'Virelo'), mode + ' source offer points to this project');
    check(await legalPage.getByRole('link',{name:'AGPL-3.0-only',exact:true}).getAttribute('href') === '/LICENSE.txt', mode + ' full local license is accessible from Settings');
    const licenseResponse = await legalPage.request.get(base + '/LICENSE.txt');
    check(licenseResponse.status() === 200 && (await licenseResponse.text()).includes('13. Remote Network Interaction'), mode + ' built web distribution includes the full AGPL');
    for (const width of [1440,390]) {
      await legalPage.setViewportSize({width,height:900});
      await legalPage.getByRole('link',{name:'Source code',exact:true}).focus();
      check(await legalPage.locator('.settings-legal').isVisible() && await legalPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), mode + ' legal links fit and remain usable at ' + width);
    }
    await legalContext.close();
    const permanent = await newPage(mode,base);
    const page = permanent.page;
    let blocked = true, requests = [];
    await page.route(/\/assets\/LibraryView-[^/?]+\.js/, async route => { requests.push(route.request().url()); if (blocked) await route.fulfill({status:404,body:'Missing old deployment chunk',contentType:'text/plain'}); else await route.continue(); });
    const before = await page.evaluate(() => ({time:window.__playingVideo.currentTime,doc:window.__documentId,url:location.href}));
    await clickLibrary(page);
    await page.locator('.route-recovery-notice').waitFor();
    check(page.url() === before.url, mode + ' failed navigation leaves the URL and current screen unchanged');
    check(requests.length === 3 && requests.some(url => url.includes('virelo-retry=')), mode + ' bounded cache-busting retries');
    await continuity(page,before,mode + ' persistent chunk failure');
    check(!(await page.locator('body').innerText()).includes('Something went wrong!'), mode + ' no default debug error page');
    await page.locator('.route-recovery-notice').getByRole('button',{name:'Dismiss message'}).click();
    await page.waitForTimeout(350);
    await continuity(page,before,mode + ' dismissed message');
    await clickLibrary(page); await page.locator('.route-recovery-notice').waitFor();
    check(requests.length >= 5 && requests.length <= 6, mode + ' repeated failed navigation is bounded (browser may remember the original failure)');
    blocked = false;
    const secondDoc = await page.evaluate(() => window.__documentId);
    await page.locator('.route-recovery-notice').getByRole('button',{name:'Try again',exact:true}).click();
    await page.waitForURL(base + prefix + '/library');
    await page.locator('.media-card').first().waitFor();
    check(await page.evaluate(() => window.__documentId) === secondDoc, mode + ' manual retry recovers without full reload');
    check(await page.locator('.route-recovery-notice').count() === 0, mode + ' recovery message clears after successful navigation');
    await permanent.context.close();

    const transient = await newPage(mode,base), transientPage = transient.page;
    let attempts = 0;
    await transientPage.route(/\/assets\/LibraryView-[^/?]+\.js/, async route => {
      attempts++;
      if (attempts === 1) await route.abort('failed');
      else { await new Promise(resolve => setTimeout(resolve,1000)); await route.continue(); }
    });
    const transientBefore = await transientPage.evaluate(() => ({time:window.__playingVideo.currentTime,doc:window.__documentId}));
    await clickLibrary(transientPage);
    await transientPage.waitForTimeout(600);
    await continuity(transientPage,transientBefore,mode + ' temporary chunk failure');
    await transientPage.waitForURL(base + prefix + '/library');
    check(attempts === 2 && await transientPage.locator('.route-error-view,.route-recovery-notice').count() === 0, mode + ' one-off failure automatically recovers silently');
    await transient.context.close();

    const stylesheet = await newPage(mode,base), stylesheetPage = stylesheet.page;
    let cssAttempts = 0;
    await stylesheetPage.route(/\/assets\/HomeView-[^/?]+\.css/, async route => {
      cssAttempts++;
      if (cssAttempts === 1) await route.abort('failed');
      else { await new Promise(resolve => setTimeout(resolve,1000)); await route.continue(); }
    });
    const cssBefore = await stylesheetPage.evaluate(() => ({time:window.__playingVideo.currentTime,doc:window.__documentId}));
    await stylesheetPage.getByRole('link',{name:'Home',exact:true}).first().evaluate(link => link.click());
    await stylesheetPage.waitForTimeout(600);
    await continuity(stylesheetPage,cssBefore,mode + ' temporary stylesheet failure');
    await stylesheetPage.waitForURL(url => url.pathname === (prefix || '/'));
    await stylesheetPage.locator('.home-view').waitFor();
    check(cssAttempts === 2 && await stylesheetPage.evaluate(() => [...document.styleSheets].some(sheet => {
      try { return sheet.href?.includes('/HomeView-') && sheet.cssRules.length > 0; } catch { return false; }
    })), mode + ' stylesheet retry restores real styles before navigation');
    await stylesheet.context.close();

    const initialContext = await browser.newContext({serviceWorkers:'block'});
    const initialPage = await initialContext.newPage();
    let initialBlocked = true;
    await initialPage.addInitScript(() => { window.__documentId = Math.random(); });
    await initialPage.route(/\/assets\/LibraryView-[^/?]+\.js/, async route => { if (initialBlocked) await route.abort('failed'); else await route.continue(); });
    await initialPage.goto(base + prefix + '/library');
    await initialPage.locator('.loading-library').waitFor();
    check(true, mode + ' first entry keeps its page-specific loading skeleton');
    await initialPage.locator('.route-error-view').waitFor();
    check(await initialPage.getByRole('link',{name:'Library',exact:true}).count() > 0, mode + ' direct-open failure keeps app navigation available');
    const initialDocument = await initialPage.evaluate(() => window.__documentId);
    initialBlocked = false;
    await initialPage.locator('.route-error-view').getByRole('button',{name:'Try again',exact:true}).click();
    await initialPage.locator('.route-error-view').waitFor({state:'hidden'});
    check(await initialPage.evaluate(() => window.__documentId) === initialDocument, mode + ' initial route failure can retry without reload');
    await initialContext.close();

    const cached = await newPage(mode,base,'allow'), cachedPage = cached.page;
    await cachedPage.waitForFunction(() => !!navigator.serviceWorker.controller);
    const cachedPath = '/assets/' + (await readdir(join(root,'assets'))).find(name => /^LibraryView-.*\.js$/.test(name));
    const expectedScript = await cachedPage.evaluate(async path => (await fetch(path)).text(), cachedPath);
    await cachedPage.waitForFunction(async path => (await Promise.all((await caches.keys()).map(async name => !!await (await caches.open(name)).match(path)))).some(Boolean), cachedPath);
    unavailableAssets.add(cachedPath);
    const oldScript = await cachedPage.evaluate(async path => { const response = await fetch(path + '?virelo-retry=777'); return {status:response.status,mime:response.headers.get('Content-Type'),text:await response.text()}; }, cachedPath);
    check(oldScript.status === 200 && /javascript/.test(oldScript.mime) && oldScript.text === expectedScript, mode + ' actual service worker recovers the exact old hashed script after deployment');
    await clickLibrary(cachedPage); await cachedPage.waitForURL(base + prefix + '/library');
    check(await cachedPage.locator('.route-recovery-notice,.route-error-view').count() === 0, mode + ' cached deployment fallback allows normal navigation');
    const keys = await cachedPage.evaluate(async () => (await Promise.all((await caches.keys()).map(async name => (await (await caches.open(name)).keys()).map(request => new URL(request.url).pathname)))).flat());
    check(keys.every(path => !/^\/(?:api|audio|hls|playback)(?:\/|$)/.test(path) && !path.endsWith('.mp4')), mode + ' actual worker never caches video, audio or API responses');
    unavailableAssets.delete(cachedPath);
    await cached.context.close();
  }
  console.log('Route recovery audit passed: ' + checks + ' checks.');
} finally {
  await browser.close();
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  assert.ok(folder.startsWith(join(tmpdir(),'virelo-route-recovery-')));
  await rm(folder,{recursive:true,force:true});
}
