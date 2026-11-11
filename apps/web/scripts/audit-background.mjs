import { openPlaybackSetting } from './helpers/playback-settings.mjs';
import {createRequire} from 'node:module';
import {mkdtemp,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url),{chromium}=require('playwright');
const assets=await mkdtemp(join(tmpdir(),'virelo-background-audit-'));
const ffmpeg=args=>execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{windowsHide:true});
ffmpeg(['-f','lavfi','-i','color=c=0x354356:s=640x360:r=10','-t','40','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',join(assets,'silent.mp4')]);
ffmpeg(['-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','40','-c:a','aac',join(assets,'audio.m4a')]);
ffmpeg(['-i',join(assets,'silent.mp4'),'-i',join(assets,'audio.m4a'),'-c','copy','-movflags','+faststart',join(assets,'audible.mp4')]);
await mkdir(join(assets,'audio'));
ffmpeg(['-i',join(assets,'audio.m4a'),'-c:a','copy','-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',join(assets,'audio','seg-%03d.ts'),join(assets,'audio','index.m3u8')]);
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{}),args:['--autoplay-policy=no-user-gesture-required']});
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
async function serveMedia(route,body,contentType){
 const range=route.request().headers()['range']?.match(/bytes=(\d+)-(\d*)/);
 if(!range)return route.fulfill({body,contentType,headers:{'Accept-Ranges':'bytes'}});
 const start=Number(range[1]),end=Math.min(body.length-1,range[2]?Number(range[2]):body.length-1);
 return route.fulfill({status:206,body:body.subarray(start,end+1),contentType,
  headers:{'Accept-Ranges':'bytes','Content-Range':'bytes '+start+'-'+end+'/'+body.length}});
}
try {
 for(const [mode,base] of [['npm',process.env.VIRELO_TEST_NPM_URL||'http://127.0.0.1:5198'],['web',process.env.VIRELO_TEST_WEB_URL||'http://127.0.0.1:5199']]){
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/__background/**',async route=>{
  const path=new URL(route.request().url()).pathname.slice('/__background/'.length),file=resolve(assets,path);assert.ok(file.startsWith(assets+sep));
  await serveMedia(route,await readFile(file),path.endsWith('.m3u8')?'application/vnd.apple.mpegurl':path.endsWith('.ts')?'video/mp2t':path.endsWith('.m4a')?'audio/mp4':'video/mp4');
 });
 await page.route('**/api/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/stream'))return serveMedia(route,await readFile(join(assets,path.includes('/2/')?'silent.mp4':'audible.mp4')),'video/mp4');
  await route.fulfill({json:path==='/api/libraries'?[]:path==='/api/home'?{recent:[],featured:[],continueWatching:[],series:[],shorts:[]}:{running:false}});
 });
 if(mode==='web')await page.route(url=>url.pathname==='/src/browser-transcode.ts'&&!url.search,route=>route.fulfill({contentType:'text/javascript',body:
  `export {prepareBrowserQuality,prepareBrowserSubtitle} from '/src/browser-transcode.ts?background-original=1';
   export async function probeBrowserPlayback(){return {qualityOptions:[{height:360,label:'360p',bitrate:800000}],audioTracks:[{index:1,typeIndex:0,codec:'aac',title:'Original',supported:true},{index:2,typeIndex:1,codec:'aac',title:'Alternate',supported:true}],subtitleTracks:[],defaultAudioStream:1,requiresAudioTranscode:false};}
   export async function prepareBrowserAudio(){return '/__background/audio.m4a';}`}));
 await page.goto(base+(mode==='web'?'/app/settings':'/settings'));await page.locator('.splash-screen').waitFor({state:'hidden'});
 await page.evaluate(async mode=>{
  const main=await(await fetch('/src/main.tsx')).text(),imports=[...main.matchAll(/from ["']([^"']+)["']/g)].map(m=>m[1]);
  const React=(await import(imports.find(u=>u.includes('/react.js')))).default,{createRoot}=(await import(imports.find(u=>u.includes('/react-dom_client.js')))).default;
  const {api}=await import('/src/api.ts'),{Player}=await import('/src/components/Player.tsx');
  api.progress=async(id,time)=>{window.__progress.push({id,time});};
  api.playbackInfo=async()=>({qualityOptions:[{height:360,label:'360p',bitrate:800000}],audioTracks:[{index:1,typeIndex:0,codec:'aac',title:'Original',supported:true},{index:2,typeIndex:1,codec:'aac',title:'Alternate',supported:true}],subtitleTracks:[],defaultAudioStream:1,requiresTranscode:false,requiresAudioTranscode:false});
  api.startAudioTranscode=async()=>({status:'ready',url:'/__background/audio/index.m3u8'});
  api.mediaFile=async id=>new File([await(await fetch('/__background/'+(id===2?'silent.mp4':'audible.mp4'))).arrayBuffer()],'video.mp4',{type:'video/mp4'});
  api.mediaSource=async id=>'/__background/'+(id===2?'silent.mp4':'audible.mp4');
  window.__progress=[];window.__hidden=false;window.__mediaActions={};
  if(navigator.mediaSession){
    const original=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler=(action,callback)=>{window.__mediaActions[action]=callback;original(action,callback);};
  }
  Object.defineProperty(document,'visibilityState',{configurable:true,get:()=>window.__hidden?'hidden':'visible'});
  Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});
  window.__appRoot=document.getElementById('root');
  document.body.replaceChildren();const node=document.createElement('div');document.body.append(node);const root=createRoot(node);window.__demoRoot=root;
  window.__mount=id=>root.render(React.createElement(Player,{item:{id,title:'Background test',duration:40,width:640,height:360,progress_position:0},autoPlay:true}));
 },mode);
 const mount=id=>page.evaluate(id=>window.__mount(id),id);
 const hide=()=>page.evaluate(()=>{window.__hidden=true;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('blur'));});
 const show=()=>page.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
 const snapshot=()=>page.locator('.player').evaluate(e=>{const v=e.querySelector('video'),a=e.querySelector('audio');return {videoPaused:v.paused,videoTime:v.currentTime,audioPaused:a.paused,audioTime:a.currentTime,videoSource:v.currentSrc,audioSource:a.currentSrc};});
 await mount(2);await page.waitForFunction(()=>document.querySelector('.player video')?.currentTime>.2);
 await page.getByRole('button',{name:'Volume',exact:true}).click();
 await page.getByRole('slider',{name:'Volume',exact:true}).fill('0.25');
 await page.keyboard.press('Escape');
 await openPlaybackSetting(page, 'Audio');await page.getByRole('menuitemradio',{name:/^Alternate/}).click();
 await page.waitForFunction(()=>{const v=document.querySelector('.player video'),a=document.querySelector('.player audio');return v&&!v.paused&&a&&!a.paused&&a.currentTime>.3&&Math.abs(v.currentTime-a.currentTime)<.5;});
 check(await page.locator('.player').evaluate(e=>e.querySelector('video').volume===.25&&e.querySelector('audio').volume===.25),mode+' saved volume applies to separate converted soundtrack');
 await hide();await page.locator('.player video').evaluate(v=>v.pause());await page.waitForTimeout(700);
 const hidden=await snapshot();console.log('BACKGROUND_PAUSE',mode,JSON.stringify(hidden));
 if(process.env.VIRELO_BACKGROUND_REPRO_ONLY){await context.close();continue;}
 check(!hidden.audioPaused,mode+' separate soundtrack continues after browser background video pause');
 await page.waitForTimeout(700);const later=await snapshot();
 check(later.audioTime>hidden.audioTime+.25,mode+' background audio clock advances');
 const audioClock=later.audioTime;
 console.log('SEEKABLE',mode,await page.locator('.player video').evaluate(v=>({duration:v.duration,ranges:Array.from({length:v.seekable.length},(_,i)=>[v.seekable.start(i),v.seekable.end(i)])})));
 await show();
 await page.waitForFunction(()=>{const v=document.querySelector('.player video'),a=document.querySelector('.player audio');return !v.paused&&!a.paused&&Math.abs(v.currentTime-a.currentTime)<.4;});
 console.log('FOREGROUND',mode,JSON.stringify({audioClock,after:await snapshot()}));
 check((await snapshot()).videoTime>=audioClock-.3,mode+' returning to tab catches video up to audio, not vice versa');
 const after=await snapshot();check(after.videoSource===hidden.videoSource&&after.audioSource===hidden.audioSource,mode+' tab return does not reload media');
 await hide();await page.locator('.player video').evaluate(v=>v.pause());await page.waitForTimeout(100);
 await page.getByRole('button',{name:'Pause',exact:true}).click();
 check((await snapshot()).audioPaused,mode+' explicit Pause in background stops soundtrack');
 await show();await page.waitForTimeout(300);check((await snapshot()).videoPaused&& (await snapshot()).audioPaused,mode+' explicit background pause is not undone on return');
 await page.getByRole('button',{name:'Play',exact:true}).click();
 await page.waitForFunction(()=>!document.querySelector('.player video').paused);
 await hide();await page.locator('.player video').evaluate(v=>v.pause());
 await page.evaluate(()=>window.__mediaActions.pause());await show();await page.waitForTimeout(250);
 check((await snapshot()).videoPaused&&(await snapshot()).audioPaused,mode+' media-key Pause is honored in background');
 await mount(1);await page.waitForFunction(()=>document.querySelector('.player video')?.currentTime>.2&&!document.querySelector('.player video').paused);
 await hide();const nativeBefore=(await snapshot()).videoTime;await page.waitForTimeout(400);
 check(!(await snapshot()).videoPaused&&(await snapshot()).videoTime>nativeBefore,mode+' visibility alone does not pause direct playback');
 await show();await page.getByRole('button',{name:'Pause',exact:true}).click();await hide();await show();await page.waitForTimeout(250);
 check((await snapshot()).videoPaused,mode+' user-paused direct video remains paused');
 await page.getByRole('button',{name:'Play',exact:true}).click();await hide();await page.locator('.player video').evaluate(v=>v.pause());await show();
 await page.waitForFunction(()=>!document.querySelector('.player video').paused);
 check(true,mode+' browser-imposed native pause recovers on foreground');
 await page.getByRole('button',{name:'Volume',exact:true}).click();
 await page.getByRole('button',{name:'Mute',exact:true}).click();
 await page.keyboard.press('Escape');
 await page.evaluate(async mode=>{
   window.__demoRoot.unmount();document.body.replaceChildren(window.__appRoot);
   const {api}=await import('/src/api.ts');
   api.shorts=async()=>({items:[1,2,3].map(id=>({id,title:'Short '+id,filename:'short.mp4',duration:40,width:360,height:640,progress_position:0,progress_completed:0,liked:0})),total:3});
   const {router}=await import('/src/router.tsx');
   await router.navigate({to:mode==='npm'?'/shorts':'/app/shorts'});
 },mode);
 const short=page.locator('.short-video[tabindex="0"]');
 await short.waitFor();await page.waitForFunction(()=>{const v=document.querySelector('.short-video[tabindex="0"]');return v&&!v.paused&&v.currentTime>.2;});
 check(await short.evaluate(v=>v.volume===.25&&v.muted),mode+' Shorts inherits player volume and mute');
 await hide();await short.evaluate(v=>v.pause());await show();
 await page.waitForFunction(()=>!document.querySelector('.short-video[tabindex="0"]').paused);
 check(true,mode+' active Short recovers from browser background pause');
 await short.click();await hide();await show();await page.waitForTimeout(250);
 check(await short.evaluate(v=>v.paused),mode+' manually paused Short stays paused across tabs');
 await short.click();await hide();await short.evaluate(v=>v.pause());
 await page.locator('.shorts-scroller').evaluate(e=>{e.scrollTop=e.clientHeight;e.dispatchEvent(new Event('scroll'));});
 await show();await page.waitForFunction(()=>{const v=document.querySelector('.short-video[tabindex="0"]');return v&&!v.paused;});
 check(await page.locator('.short-video').first().evaluate(v=>v.paused),mode+' old Short does not resume after selection changes');
 check(await short.evaluate(v=>v.volume===.25&&v.muted),mode+' next Short retains volume and mute');
 check(errors.length===0,mode+' no runtime errors '+errors.join('|'));
 await context.close();
 }
 console.log(JSON.stringify({checks,assets,result:process.env.VIRELO_BACKGROUND_REPRO_ONLY?'reproduced':'passed'}));
}finally{await browser.close();}
