import {createRequire} from 'node:module';
import {mkdtemp,mkdir,stat,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {createVireloServer} from '../dist/server.js';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-seek-audit-')),media=process.env.VIRELO_SEEK_ASSETS||join(root,'media'),dataDir=join(root,'data');
await mkdir(media,{recursive:true});
process.env.VIRELO_LOG_LEVEL='silent';
const ffmpeg=process.env.FFMPEG_PATH||'ffmpeg';
if(!process.env.VIRELO_SEEK_ASSETS){
  execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=854x480:rate=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','120','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','24','-c:a','ac3',join(media,'compatible.mkv')],{windowsHide:true});
  execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-i',join(media,'compatible.mkv'),'-c:v','copy','-c:a','aac','-movflags','+faststart',join(media,'direct.mp4')],{windowsHide:true});
}
const {app,db}=await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
const library=db.addLibrary(media,'Synthetic seek audit');
const ids=[];
for(const [name,codec] of [['compatible.mkv','ac3'],['direct.mp4','aac']]){
  const path=join(media,name),file=await stat(path);
  ids.push(db.upsertMedia({library_id:library.id,path,filename:name,title:name,sort_title:name,kind:'movie',series_title:null,season:null,episode:null,year:null,duration:120,width:854,height:480,video_codec:'h264',audio_codec:codec,container:name.split('.').at(-1),folder:'',size:file.size,mtime:file.mtimeMs,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id);
}
const dualPath=join(root,'dual.mp4');
execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-i',join(media,'direct.mp4'),'-i',join(media,'compatible.mkv'),'-map','0:v:0','-map','0:a:0','-map','1:a:0','-c','copy','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=jpn','-disposition:a:0','default','-disposition:a:1','0',dualPath],{windowsHide:true});
const dualFile=await stat(dualPath),dualLibrary=db.addLibrary(root,'Synthetic audio audit');
const dualId=db.upsertMedia({library_id:dualLibrary.id,path:dualPath,filename:'dual.mp4',title:'Synthetic dual audio',sort_title:'Synthetic dual audio',kind:'movie',series_title:null,season:null,episode:null,year:null,duration:120,width:854,height:480,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:dualFile.size,mtime:dualFile.mtimeMs,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id;
let longId;
if(process.env.VIRELO_SEEK_LONG==='1'){
  const longMedia=join(root,'long-media');await mkdir(longMedia);
  const seed=join(longMedia,'seed.mkv'),path=join(longMedia,'long-compatible.mkv');
  execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=navy:size=854x480:rate=2','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','4','-c:a','ac3','-b:a','32k','-ac','1',seed],{windowsHide:true});
  execFileSync(ffmpeg,['-y','-hide_banner','-loglevel','error','-stream_loop','-1','-i',seed,'-t','7041','-c','copy',path],{windowsHide:true});
  const file=await stat(path),longLibrary=db.addLibrary(longMedia,'Synthetic feature-length seek audit');
  longId=db.upsertMedia({library_id:longLibrary.id,path,filename:'long-compatible.mkv',title:'Synthetic feature-length clip',sort_title:'Synthetic feature-length clip',kind:'movie',series_title:null,season:null,episode:null,year:null,duration:7041,width:854,height:480,video_codec:'h264',audio_codec:'ac3',container:'mkv',folder:'',size:file.size,mtime:file.mtimeMs,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id;
}
await app.listen({host:'127.0.0.1',port:0});
const base='http://127.0.0.1:'+app.server.address().port;
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
const cacheFiles=async(dir=join(dataDir,'cache'))=>{const files=[];for(const entry of await readdir(dir,{withFileTypes:true}).catch(()=>[])){const path=join(dir,entry.name);if(entry.isDirectory())files.push(...await cacheFiles(path));else files.push(path);}return files;};
try{
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[],requests=[],segments=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/start')&&request.method()==='POST')requests.push({url:request.url(),body:request.postDataJSON()});if(request.url().includes('/playback/')&&request.url().endsWith('.ts'))segments.push(request.url());});
  const seek=async position=>page.locator('.player-seek').evaluate((input,value)=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,String(value));
    input.dispatchEvent(new Event('input',{bubbles:true}));
  },position);
  const snapshot=()=>page.locator('.player video').evaluate(video=>({time:video.currentTime,duration:video.duration,paused:video.paused,ready:video.readyState,audio:video.webkitAudioDecodedByteCount,seekable:[...Array(video.seekable.length)].map((_,i)=>[video.seekable.start(i),video.seekable.end(i)])}));
  const arrived=position=>page.waitForFunction(value=>{const v=document.querySelector('.player video');return v&&Math.abs(v.currentTime-value)<1.5&&v.readyState>=3;},position,{timeout:30000});
  const clickControl=async name=>{await page.locator('.player').hover({position:{x:100,y:100}});await page.getByRole('button',{name,exact:true}).click();};

  await page.goto(base+'/watch/'+ids[0]+'?queue=false');
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.3;},{},{timeout:30000});
  console.log('DEMAND_BEFORE',JSON.stringify(await snapshot()));
  await page.waitForFunction(()=>document.querySelector('.player video').currentTime>12,{},{timeout:20000});
  check(!(await snapshot()).paused,'compatible video and audio continue across six-second boundaries');
  await seek(92.4);
  {
    await arrived(92.4);
    check((await snapshot()).paused===false,'compatible seek keeps playing');
    check(segments.some(url=>url.endsWith('/segment-15.ts')),'seek requests only the segment containing 92 seconds');
    await page.waitForTimeout(1100);
    check((await snapshot()).time>92,'seek does not snap back after timeupdate');
    check((await snapshot()).audio>0,'compatible seek decodes audio');
    check(Number(await page.locator('.player-seek').getAttribute('max'))>=120,'range uses full movie duration');
    await seek(40);await seek(71);await seek(98.2);await arrived(98.2);
    check((await snapshot()).time>97,'rapid seeks retain the last target');
    await clickControl('Pause');await seek(21.3);await arrived(21.3);
    check((await snapshot()).paused,'backward seek before window retains paused intent');

    await page.evaluate(()=>localStorage.setItem('virelo-playback-quality:v1','360'));
    await page.goto(base+'/watch/'+ids[1]+'?queue=false');
    await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.3;},{},{timeout:30000});
    await seek(88.7);await arrived(88.7);
    check(segments.some(url=>url.includes('/360/segment-14.ts')),'manual-quality seek requests only the selected rendition');
    await clickControl('Quality');
    check(await page.getByRole('menuitemradio',{name:/^360p/}).getAttribute('aria-checked')==='true','manual quality ceiling survives seek');
    await clickControl('Quality');
    await page.waitForTimeout(1000);check((await snapshot()).time>88,'adaptive playback does not return to old position');
    await clickControl('Pause');await seek(30.3);await arrived(30.3);
    check((await snapshot()).paused,'adaptive backward seek retains pause');

    await page.evaluate(()=>localStorage.setItem('virelo-playback-quality:v1','highest'));
    await page.goto(base+'/watch/'+ids[1]+'?queue=false');
    await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.3;},{},{timeout:30000});
    const previous=requests.length;await seek(90.2);await arrived(90.2);
    check(requests.length===previous,'direct-file seek has no conversion/preparation request');
    await page.goto(base+'/watch/'+dualId+'?queue=false');
    await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.3;},{},{timeout:30000});
    await seek(40.2);await arrived(40.2);
    await clickControl('Audio');
    await page.getByRole('menuitemradio',{name:/AC3/i}).click();
    await page.waitForFunction(()=>{const a=document.querySelector('.player audio'),v=document.querySelector('.player video');return a&&!a.paused&&a.readyState>=3&&Math.abs(a.currentTime-v.currentTime)<.4;},{},{timeout:30000});
    check(segments.some(url=>url.includes('/audio/2/')),'audio-only fallback converts the selected unsupported track on demand');
    await seek(88.7);await arrived(88.7);
    await page.waitForFunction(()=>{const a=document.querySelector('.player audio'),v=document.querySelector('.player video');return !a.paused&&Math.abs(a.currentTime-v.currentTime)<.4;},{},{timeout:30000});
    check((await snapshot()).time>88,'audio-only fallback stays in sync after a distant seek');
    if(longId){
      await page.goto(base+'/watch/'+longId+'?queue=false');
      await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.3;},{},{timeout:30000});
      await seek(2844.4);await arrived(2844.4);
      check(segments.some(url=>url.includes('/playback/'+longId+'/')&&url.endsWith('/segment-474.ts')),'feature-length encoder requests 47:24 without converting the prefix');
      check(!(await snapshot()).paused,'feature-length seek retains playback');
      check(Number(await page.locator('.player-seek').getAttribute('max'))>=7041,'feature-length range retains 1:57:21 duration');
      await page.waitForTimeout(1100);
      check(Math.abs((await snapshot()).time-2845.5)<3,'47-minute seek does not return to old position');
      console.log('LONG_FORWARD',JSON.stringify(await snapshot()));
      await clickControl('Pause');await seek(896.2);await arrived(896.2);
      check((await snapshot()).paused,'feature-length backward seek retains pause');
    }
    check(errors.length===0,'no browser runtime errors '+errors.join('|'));
    console.log('FINAL',JSON.stringify(await snapshot()));
    await page.goto('about:blank');await page.waitForTimeout(1500);
    const generated=await cacheFiles();
    check(generated.every(path=>!path.endsWith('.part')),'no abandoned encoder output after leaving playback');
    check(!generated.some(path=>path.replaceAll('\\','/').includes('/adaptive/1/480/')),'unselected 480p rendition was never encoded');
    const bytes=(await Promise.all(generated.map(path=>stat(path)))).reduce((sum,file)=>sum+file.size,0);
    check(bytes<64*1024*1024,'multiple seeks and a feature-length clip use less than 64 MiB in this fixture');
    await page.waitForTimeout(1200);check((await cacheFiles()).length===generated.length,'cache stops growing after playback is closed');
    console.log('CACHE_BYTES',bytes);
  }
  console.log(JSON.stringify({checks,root}));
}finally{await browser.close();await app.close();}
