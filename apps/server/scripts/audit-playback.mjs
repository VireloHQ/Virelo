import { openPlaybackSetting } from './helpers/playback-settings.mjs';
import { createRequire } from 'node:module';
import { mkdir, stat, mkdtemp, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { createVireloServer } from '../dist/server.js';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const {chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-playback-audit-'));
const media=root+'/media';
await mkdir(media,{recursive:true});
process.env.VIRELO_LOG_LEVEL='silent';
for(const [name,codec] of [['direct.mp4','aac'],['compatible.mkv','ac3']]){
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=854x480:rate=30','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','90','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','60','-c:a',codec,...(name.endsWith('.mp4')?['-movflags','+faststart']:[]),media+'/'+name],{windowsHide:true});
}
const dataDir=await mkdtemp(root+'/data-');
await copyFile(media+'/direct.mp4',media+'/direct-next.mp4');
const {app,db}=await createVireloServer({dataDir,mediaPaths:[],host:'0.0.0.0',port:0});
db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
const library=db.addLibrary(media,'Test');
const ids=[];
for(const [name,codec] of [['direct.mp4','aac'],['compatible.mkv','ac3'],['direct-next.mp4','aac']]){
  const path=media+'/'+name;const file=await stat(path);
  ids.push(db.upsertMedia({library_id:library.id,path,filename:name,title:name,sort_title:name,kind:'movie',series_title:null,season:null,episode:null,year:null,duration:90,width:854,height:480,video_codec:'h264',audio_codec:codec,container:name.split('.').at(-1),folder:'',size:file.size,mtime:file.mtimeMs,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id);
}
await app.listen({host:'0.0.0.0',port:0});
const port=app.server.address().port;
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM ? {executablePath:process.env.VIRELO_TEST_CHROMIUM} : {}),args:['--autoplay-policy=no-user-gesture-required','--no-proxy-server']});
const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
const page=await context.newPage();
await page.addInitScript(()=>{
  window.__events=[];
  for(const type of ['loadstart','loadedmetadata','canplay','seeking','seeked','playing','error'])document.addEventListener(type,e=>{
    const v=e.target;if(v.tagName==='VIDEO')window.__events.push({event:type,time:v.currentTime,ready:v.readyState,seeking:v.seeking,src:v.currentSrc});
  },true);
});
const errors=[];
page.on('pageerror',e=>errors.push(e.message));
let qualityStarts=0;
page.on('request',req=>{if(req.url().includes('/quality/start'))qualityStarts++;});
const snapshot=()=>page.locator('.player video').evaluate(v=>({time:v.currentTime,duration:v.duration,paused:v.paused,ready:v.readyState,seeking:v.seeking,audioDecoded:v.webkitAudioDecodedByteCount,src:v.currentSrc,error:v.error?.message}));
try{
  const began=Date.now();
  await page.goto(`http://127.0.0.2:${port}/watch/${ids[0]}?queue=false`);
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>0.3;},{},{timeout:15000});
  await openPlaybackSetting(page, 'Quality');
  assert.equal(await page.getByRole('menuitemradio',{name:/^Auto/}).getAttribute('aria-checked'),'true');
  assert.equal(qualityStarts,0);
  assert.equal(await page.locator('.player-status').count(),0);
  console.log('REMOTE_DIRECT',JSON.stringify({firstPlaybackMs:Date.now()-began,qualityStarts,video:await snapshot()}));
  await openPlaybackSetting(page, 'Quality');
  await page.locator('.player video').evaluate(v=>{Object.defineProperty(v,'readyState',{get:()=>2,configurable:true});v.dispatchEvent(new Event('waiting'));});
  await page.waitForFunction(()=>document.querySelector('.player-status')?.textContent?.includes('Buffering'),{},{timeout:10000});
  await page.locator('.player video').evaluate(v=>{delete v.readyState;v.dispatchEvent(new Event('playing'));});
  assert.equal(await page.locator('.player-status').count(),0);
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v?.currentSrc.startsWith('blob:')&&!v.paused&&v.currentTime>3;},{},{timeout:30000});
  const adaptive=await snapshot();assert.ok(adaptive.time>3&&adaptive.time<25);assert.ok(adaptive.audioDecoded>0);
  console.log('ADAPTIVE_HANDOFF',JSON.stringify({qualityStarts,video:adaptive,overlay:await page.locator('.player-status').count()}));
  await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menuitemradio',{name:/^360p/}).click();
  await page.waitForTimeout(2000);
  assert.ok((await snapshot()).time>=adaptive.time);
  console.log('MANUAL_LEVEL',JSON.stringify(await snapshot()));
  await page.locator('.player video').evaluate(v=>v.pause());
  await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menuitemradio',{name:/^480p/}).click();
  await page.waitForTimeout(500);
  assert.equal((await snapshot()).paused,true);
  console.log('QUALITY_CHANGE_PRESERVES_PAUSE');
  await page.evaluate(()=>localStorage.setItem('virelo-playback-quality:v1','auto'));
  const previousStarts=qualityStarts;
  await page.goto(`http://127.0.0.2:${port}/watch/${ids[2]}?queue=false`);
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>0.3;},{},{timeout:15000});
  assert.equal(qualityStarts,previousStarts);
  console.log('NEXT_DIRECT_NO_PREPARATION',JSON.stringify(await snapshot()));
  await page.route(`**/hls/${ids[2]}/**`,route=>route.fulfill({status:404,body:'missing playlist'}));
  // Isolate the handoff failure from the encoder racing a moving playback position.
  await page.route(`**/api/media/${ids[2]}/quality/start*`,route=>route.fulfill({json:{
    status:'ready',complete:true,bufferedUntil:90,playlist:`/hls/${ids[2]}/audit-missing/master.m3u8`,
    variants:[{height:480,label:'480p',bitrate:1400000,url:`/hls/${ids[2]}/audit-missing/480/index.m3u8`}]
  }}));
  await page.locator('.player video').evaluate(v=>{Object.defineProperty(v,'readyState',{get:()=>2,configurable:true});v.dispatchEvent(new Event('waiting'));});
  await page.waitForFunction(()=>document.querySelector('.player-status')?.textContent?.includes('Buffering'),{},{timeout:10000});
  await page.locator('.player video').evaluate(v=>{delete v.readyState;v.dispatchEvent(new Event('playing'));});
  await page.waitForFunction(()=>window.__events.filter(event=>event.event==='loadedmetadata'&&event.src.includes('/stream')).length>=2,{},{timeout:30000});
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v?.currentSrc.includes('/stream')&&!v.paused&&v.readyState>=3;},{},{timeout:30000});
  assert.equal(await page.locator('.player-status').count(),0);
  console.log('FAILED_HANDOFF_RECOVERS_DIRECT',JSON.stringify(await snapshot()));
  const audioBegan=Date.now();
  await page.goto(`http://127.0.0.1:${port}/watch/${ids[1]}?queue=false`);
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v?.currentSrc.startsWith('blob:')&&!v.paused&&v.currentTime>0.3&&v.webkitAudioDecodedByteCount>0;},{},{timeout:30000});
  assert.equal(await page.locator('.player-status').count(),0);
  console.log('FIRST_COMPATIBLE_PLAY',JSON.stringify({firstPlaybackMs:Date.now()-audioBegan,video:await snapshot(),errors}));
  await openPlaybackSetting(page, 'Quality');
  assert.equal(await page.getByRole('menuitemradio',{name:/^Auto/}).count(),0);
  assert.deepEqual(errors,[]);
}catch(e){console.error('FAILED',e,{qualityStarts,dataDir},await snapshot().catch(()=>null));console.error(JSON.stringify(await page.evaluate(()=>window.__events)));console.error(await page.locator('body').innerText());process.exitCode=1;}
finally{await browser.close();await app.close();}
