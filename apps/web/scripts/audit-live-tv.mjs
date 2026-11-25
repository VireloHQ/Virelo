import assert from 'node:assert/strict';
import { auditMiniplayerDrag } from '../../../scripts/miniplayer-audit.mjs';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtemp,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename,join,relative,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const directory=await mkdtemp(join(tmpdir(),'virelo-live-tv-'));
const repo=fileURLToPath(new URL('../',import.meta.url));
const provider='https://live-fixture.example';
const stations=122;
const collection='#EXTM3U\n#EXTINF:-1 group-title="News",Studio One\n'+provider+'/one/index.m3u8\n'
  +'#EXTINF:-1 group-title="Music",Studio Two\n'+provider+'/two/index.m3u8\n'
  +Array.from({length:stations},(_,i)=>'#EXTINF:-1 group-title="Entertainment",Field Station '+(i+1)+'\n'+provider+'/station-'+i+'/index.m3u8\n').join('');
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
  // Use the same HLS.js path in every Chromium build; native HLS can report no DVR window.
  await context.addInitScript(()=>{
    const canPlayType=HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType=function(type){return type==='application/vnd.apple.mpegurl'?'':canPlayType.call(this,type);};
  });
  const requests=[];
  const segments=(await readFile(join(directory,'index.m3u8'),'utf8')).match(/#EXTINF:[^\r\n]+\r?\n[^\r\n]+/g);
  let liveStart=0,liveEnd=10;
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
    if(pathname==='/two/index.m3u8')return route.fulfill({contentType:'application/vnd.apple.mpegurl',headers,body:
      ['#EXTM3U','#EXT-X-VERSION:3','#EXT-X-TARGETDURATION:1','#EXT-X-MEDIA-SEQUENCE:'+liveStart,...segments.slice(liveStart,liveEnd),''].join('\n')});
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
  await page.evaluate(()=>new Promise((resolve,reject)=>{
    const db=indexedDB.open('virelo-live-tv',1);
    db.onupgradeneeded=()=>{db.result.createObjectStore('sources',{keyPath:'id'});db.result.createObjectStore('channels');};
    db.onsuccess=()=>{db.result.close();resolve();};db.onerror=()=>reject(db.error);
  }));
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
  const player=page.frames().find(child=>child.url()===base+'/media/iptv/');
  assert.equal(requests.length,0,'opening the screen never connects to a provider');
  const add=frame.locator('.content-heading').getByRole('button',{name:'Add playlist',exact:true});
  const importDialog=frame.getByRole('dialog',{name:'Add playlist',exact:true});
  const form=importDialog.getByRole('form',{name:'Add playlist',exact:true});
  await frame.getByText('No playlists yet',{exact:true}).waitFor();
  assert.equal(await frame.getByRole('form',{name:'Add playlist',exact:true}).count(),0,'the empty guide has no inline form');
  await add.press('Enter');
  await form.getByLabel('Playlist name').fill('Discard this draft');
  await page.keyboard.press('Escape');
  await importDialog.waitFor({state:'hidden'});
  await player.waitForFunction(()=>document.activeElement===document.querySelector('.live-tv .content-heading button'));
  await add.click();
  assert.equal(await form.getByLabel('Playlist name').inputValue(),'');
  await form.getByLabel('Playlist name').fill('Test channels');
  await form.getByLabel('Playlist link',{exact:true}).fill(provider+'/channels');
  const progress=frame.getByRole('progressbar',{name:'Checking…',exact:true});
  const lastChecked=frame.locator('.live-tv-checked time');
  const stalled=page.waitForRequest(provider+'/station-12/index.m3u8');
  await form.getByRole('button',{name:'Add playlist',exact:true}).click();
  await importDialog.waitFor({state:'hidden'});
  const first=frame.getByRole('button',{name:'Studio One',exact:true}),second=frame.getByRole('button',{name:'Studio Two',exact:true});
  await first.waitFor();
  await frame.locator('.live-tv-channel-count').getByText(String(stations+2),{exact:true}).waitFor();
  assert.equal(await progress.getAttribute('aria-valuemax'),String(stations+2),'import starts a background check for the whole playlist');
  await stalled;
  await frame.getByRole('button',{name:'Cancel checks',exact:true}).click();
  await progress.waitFor({state:'hidden'});
  await lastChecked.waitFor();
  assert.match(await lastChecked.innerText(),/^Last checked:/);
  assert.ok(!requests.includes('/station-'+(stations-1)+'/index.m3u8'),'cancelling stops before the end of the queue');
  releaseDelayed();
  assert.deepEqual(playerModules,[],'HLS code is not fetched before choosing a channel');
  assert.equal(await frame.locator('select,input[type=file]:visible').count(),0,'no native select or file input is visible');
  const groupPicker=frame.getByRole('button',{name:'Channel group',exact:true});
  const filterIcons=frame.locator('.live-tv-filters .picker-leading-icon');
  assert.equal(await filterIcons.count(),2);
  assert.ok(await filterIcons.evaluateAll(icons=>icons.every(icon=>icon.getAttribute('aria-hidden')==='true'&&icon.querySelector('svg')?.getBoundingClientRect().width===16)));
  assert.notEqual(...await filterIcons.evaluateAll(icons=>icons.map(icon=>icon.querySelector('svg')?.innerHTML)));
  await groupPicker.focus();await groupPicker.press('Enter');
  await frame.getByRole('option',{name:'Music',exact:true}).click();
  await first.waitFor({state:'hidden'});
  assert.ok(await groupPicker.evaluate(button=>button.closest('.live-tv-filter-active')),'the current filter is visually distinct');
  await groupPicker.click();await frame.getByRole('option',{name:'All groups',exact:true}).click();
  await player.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Channel group');
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
  const checkChannels=frame.getByRole('button',{name:'Check channels',exact:true});
  const recheck=frame.getByRole('button',{name:'Recheck channels',exact:true});
  const checkBox=await checkChannels.boundingBox();
  assert.ok(checkBox&&checkBox.width===44&&checkBox.height===44,'bulk checking uses a compact touch target');
  assert.equal(await checkChannels.getAttribute('title'),'Check channels');
  await player.evaluate(()=>{
    const get=IDBObjectStore.prototype.get;
    window.channelReads=0;
    IDBObjectStore.prototype.get=function(...args){
      if(this.name==='channels')window.channelReads++;
      return get.apply(this,args);
    };
  });
  await groupPicker.click();await frame.getByRole('option',{name:'Music',exact:true}).click();
  const beforeGroup=requests.length;
  const groupRequest=page.waitForRequest(provider+'/two/index.m3u8');
  await recheck.press('Enter');
  await groupRequest;await progress.waitFor({state:'hidden'});
  assert.deepEqual(requests.slice(beforeGroup),['/two/index.m3u8'],'bulk rechecks respect the current group');
  await groupPicker.click();await frame.getByRole('option',{name:'All groups',exact:true}).click();
  await search.fill('Field Station 65');
  await frame.getByRole('button',{name:'Check Field Station 65: Not checked',exact:true}).click();
  await frame.getByRole('button',{name:/^Check Field Station 65: [1-9]\d* ms$/}).waitFor();
  await search.clear();await first.waitFor();
  await checkChannels.click();
  await recheck.waitFor({timeout:30000});
  assert.equal(await player.evaluate(()=>window.channelReads),3,'each manual run reads the playlist once, not once per channel');
  assert.equal(requests.filter(path=>path==='/one/index.m3u8').length,1,'resuming does not repeat completed checks');
  assert.equal(requests.filter(path=>path==='/two/index.m3u8').length,2);
  assert.equal(requests.filter(path=>path==='/station-64/index.m3u8').length,1);
  await frame.getByRole('button',{name:'Check Field Station 1: Unavailable',exact:true}).waitFor();
  await frame.getByRole('button',{name:'Check Field Station 2: Could not confirm',exact:true}).waitFor();
  assert.equal(await list.locator('li').count(),100,'checking does not inflate the rendered guide');
  assert.ok(requests.includes('/station-'+(stations-1)+'/index.m3u8'),'the last channel was checked before Load more');
  await frame.getByRole('button',{name:'Load more',exact:true}).click();
  await frame.getByRole('button',{name:new RegExp('^Check Field Station '+stations+': [1-9]\\d* ms$')}).waitFor();
  assert.ok(requests.every(path=>path==='/channels'||path.endsWith('.m3u8')),'checking never downloads a video segment');
  assert.deepEqual(playerModules,[],'checks do not load the HLS player');
  assert.equal(await frame.locator('video').count(),0);
  const statusPicker=frame.getByRole('button',{name:'Stream status',exact:true});
  await statusPicker.click();await frame.getByRole('option',{name:'Unavailable',exact:true}).click();
  await first.waitFor({state:'hidden'});
  await frame.getByRole('button',{name:'Field Station 1',exact:true}).waitFor();
  await statusPicker.click();await frame.getByRole('option',{name:'All statuses',exact:true}).click();
  const checksBeforePlay=requests.length;
  await first.click();
  await player.waitForFunction(()=>{const video=document.querySelector('video');return video?.videoWidth===160&&!video.paused&&video.currentTime>.05;});
  assert.ok(requests.some(path=>/^\/one\/index\d+\.ts$/.test(path)));
  assert.ok(!requests.slice(checksBeforePlay).some(path=>path.startsWith('/two/')));
  const liveTransport=frame.locator('.player-controls[data-live="true"]');
  await page.evaluate(()=>localStorage.setItem('virelo.appearance.v1',JSON.stringify({controllerStyle:'theater',accentColor:'#c3a6ff'})));
  await player.waitForFunction(()=>document.querySelector('.player-controls')?.getAttribute('data-controller-style')==='theater');
  const video=frame.locator('.live-tv-player video');
  const seek=liveTransport.getByRole('slider',{name:'Seek',exact:true});
  assert.equal(await video.evaluate(element=>element.controls),false);
  assert.equal(await liveTransport.locator('.repeat-control').count(),0);
  assert.ok(Math.abs(Number(await seek.getAttribute('max'))-12)<.25,'a finite HLS stream shows its duration');
  const pause=liveTransport.getByRole('button',{name:'Pause',exact:true});
  const play=liveTransport.getByRole('button',{name:'Play',exact:true});
  await video.hover({position:{x:12,y:20}});await pause.click();
  await player.waitForFunction(()=>document.querySelector('.live-tv-player video')?.paused===true);
  await play.waitFor();
  assert.ok(await video.evaluate(element=>element.paused));
  await seek.press('Home');await seek.press('ArrowRight');
  await player.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&Math.abs(v.currentTime-5)<.25;});
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
  assert.ok(await seek.isVisible());
  await liveTransport.getByRole('button',{name:'Fullscreen',exact:true}).click();
  await player.waitForFunction(()=>!document.fullscreenElement);
  await play.click();await pause.waitFor();
  await second.click();
  await player.waitForFunction(()=>document.querySelector('video[aria-label="Studio Two"]')?.videoWidth===160);
  assert.ok(requests.some(path=>path.startsWith('/two/')));
  await liveTransport.getByText('Live',{exact:true}).waitFor();
  await player.waitForFunction(()=>Math.abs(Number(document.querySelector('.player-seek')?.max)-10)<.3);
  await player.waitForFunction(()=>document.querySelector('.player-seek').style.getPropertyValue('--range-fill')==='100%');
  await video.hover({position:{x:12,y:20}});await pause.click();
  await seek.press('Home');
  await player.waitForFunction(()=>document.querySelector('video').currentTime<1&&
    parseFloat(document.querySelector('.player-seek').style.getPropertyValue('--range-fill'))<100);
  liveStart=3;liveEnd=12;
  await player.waitForFunction(()=>Math.abs(Number(document.querySelector('.player-seek')?.max)-9)<.3);
  await seek.press('Home');
  await player.waitForFunction(()=>{const v=document.querySelector('video');return v.currentTime>=3&&v.currentTime<4;});
  await seek.press('End');
  await player.waitForFunction(()=>{const v=document.querySelector('video');return !v.seeking&&v.currentTime>6&&v.currentTime<12;});
  await player.waitForFunction(()=>document.querySelector('.player-seek').style.getPropertyValue('--range-fill')==='100%');
  await video.evaluate(element=>{
    Object.defineProperty(element,'seekable',{configurable:true,value:{length:0}});
    element.dispatchEvent(new Event('progress'));
  });
  await player.waitForFunction(()=>document.querySelector('.player-seek')?.disabled);
  assert.ok(await seek.isVisible()&&await seek.isDisabled(),'without a seekable range the live bar remains visible but inactive');
  assert.equal(await seek.evaluate(element=>element.style.getPropertyValue('--range-fill')),'100%','a non-seekable live stream still paints a full track');
  await page.setViewportSize({width:320,height:740});
  await player.waitForFunction(()=>document.documentElement.scrollHeight<=innerHeight+1&&document.documentElement.scrollWidth<=innerWidth+1);
  assert.ok(await page.locator('body').evaluate(body=>body.scrollWidth<=innerWidth+1));
  assert.ok(await frame.locator('.live-tv-filters .picker-value').evaluateAll(labels=>labels.every(label=>label.scrollWidth<=label.clientWidth+1)),'filter icons leave the labels readable on a narrow screen');
  const remove=frame.getByRole('button',{name:'Remove playlist',exact:true});
  await remove.click();
  const dialog=frame.getByRole('alertdialog');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  const lastCheckTime=await lastChecked.getAttribute('datetime');
  const cached=await frame.getByRole('button',{name:/^Check Studio One: [1-9]\d* ms$/}).getAttribute('aria-label');
  const frameNode=await page.locator('.live-tv-frame').elementHandle(), videoNode=await video.elementHandle();
  await video.evaluate(element=>{delete element.seekable;element.currentTime=4;});
  await video.hover({position:{x:12,y:20}});await play.click();
  await player.waitForFunction(()=>{const v=document.querySelector('video');return !v.paused&&v.currentTime>4;});
  await page.goBack();
  assert.equal(new URL(page.url()).pathname,'/app/library');
  assert.ok(await page.locator('.topbar').evaluate((current,previous)=>current===previous,nav));
  const mini=frame.getByRole('group',{name:'Miniplayer',exact:true});
  await mini.waitFor();
  await player.waitForFunction(()=>{
    const video=document.querySelector('.live-tv-player video'), rect=video.getBoundingClientRect();
    return rect.height>=64&&document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2)?.closest('.miniplayer-controls');
  }).catch(async error=>{
    const layout=await video.evaluate(element=>{
      const rect=element.getBoundingClientRect(), hit=document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2);
      return {rect:rect.toJSON(),viewport:[innerWidth,innerHeight],hit:hit?.outerHTML.slice(0,180)};
    });
    throw new Error('Live miniplayer picture is not visible: '+JSON.stringify(layout),{cause:error});
  });
  assert.ok(await page.locator('.live-tv-frame').evaluate((current,previous)=>current===previous,frameNode));
  assert.ok(await video.evaluate((current,previous)=>current===previous,videoNode));
  const miniTime=await video.evaluate(element=>element.currentTime);
  await player.waitForFunction(time=>{const v=document.querySelector('video');return !v.paused&&v.currentTime>time+.15;},miniTime);
  assert.equal(await player.evaluate(()=>document.pictureInPictureElement),null);
  await auditMiniplayerDrag(page,mini,'Live TV frame');
  await mini.getByRole('button',{name:'Expand player',exact:true}).click();
  await page.waitForURL('**/app/live-tv');
  await first.waitFor();
  assert.ok(await video.evaluate((current,previous)=>current===previous,videoNode),'expanding keeps the same HLS player');
  await video.hover({position:{x:12,y:20}});
  await liveTransport.getByRole('button',{name:'Minimize player',exact:true}).click();
  await mini.press('ArrowRight');
  await mini.getByRole('button',{name:'Close miniplayer',exact:true}).click();
  await page.locator('.live-tv-frame').waitFor({state:'detached'});
  const beforeReload=requests.length;
  await tv.click();await first.waitFor();
  await page.reload();await first.waitFor();
  await frame.getByRole('button',{name:cached,exact:true}).waitFor();
  await recheck.waitFor();
  assert.equal(await lastChecked.getAttribute('datetime'),lastCheckTime,'reload keeps the last measured time');
  assert.equal(requests.length,beforeReload,'restoring saved results does not contact the provider again');
  assert.equal(await frame.locator('video').count(),0,'reload does not restart a stream');
  await page.setViewportSize({width:320,height:568});
  await search.fill('No channel has this name');
  await frame.getByText('No matches',{exact:true}).waitFor();
  for(const [label,sample] of [['Channel group','Entertainment'],['Stream status','Could not confirm']]){
    const trigger=frame.getByRole('button',{name:label,exact:true});
    const menu=frame.getByRole('listbox',{name:label,exact:true});
    await trigger.press('Enter');
    const [bounds,bar]=await Promise.all([menu.boundingBox(),frame.locator('.live-tv-filters').boundingBox()]);
    assert.ok(bounds&&bar&&Math.abs(bounds.x-bar.x)<=1&&Math.abs(bounds.width-bar.width)<=1,label+' uses the guide width');
    assert.ok(bounds.height>=44,label+' remains openable with no matching rows');
    const icons=await menu.locator('.picker-option-icon[aria-hidden="true"] svg').evaluateAll(items=>items.map(item=>item.innerHTML));
    assert.equal(icons.length,await menu.getByRole('option').count(),label+' has an icon on every option');
    if(label==='Stream status') assert.equal(new Set(icons).size,icons.length,'each stream status has its own icon');
    assert.equal(await menu.getByText(sample,{exact:true}).evaluate(element=>{
      const range=document.createRange(); range.selectNodeContents(element); return range.getClientRects().length;
    }),1,sample+' fits on one line');
    await trigger.press('Escape');
    await menu.waitFor({state:'hidden'});
  }
  await search.clear();await first.waitFor();
  const importText='#EXTM3U\n#EXTINF:-1,Extra Channel\n'+provider+'/extra/index.m3u8\n';
  for(const mode of ['File','Paste text']){
    await add.click();
    await form.getByRole('button',{name:mode,exact:true}).click();
    if(mode==='File')await form.locator('input[type=file]').setInputFiles({name:'Extra.m3u',mimeType:'audio/x-mpegurl',buffer:Buffer.from(importText)});
    else {
      await form.getByLabel('Playlist text').fill('Not a playlist');
      await form.getByRole('button',{name:'Add playlist',exact:true}).click();
      await form.getByRole('alert').waitFor();
      await form.getByLabel('Playlist text').fill(importText);
    }
    await form.getByRole('button',{name:'Add playlist',exact:true}).click();
    await importDialog.waitFor({state:'hidden'});
    await frame.getByRole('button',{name:'Extra Channel',exact:true}).waitFor();
    await frame.getByRole('button',{name:/^Check Extra Channel: [1-9]\d* ms$/}).waitFor();
    await page.setViewportSize({width:320,height:740});
    await remove.click();
    await dialog.getByRole('button',{name:'Remove playlist',exact:true}).click();
    await first.waitFor();
    await page.setViewportSize({width:320,height:568});
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
  assert.ok(await frame.locator('.live-tv-filters .picker-value').evaluateAll(labels=>labels.every(label=>label.scrollWidth<=label.clientWidth+1)),'default filter labels fit beside the desktop sidebar');
  if(process.env.VIRELO_TEST_LIVE_TV_SCREENSHOT){
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
  console.log('PASS playlist dialog (URL, file and paste), automatic 124-channel check, cache, scoped CSP, finite and live HLS seek bars, fullscreen and in-app miniplayer');
} finally {
  await browser?.close();
  child?.kill();
  const target=relative(resolve(tmpdir()),resolve(directory));
  assert.match(target,/^virelo-live-tv-[^/\\]+$/);
  await rm(directory,{recursive:true,force:true});
}
