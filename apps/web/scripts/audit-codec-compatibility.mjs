import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const root=await mkdtemp(join(tmpdir(),'virelo-codec-compatibility-'));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const fixtures=[];
for(const [name,video,audio] of [['native.mp4','libx264','aac'],['legacy-mpeg4.mkv','mpeg4','aac'],['legacy-windows.mkv','wmv2','wmav2'],['native.mkv','libx264','aac']]) {
  const path=join(root,name);
  execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=size=960x540:rate=24',
    '-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','24','-c:v',video,...(video==='libx264'?['-preset','ultrafast']:['-q:v','6']),'-c:a',audio,'-ac','2',path],{windowsHide:true});
  const bytes=await readFile(path);
  fixtures.push({name,path,bytes,hash:createHash('sha256').update(bytes).digest('hex')});
}
const csp=(await readFile(join(repo,'web/public/_headers'),'utf8')).match(/Content-Security-Policy: (.+)/)[1];
let server,browser,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
try {
  server=spawn(process.execPath,[fileURLToPath(new URL('bin/vite.js',import.meta.resolve('vite/package.json'))),'preview','--host','127.0.0.1','--port','0'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const base=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error(log)),20000);server.once('error',reject);server.stdout.on('data',chunk=>{log+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});server.stderr.on('data',chunk=>{log+=chunk;});});
  const origin=new URL(base).origin;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:900},locale:'en-US',serviceWorkers:'block',reducedMotion:'reduce'});
    const page=await context.newPage(),codecRequests=[],external=[],errors=[];page.setDefaultTimeout(60000);
    page.on('pageerror',error=>{errors.push(error.message);console.error('BROWSER_ERROR',error.message);});
    page.on('request',request=>{const url=new URL(request.url());if(url.pathname.includes('/ffmpeg-0.12.10/'))codecRequests.push(url.pathname);if(['http:','https:'].includes(url.protocol)&&url.origin!==origin)external.push(url.href);});
    await context.route(url=>url.origin===origin,async route=>{const response=await route.fetch({maxRetries:2});await route.fulfill({response,headers:{...response.headers(),'content-security-policy':csp,'cross-origin-opener-policy':'same-origin'}});});
    await page.route('**/__compatibility-fixture/*',route=>{const item=fixtures[Number(new URL(route.request().url()).pathname.split('/').at(-1))];return route.fulfill({body:item.bytes,contentType:item.name.endsWith('.mp4')?'video/mp4':'video/x-matroska'});});
    // Delay one synthetic header read so the ongoing scan is observable, independent of frame decoding support.
    await page.addInitScript(()=>{
      window.__nativeFileSlice=File.prototype.slice;
      File.prototype.slice=function(...args){
        const blob=window.__nativeFileSlice.apply(this,args);
        if(this.name!=='native.mkv'||window.__headerDelayUsed)return blob;
        window.__headerDelayUsed=true;
        const ready=new Promise(resolve=>setTimeout(resolve,1200)),arrayBuffer=blob.arrayBuffer.bind(blob),stream=blob.stream.bind(blob);
        blob.arrayBuffer=async()=>{await ready;return arrayBuffer();};
        blob.stream=()=>{const reader=stream().getReader();return new ReadableStream({async pull(controller){await ready;const chunk=await reader.read();if(chunk.done)controller.close();else controller.enqueue(chunk.value);},cancel:reason=>reader.cancel(reason)});};
        return blob;
      };
    });
    await page.goto(base+'/app/settings');await page.locator('.settings-heading').waitFor();
    console.log('SETUP',width);
    await page.evaluate(async items=>{
      const root=await navigator.storage.getDirectory();
      for(const [index,item] of items.entries()){const handle=await root.getFileHandle(item.name,{create:true}),writer=await handle.createWritable();await writer.write(await(await fetch('/__compatibility-fixture/'+index)).blob());await writer.close();}
      const db=await new Promise((resolve,reject)=>{const request=indexedDB.open('virelo-web');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
      await new Promise((resolve,reject)=>{const tx=db.transaction('libraries','readwrite');tx.objectStore('libraries').put({id:1,label:'Synthetic codec tests',path:'Synthetic codec tests',created_at:1,persistent:true,handle:root});tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
    },fixtures.map(({name})=>({name})));
    await page.reload();
    if(width<900)await page.locator('#settings-nav-libraries').click();
    await page.getByRole('button',{name:'Scan now',exact:true}).click();
    const warning=page.locator('.browser-scan-warning');
    try { await warning.waitFor({timeout:15000}); }
    catch(error) { console.error('SCAN_STATE',await page.locator('.scan-strip').textContent());throw error; }
    const liveScan=await page.locator('.scan-progress').isVisible();
    if(!liveScan)console.error('SCAN_FINISHED_BEFORE_WARNING',await page.locator('.scan-strip').textContent());
    check(liveScan,width+' warning appears while scanning continues');
    check(await page.getByRole('dialog').count()===0&&await page.getByRole('alertdialog').count()===0,width+' warning never pauses for confirmation');
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Scan now'&&!button.disabled));
    check((await warning.textContent()).includes('2 videos need browser conversion.'),width+' scan reports exactly the two legacy videos');
    check(codecRequests.length===0,width+' metadata scan does not download or start FFmpeg');
    check(await warning.evaluate(element=>{const rect=element.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth;}),width+' warning fits the viewport');
    await page.screenshot({path:join(root,width+'-warning.png')});
    const records=await page.evaluate(async()=>{const db=await new Promise(resolve=>{const request=indexedDB.open('virelo-web');request.onsuccess=()=>resolve(request.result);});const rows=await new Promise(resolve=>{const request=db.transaction('media').objectStore('media').getAll();request.onsuccess=()=>resolve(request.result);});db.close();return rows.map(({id,filename,playback_conversion})=>({id,filename,playback_conversion}));});
    check(records.length===4&&records.filter(row=>row.playback_conversion).length===2,width+' all videos are added and compatibility decisions cached');
    await page.evaluate(()=>{File.prototype.slice=window.__nativeFileSlice;});
    await warning.getByRole('button',{name:'Dismiss message'}).click();
    check(!await warning.count(),width+' non-blocking warning can be dismissed');
    await page.getByRole('button',{name:'Scan now',exact:true}).click();await warning.waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Scan now'&&!button.disabled));
    check((await warning.textContent()).includes('2 videos need browser conversion.')&&codecRequests.length===0,width+' rescan reuses compatibility results without downloading FFmpeg');
    await warning.getByRole('button',{name:'Dismiss message'}).click();
    for(const name of ['legacy-mpeg4.mkv','legacy-windows.mkv']) {
      const id=records.find(row=>row.filename===name).id;
      await page.goto(base+'/app/watch/'+id);
      await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&video.videoWidth===960&&video.readyState>=2&&!video.paused&&video.currentTime>.2;});
      const video=page.locator('.player video');
      check(!await page.locator('.player-status.error').count(),width+' '+name+' is actually decoded through the software fallback');
      const rms=await video.evaluate(async video=>{
        const stream=video.captureStream(),context=new AudioContext(),source=context.createMediaStreamSource(stream),analyser=context.createAnalyser();
        try{source.connect(analyser);await context.resume();await new Promise(resolve=>setTimeout(resolve,300));const samples=new Float32Array(analyser.fftSize);analyser.getFloatTimeDomainData(samples);return Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);}
        finally{source.disconnect();stream.getTracks().forEach(track=>track.stop());await context.close();}
      });
      check(rms>.001,width+' '+name+' converted audio is non-silent');
      await video.evaluate(video=>{video.pause();video.currentTime=20;});
      await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&video.readyState>=2&&Math.abs(video.currentTime-20)<.6;});
      check(await video.evaluate(video=>video.paused),width+' '+name+' out-of-buffer seek preserves pause and position');
    }
    for(const name of ['native.mp4','native.mkv']) {
      const native=records.find(row=>row.filename===name);await page.goto(base+'/app/watch/'+native.id);
      await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&video.readyState>=2&&video.videoWidth===960;});
      const original=await page.locator('.player video').evaluate(async video=>{const bytes=await(await fetch(video.currentSrc)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');});
      check(original===fixtures.find(item=>item.name===name).hash,width+' '+name+' still plays the untouched original');
    }
    await page.goto(base+'/app/settings');if(width<900)await page.locator('#settings-nav-libraries').click();
    await page.evaluate(async()=>{const root=await navigator.storage.getDirectory(),handle=await root.getFileHandle('legacy-mpeg4.mkv'),writer=await handle.createWritable();await writer.write(await(await fetch('/__compatibility-fixture/3')).blob());await writer.close();});
    await page.getByRole('button',{name:'Scan now',exact:true}).click();await warning.waitFor();
    await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(button=>button.textContent.trim()==='Scan now'&&!button.disabled));
    check((await warning.textContent()).includes('1 video needs browser conversion.'),width+' changing a file invalidates its cached compatibility result');
    check(codecRequests.some(path=>path.endsWith('.wasm.gz')),width+' software decoder is loaded only for playback');
    check(external.length===0,width+' no media or requests leave the local test origin');
    check(errors.length===0,width+' no browser exceptions');
    await context.close();
  }
  for(const item of fixtures)check(createHash('sha256').update(await readFile(item.path)).digest('hex')===item.hash,'synthetic source stays byte-identical: '+item.name);
  console.log(JSON.stringify({checks,syntheticMediaOnly:true,root}));
} finally {await browser?.close();if(server&&!server.killed)server.kill();}
