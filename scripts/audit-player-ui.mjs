import { openPlaybackSetting } from './helpers/playback-settings.mjs';
import {createRequire} from 'node:module';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const video=await readFile(process.env.VIRELO_TEST_PLAYER_VIDEO);
const screenshots=await mkdtemp(join(tmpdir(),'virelo-player-ui-'));
const items=Array.from({length:12},(_,i)=>({id:i+1,library_id:1,path:'Video '+i+'.mp4',source_path:'Video '+i+'.mp4',filename:'Video '+i+'.mp4',title:'Video '+(i+1),sort_title:'video '+i,kind:'movie',series_title:null,season:null,episode:null,year:null,duration:15,width:854,height:480,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:video.length,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}));
const info={width:854,height:480,videoCodec:'h264',requiresTranscode:false,requiresVideoTranscode:false,defaultAudioStream:1,
 audioTracks:[{index:1,typeIndex:0,codec:'aac',language:'eng',title:'English',supported:true,channels:2},{index:2,typeIndex:1,codec:'aac',language:'jpn',title:'Japanese',supported:true,channels:2}],
 subtitleTracks:Array.from({length:20},(_,i)=>({index:i+3,typeIndex:i,codec:'srt',title:'Subtitle '+(i+1),supported:true})),
 qualityOptions:[{height:480,label:'480p',bitrate:1400000},{height:360,label:'360p',bitrate:800000}]};
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
let checks=0;const check=(value,name)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
try {
 for(const mode of ['npm','web']){
  const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  const base=mode==='npm'?(process.env.VIRELO_TEST_NPM_URL||'http://127.0.0.1:5198'):'http://127.0.0.1:5199',prefix=mode==='web'?'/app':'';
  const serve=route=>{
   const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
   if(!range)return route.fulfill({body:video,contentType:'video/mp4',headers:{'Accept-Ranges':'bytes'}});
   const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),video.length-1):video.length-1;
   return route.fulfill({status:206,body:video.subarray(start,end+1),contentType:'video/mp4',headers:{'Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${end}/${video.length}`}});
  };
  if(mode==='npm')await page.route('**/api/**',route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path.endsWith('/stream'))return serve(route);
   const json=path==='/api/media'?items.filter(item=>!url.searchParams.get('search')||item.title.includes(url.searchParams.get('search'))):path.endsWith('/playback')?info:path==='/api/settings'?{queueBehavior:'auto'}:path==='/api/libraries'?[]:path==='/api/scan/status'?{running:false}:items.find(item=>path==='/api/media/'+item.id)||{};
   return route.fulfill({json});
  });
  else {
   await page.route('**/__player-fixture/*',serve);
   await page.route(url=>url.pathname==='/src/api.ts'&&!url.search,async route=>{
    const response=await route.fetch();
    return route.fulfill({response,body:await response.text()+"\napi.mediaSource=async id=>'/__player-fixture/'+id;api.mediaFile=async()=>new File([],'fixture.mp4',{type:'video/mp4'});"});
   });
   await page.route(url=>url.pathname==='/src/browser-transcode.ts'&&!url.search,route=>route.fulfill({contentType:'text/javascript',body:
    'export async function probeBrowserPlayback(){return '+JSON.stringify(info)+';} export async function prepareBrowserAudio(){throw Error("Unexpected audio conversion");} export async function prepareBrowserQuality(){throw Error("Unexpected quality conversion");} export async function prepareBrowserSubtitle(){return "";}'}));
  }
  await page.goto(base+prefix+'/settings');await page.locator('.settings-heading').waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await page.evaluate(async items=>{const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);},items);
  await page.goto(base+prefix+'/watch/1?queue=true');
  await page.locator('.player video').waitFor();
  await page.waitForFunction(()=>document.querySelector('.player video')?.readyState>=2);
  await page.getByRole('button',{name:'Playback settings',exact:true}).waitFor();
  await page.locator('.player video').evaluate(v=>v.pause());
  const root=page.locator('.player');
  const repeatLabel=async()=>{await openPlaybackSetting(page,'Repeat');const label=await page.getByRole('menuitemradio',{checked:true}).innerText();await page.keyboard.press('Escape');await page.keyboard.press('Escape');return label;};
  const selectRepeat=async label=>{await openPlaybackSetting(page,'Repeat');await page.getByRole('menuitemradio',{name:label,exact:true}).click();};
  await selectRepeat('Repeat queue');
  check(await page.locator('.player video').evaluate(v=>!v.loop),mode+' queue mode does not loop a single video');
  await page.waitForFunction(()=>document.querySelector('.player video')?.readyState>=2);
  await root.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.player video')?.paused);
  await page.locator('.player video').evaluate(v=>{v.currentTime=Math.max(0,v.duration-.1);});
  await page.waitForTimeout(500);
  console.log('END_SNAPSHOT',mode,await page.locator('.player video').evaluate(v=>({position:v.currentTime,duration:v.duration,ended:v.ended,paused:v.paused,seeking:v.seeking,ready:v.readyState,source:v.currentSrc,error:v.error?.message})),await page.locator('.watch-copy h1').textContent());
  await page.waitForFunction(()=>document.querySelector('.watch-copy h1')?.textContent==='Video 2');
  check((await repeatLabel())==='Repeat queue',mode+' mode persists to next video');
  await page.locator('.player video').evaluate(v=>v.pause());
  const finalTitle=await page.locator('.playback-queue-item').last().locator('strong').textContent();
  const firstTitle=await page.locator('.playback-queue-item').first().locator('strong').textContent();
  await page.locator('.playback-queue-item').last().click();
  await page.waitForFunction(title=>document.querySelector('.watch-copy h1')?.textContent===title,finalTitle);
  await page.locator('.player video').evaluate(v=>v.dispatchEvent(new Event('ended')));
  await page.waitForFunction(title=>document.querySelector('.watch-copy h1')?.textContent===title,firstTitle);
  check(true,mode+' last queue item wraps to first');
  await page.locator('.player video').evaluate(v=>v.pause());await selectRepeat('Repeat video');
  check(await page.locator('.player video').evaluate(v=>v.loop),mode+' repeat-one enables native media loop');
  await page.locator('.player video').evaluate(v=>v.dispatchEvent(new Event('ended')));await page.waitForTimeout(100);
  check((await page.locator('.watch-copy h1').textContent())===firstTitle,mode+' repeat-one does not advance');
  await root.getByRole('button',{name:'Next video',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.watch-copy h1')?.textContent==='Video 2');
  check((await repeatLabel())==='Repeat video',mode+' next works while keeping repeat-one');
  await page.locator('.player video').evaluate(v=>v.pause());await selectRepeat('Repeat off');
  await page.locator('.playback-queue-item').last().click();await page.waitForFunction(title=>document.querySelector('.watch-copy h1')?.textContent===title,finalTitle);
  await page.locator('.player video').evaluate(v=>{v.pause();v.dispatchEvent(new Event('ended'));});await page.waitForTimeout(100);
  check((await page.locator('.watch-copy h1').textContent())===finalTitle,mode+' repeat off stops at last video');
  await root.getByRole('button',{name:'Playback settings',exact:true}).waitFor();
  for(const width of [1440,320,390,844]){
   await page.setViewportSize({width,height:width===844?390:1000});await page.evaluate(()=>scrollTo(0,0));await root.hover({position:{x:4,y:4}});
   const tools=root.locator('.player-tools');
   check(await tools.evaluate(e=>e.scrollWidth<=e.clientWidth+1),mode+' tools fit '+width);
   const gear=tools.getByRole('button',{name:'Playback settings',exact:true}),fs=tools.getByRole('button',{name:'Fullscreen',exact:true});
   const bounds=await fs.boundingBox(),previous=await gear.boundingBox();
   check(Math.abs(bounds.y-previous.y)<2&&bounds.x-previous.x-previous.width<=8,mode+' Settings and fullscreen grouped '+width);
   const gaps=await tools.locator('button').evaluateAll(buttons=>buttons.slice(1).every((button,i)=>{const bounds=button.getBoundingClientRect(),prior=buttons[i].getBoundingClientRect();return Math.abs(bounds.y-prior.y)<2&&bounds.left-prior.right<=8;}));
   check(gaps,mode+' all viewing controls form one cluster '+width);
   await openPlaybackSetting(page,'Subtitles');
   const list=page.locator('.playback-track-list');
   check(await list.evaluate(e=>getComputedStyle(e).scrollbarWidth==='none'&&e.scrollHeight>e.clientHeight),mode+' scrollable subtitle list without native scrollbars '+width);
   await page.screenshot({path:join(screenshots,mode+'-'+width+'.png')});
   await page.keyboard.press('End');await page.keyboard.press('Enter');
   check(await page.getByRole('menu').count()===0,mode+' last subtitle reachable '+width);
  }
  await page.setViewportSize({width:1440,height:1000});
  await root.hover({position:{x:4,y:4}});await page.locator('.player video').click({button:'right',position:{x:20,y:20}});
  const actions=page.getByRole('menu',{name:'Video actions',exact:true});
  check(await actions.isVisible(),mode+' custom video context menu');
  check(await actions.getByRole('menuitem',{name:'Settings',exact:true}).count()===1,mode+' context menu exposes consolidated Settings');
  await actions.click({button:'right',position:{x:2,y:2}});check(await actions.count()===1,mode+' menu cannot spawn native/nested menu');
  await page.keyboard.press('Escape');await actions.waitFor({state:'hidden'});check(await actions.count()===0,mode+' context Escape closes');
  await root.focus();await page.keyboard.press('Shift+F10');check(await actions.isVisible(),mode+' keyboard context menu');
  await actions.getByRole('menuitem',{name:'Settings',exact:true}).click();await openPlaybackSetting(page,'Quality');check(await page.getByRole('menu',{name:'Quality',exact:true}).isVisible(),mode+' context Settings shares playback preferences');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await root.evaluate(e=>e.requestFullscreen());await page.locator('.player video').click({button:'right',position:{x:20,y:20}});
  check(await actions.evaluate(e=>document.fullscreenElement?.contains(e)),mode+' context menu inside fullscreen');await page.keyboard.press('Escape');await page.evaluate(()=>document.exitFullscreen());
  await page.locator('.playback-queue').scrollIntoViewIfNeeded();const queue=page.locator('.playback-queue-list');
  await queue.evaluate(e=>e.scrollTo({left:0,behavior:'instant'}));await queue.hover();await page.mouse.wheel(0,400);await page.waitForTimeout(100);
  check(await queue.evaluate(e=>e.scrollLeft)>0,mode+' queue wheel scroll');
  const playingTitle=await page.locator('.watch-copy h1').textContent();await page.getByRole('button',{name:'Scroll queue right'}).click();await page.waitForTimeout(100);
  check(await page.locator('.watch-copy h1').textContent()===playingTitle,mode+' browsing queue does not change playback');
  const right=await queue.evaluate(e=>e.scrollLeft);await page.getByRole('button',{name:'Scroll queue left'}).click();await page.waitForTimeout(100);check(await queue.evaluate(e=>e.scrollLeft)<right,mode+' arrows take over wheel scroll');
  check(errors.length===0,mode+' no runtime errors '+errors.join('|'));
  await page.screenshot({path:join(screenshots,mode+'-queue.png')});
  await page.goto(base+prefix+'/watch/12?queue=true&search=Video%2012');await page.waitForFunction(()=>document.querySelector('.player video')?.readyState>=2);
  await page.locator('.player video').evaluate(v=>v.pause());await selectRepeat('Repeat queue');
  check(await page.locator('.player video').evaluate(v=>v.loop),mode+' a one-item queue can still repeat');
  await context.close();
 }
 console.log(JSON.stringify({checks,screenshots}));
}finally{await browser.close();}
