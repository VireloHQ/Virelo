import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {readFile,mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {openPlaybackSetting} from './helpers/playback-settings.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),root=await mkdtemp(join(tmpdir(),'virelo-avi-'));
const csp=(await readFile(join(repo,'web/public/_headers'),'utf8')).match(/Content-Security-Policy: (.+)/)[1];
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const fixtures=[];
function make(name,args,duration=12){
 const path=join(root,name);
 execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=960x540:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=660:sample_rate=48000','-t',String(duration),...args,path],{windowsHide:true});
 fixtures.push({id:fixtures.length+1,name,path});
}
make('xvid.avi',['-map','0:v','-map','1:a','-map','2:a','-vf',"drawbox=color=black:t=fill:enable='lt(t,8)'",'-c:v','mpeg4','-vtag','XVID','-bf','2','-q:v','5','-c:a','libmp3lame'],40);
make('div3.avi',['-map','0:v','-map','1:a','-c:v','msmpeg4v3','-vtag','DIV3','-q:v','6','-c:a','libmp3lame']);
make('silent.avi',['-map','0:v','-an','-c:v','mpeg4','-q:v','5'],8);
make('mjpeg.avi',['-map','0:v','-map','1:a','-c:v','mjpeg','-q:v','10','-c:a','pcm_s16le'],8);
make('h264.avi',['-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-c:a','aac'],8);
make('native.mp4',['-map','0:v','-map','1:a','-c:v','libx264','-preset','ultrafast','-c:a','aac'],8);
for(const item of fixtures){item.bytes=await readFile(item.path);item.hash=createHash('sha256').update(item.bytes).digest('hex');}
fixtures.push({id:7,name:'broken.avi',bytes:Buffer.from('RIFFjunkAVI broken file')});
let server,browser,lastPage,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
try{
 let base=process.env.VIRELO_TEST_AVI_BASE_URL;
 if(!base){
  server=spawn(process.execPath,[join(repo,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','0'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
  base=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),20000);server.once('error',reject);server.stdout.on('data',chunk=>{log+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});server.stderr.on('data',chunk=>{log+=chunk;});});
 }
 browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
 const origin=new URL(base).origin;
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:900},isMobile:width<600,hasTouch:width<600,serviceWorkers:'block',reducedMotion:'reduce'});
  const page=lastPage=await context.newPage(),errors=[],external=new Map(),blockedScripts=[],codecRequests=[],workerPolicies=[];page.setDefaultTimeout(60000);
  context.on('response',response=>{if(/\/assets\/worker-[^/]+\.js$/.test(new URL(response.url()).pathname))workerPolicies.push(response.headers()['content-security-policy']);});
  page.on('pageerror',error=>errors.push(error.message));
  page.on('requestfailed',request=>{
    const failure=request.failure()?.errorText;
    // CSP-rejected scripts never leave the browser; other failed network requests still count.
    if((failure==='csp'||failure?.includes('ERR_BLOCKED_BY_CSP'))&&request.resourceType()==='script'&&request.method()==='GET'){
      external.delete(request);blockedScripts.push(request.url());return;
    }
    if(failure!=='net::ERR_ABORTED')console.log('REQUEST_FAILED',request.url(),failure);
  });
  page.on('console',message=>{if(message.type()==='error')console.log('BROWSER_ERROR',message.text());});
  page.on('request',request=>{const url=new URL(request.url());if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)external.set(request,url.href);if(url.pathname.includes('/ffmpeg-0.12.10/'))codecRequests.push(url.pathname);});
  if(width<600&&!process.env.VIRELO_TEST_AVI_BASE_URL)await page.route('**/ffmpeg-core.wasm.gz',async route=>route.fulfill({body:await readFile(join(repo,'dist/assets/ffmpeg-0.12.10/ffmpeg-core.wasm.gz')),contentType:'application/gzip'}));
  if(!process.env.VIRELO_TEST_AVI_BASE_URL)await context.route(url=>url.origin===origin,async route=>{const response=await route.fetch({maxRetries:2});await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp,'cross-origin-opener-policy':'same-origin'}});});
  await page.route('**/__avi-fixture/*',route=>{const item=fixtures.find(item=>String(item.id)===new URL(route.request().url()).pathname.split('/').at(-1));return route.fulfill({body:item.bytes,contentType:item.name.endsWith('.mp4')?'video/mp4':'video/x-msvideo'});});
  await page.goto(base+'/app/settings');await page.locator('.settings-heading').waitFor();
  const catalog=await page.evaluate(async items=>{
   const root=await navigator.storage.getDirectory();
   for(const item of items){const handle=await root.getFileHandle(item.name,{create:true}),writer=await handle.createWritable();await writer.write(await(await fetch('/__avi-fixture/'+item.id)).blob());await writer.close();item.mtime=(await handle.getFile()).lastModified;}
   const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('virelo-web');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
   const media=items.map(item=>({id:item.id,library_id:1,path:item.name,source_path:item.name,filename:item.name,title:item.name,sort_title:item.name,kind:'movie',duration:null,width:null,height:null,video_codec:null,audio_codec:null,container:item.name.split('.').at(-1),folder:'',size:item.size,mtime:item.mtime,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,added_at:1,updated_at:1}));
   // Keep AVI thumbnails out of the native-playback check; they legitimately need the decoder.
   await new Promise((resolve,reject)=>{const tx=db.transaction(['libraries','media'],'readwrite');tx.objectStore('libraries').put({id:1,path:'avi-audit',label:'AVI audit',created_at:1,persistent:true,handle:root});tx.objectStore('media').put(media.find(item=>item.id===6));tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();return media;
  },fixtures.map(item=>({id:item.id,name:item.name,size:item.bytes.length,mtime:1})));
  const player=page.locator('.player:not(.short-player)'),video=player.locator('video');
  const ready=async()=>{await page.waitForFunction(()=>{const v=document.querySelector('.player video');return document.querySelector('.player-status.error')||(v&&v.readyState>=2&&!v.paused&&v.currentTime>.2);});assert.equal(await player.locator('.player-status.error').count(),0,await player.innerText());};
  const pause=async()=>{if(!await video.evaluate(v=>v.paused))await player.getByRole('button',{name:'Pause',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.player video').paused);};
  await page.goto(base+'/app/watch/6');await ready();
  check(codecRequests.length===0,width+' native MP4 does not load the AVI engine');
  await page.evaluate(async media=>{
   const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('virelo-web');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   await new Promise((resolve,reject)=>{const tx=db.transaction('media','readwrite');for(const item of media)tx.objectStore('media').put(item);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
  },catalog);
  await page.goto(base+'/app/watch/1');await ready();await pause();
  check(await video.evaluate(v=>v.videoWidth===960&&v.videoHeight===540&&v.duration>39&&v.duration<40.2),width+' Xvid video and both MP3 tracks are read at original resolution');
  check(await player.locator('.player-status.error').count()===0,width+' AVI never leaves a native unsupported-format error');
  check(await video.evaluate(v=>v.buffered.end(v.buffered.length-1)<24),width+' AVI starts before the whole file is converted');
  const seek=player.getByRole('slider',{name:'Seek',exact:true});
  for(const target of [29,3]){
   await seek.fill(String(target));
   await page.waitForFunction(target=>{const v=document.querySelector('.player video');return v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-target)<.4;},target);
   check(await video.evaluate(v=>v.paused),width+' seek to '+target+' preserves pause');
  }
  await seek.fill('32');await page.waitForTimeout(40);await seek.fill('3');
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-3)<.4&&!document.querySelector('.player-status:not(.error)');});
  check(await video.evaluate(v=>v.paused),width+' changing seek during AVI preparation keeps the last requested position');
  await openPlaybackSetting(page,'Audio');
  const audio=page.getByRole('menu',{name:'Audio',exact:true}).getByRole('menuitemradio');
  check(await audio.count()===2,width+' AVI exposes both audio tracks');await audio.nth(1).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v.readyState>=2&&v.paused&&!document.querySelector('.player-status:not(.error)');});
  await player.getByRole('button',{name:'Play',exact:true}).click();await ready();
  const hz=await video.evaluate(async element=>{
   const context=new AudioContext(),source=context.createMediaElementSource(element),analyser=context.createAnalyser();analyser.fftSize=4096;source.connect(analyser);analyser.connect(context.destination);await context.resume();
   try{await new Promise(resolve=>setTimeout(resolve,300));const bins=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(bins);let peak=0;for(let i=Math.floor(200*analyser.fftSize/context.sampleRate);i<Math.ceil(1000*analyser.fftSize/context.sampleRate);i++)if(bins[i]>(bins[peak]??-Infinity))peak=i;return peak*context.sampleRate/analyser.fftSize;}finally{await context.close();}
  });
  check(Math.abs(hz-660)<40,width+' selected alternate audio is actually decoded ('+Math.round(hz)+'Hz)');await pause();
  await openPlaybackSetting(page,'Quality');await page.getByRole('menuitemradio',{name:/^480p/}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v.videoHeight===480&&v.readyState>=2;});
  check(await video.evaluate(v=>v.paused),width+' lower AVI quality keeps the pause state');
  await openPlaybackSetting(page,'Quality');await page.getByRole('menuitemradio',{name:/^Original Quality/}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v.videoHeight===540&&v.readyState>=2;});
  check(await player.locator('audio').evaluate(a=>!a.hasAttribute('src')),width+' AVI audio stays muxed when returning to Original');
  await seek.fill('10');await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v.readyState>=2&&!v.seeking&&Math.abs(v.currentTime-10)<.4;});
  await page.reload();await ready();
  check(await video.evaluate(v=>v.currentTime>9&&v.currentTime<14),width+' AVI progress resumes on a document reload');
  await page.goto(base+'/app/library');
  await page.locator('.media-card').filter({hasText:'xvid.avi'}).first().scrollIntoViewIfNeeded();
  await page.waitForFunction(async()=>{
   const db=await new Promise(resolve=>{const req=indexedDB.open('virelo-web');req.onsuccess=()=>resolve(req.result);});
   const row=await new Promise(resolve=>{const req=db.transaction('thumbnails').objectStore('thumbnails').get(1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>resolve(null);});db.close();
   if(!row?.blob)return false;const bitmap=await createImageBitmap(row.blob);try{const canvas=document.createElement('canvas');canvas.width=32;canvas.height=18;const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0,32,18);return bitmap.width===480&&bitmap.height===270&&ctx.getImageData(0,0,32,18).data.some((byte,i)=>i%4!==3&&byte>30);}finally{bitmap.close();}
  });
  check(true,width+' the Xvid AVI gets a visible 480x270 thumbnail beyond its black intro');
  for(const id of [2,3,4,5]){
   await page.goto(base+'/app/watch/'+id);await ready();
   check(await video.evaluate(v=>v.videoWidth===960&&v.videoHeight===540),width+' '+fixtures[id-1].name+' decodes real video frames');
   if(id===3){await pause();const duration=await video.evaluate(v=>v.duration);await seek.fill(String(duration-1));await player.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.player video').ended);check(true,width+' silent AVI reaches the real end without a phantom final segment');}
  }
  await page.goto(base+'/app/watch/7');await page.getByText('Playback unavailable',{exact:true}).waitFor();
  check(true,width+' malformed AVI gives a readable error');
  await page.goto(base+'/app/watch/2');await ready();check(true,width+' another AVI still plays after a decoding error');
  const originals=await page.evaluate(async items=>{const root=await navigator.storage.getDirectory();return Promise.all(items.map(async item=>{const file=await(await root.getFileHandle(item.name)).getFile();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer()))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}));},fixtures.slice(0,6).map(item=>({name:item.name})));
  check(originals.every((hash,i)=>hash===fixtures[i].hash),width+' source video bytes are unchanged');
  check(external.size===0,width+' decoding makes no network transfers to third parties: '+[...external.values()].join(', '));
  if(blockedScripts.length)console.log('INFO',width,'CSP blocked '+blockedScripts.length+' injected script loads before network transfer');
  check(workerPolicies.length>0&&workerPolicies.every(policy=>policy?.includes("'wasm-unsafe-eval'")&&!policy.includes("'unsafe-eval'")),width+' decoder workers run under the production CSP without JavaScript eval');
  check(errors.length===0,width+' no browser exceptions: '+errors.join(', '));
  await page.screenshot({path:join(root,'avi-'+width+'.png')});await context.unrouteAll({behavior:'wait'});await context.close();
 }
 console.log(JSON.stringify({checks,root,result:'passed'}));
}catch(error){if(lastPage&&!lastPage.isClosed()){await lastPage.screenshot({path:join(root,'failure.png')}).catch(()=>{});console.error(await lastPage.locator('body').innerText());console.error(await lastPage.locator('.player video').evaluate(v=>({src:v.currentSrc,time:v.currentTime,paused:v.paused,ready:v.readyState,duration:v.duration,width:v.videoWidth,height:v.videoHeight,error:v.error?.message})).catch(()=>null));}console.error('AVI artifacts:',root);throw error;}
finally{await browser?.close();server?.kill();}
