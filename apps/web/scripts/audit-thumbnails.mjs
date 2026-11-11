// Real decoding and IndexedDB recovery in an isolated synthetic library.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const base = process.env.VIRELO_THUMBNAIL_URL || 'http://127.0.0.1:5299';
const folder = await mkdtemp(join(tmpdir(), 'virelo-thumbnail-audit-'));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
function encode(name, args) { execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args, join(folder, name)]); }
encode('intro.mp4', ['-f','lavfi','-i','color=black:s=320x180:r=15:d=3','-f','lavfi','-i','testsrc2=s=320x180:r=15:d=5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']);
encode('ac3.mkv', ['-i',join(folder,'intro.mp4'),'-f','lavfi','-i','sine=frequency=600:duration=8','-map','0:v','-map','1:a','-c:v','copy','-c:a','ac3','-shortest']);
encode('portrait.mp4', ['-f','lavfi','-i','testsrc2=s=180x320:r=15:d=2','-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart']);
encode('tiny.webm', ['-f','lavfi','-i','color=red:s=160x90:r=30:d=0.15','-c:v','libvpx-vp9']);
const names = ['intro.mp4','ac3.mkv','portrait.mp4','tiny.webm'];
const blobs = new Map(await Promise.all(names.map(async name => [name, await readFile(join(folder,name))])));
const browser = await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
let checks = 0;
let debugPage;
const check = (value, name) => { assert.ok(value,name); checks++; console.log('PASS',name); };
try {
  const context = await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000},reducedMotion:'reduce'});
  const page = await context.newPage();
  debugPage=page;
  const errors = [];
  page.on('pageerror', error => {errors.push(error.message);console.error('PAGE_ERROR',error.message);});
  await page.addInitScript(()=>{window.__thumbnailEvents=[];window.addEventListener('virelo-thumbnail-updated',event=>window.__thumbnailEvents.push(event.detail));});
  await page.route('**/__thumbnail/*', route => route.fulfill({body:blobs.get(route.request().url().split('/').pop()),contentType:'application/octet-stream'}));
  await page.goto(base+'/app/settings'); await page.locator('.settings-heading').waitFor();
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  const seeded = await page.evaluate(async names => {
    // Use the same module instance as api.ts even after Vite adds an HMR timestamp.
    const apiModule=await(await fetch('/src/api.ts')).text();
    const libraryPath=apiModule.match(/from\s+["']([^"']*local-library[^"']*)["']/)?.[1]||'/src/local-library.ts';
    const library = await import(libraryPath);
    const { validThumbnail, probeVideo, THUMBNAIL_VERSION } = await import('/src/utils/video-thumbnail.ts');
    const files = await Promise.all(names.map(async name => new File([await (await fetch('/__thumbnail/'+name)).blob()],name,{lastModified:100})));
    const directory = {name:'Synthetic thumbnails',kind:'directory',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',async *values(){for(const file of files)yield {name:file.name,kind:'file',getFile:async()=>file};}};
    window.showDirectoryPicker = async () => directory;
    await library.addLocalLibrary();
    const items = await library.listStoredMedia();
    const db = await new Promise((resolve,reject)=>{const request=indexedDB.open('virelo-web');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    window.__readThumbnail = id => new Promise((resolve,reject)=>{const request=db.transaction('thumbnails').objectStore('thumbnails').get(id);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
    window.__writeThumbnail = record => new Promise((resolve,reject)=>{const tx=db.transaction('thumbnails','readwrite');tx.objectStore('thumbnails').put(record);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    window.__deleteThumbnail = id => new Promise((resolve,reject)=>{const tx=db.transaction('thumbnails','readwrite');tx.objectStore('thumbnails').delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});
    window.__library = library;
    window.__files = files;
    const results = [];
    for(const item of items){const thumbnail=await window.__readThumbnail(item.id);results.push({name:item.filename,width:item.width,height:item.height,duration:item.duration,valid:!!thumbnail?.blob&&await validThumbnail(thumbnail.blob),version:thumbnail?.version});}
    const black=document.createElement('canvas');black.width=320;black.height=180;black.getContext('2d').fillRect(0,0,320,180);window.__black=await new Promise(r=>black.toBlob(r,'image/jpeg'));
    const invalid=await probeVideo(new File(['not a video'],'invalid.mp4'));
    return {results,invalid,thumbnailVersion:THUMBNAIL_VERSION,blackAccepted:await validThumbnail(window.__black)};
  },names);
  for(const result of seeded.results){check(result.valid&&result.version===seeded.thumbnailVersion,'actual decoded thumbnail '+result.name);}
  check(seeded.results.find(x=>x.name==='portrait.mp4').height>seeded.results.find(x=>x.name==='portrait.mp4').width,'portrait dimensions');
  check(seeded.results.find(x=>x.name==='tiny.webm').duration<0.2,'sub-200ms clips generate artwork');
  check(!seeded.blackAccepted,'black legacy canvases are rejected');
  check(!seeded.invalid.thumbnail,'invalid files do not persist fake artwork');
  await page.evaluate(async()=>{
    const items=await window.__library.listStoredMedia();
    for(const item of items){await window.__library.updateStoredMedia(item.id,current=>{current.liked=1;current.progress_position=41;current.progress_duration=100;current.metadata_blocked=1;});}
    await window.__writeThumbnail({id:items[0].id,blob:window.__black});
    await window.__deleteThumbnail(items[1].id);
    await window.__library.updateStoredMedia(items[1].id,item=>{item.thumbnail_path=null;});
  });
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  await page.locator('.media-card').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.media-card-art')].filter(card=>{const b=card.getBoundingClientRect();return b.left<innerWidth&&b.top<innerHeight&&b.bottom>0;}).every(card=>{const img=card.querySelector('img');return img?.complete&&img.naturalWidth>1&&img.dataset.loaded==='true';}));
  check(true,'visible Home cards recover missing/black thumbnails without rescan');
  const restored=await page.evaluate(async()=>{
    const {validThumbnail}=await import('/src/utils/video-thumbnail.ts');
    const deadline=Date.now()+10000;
    while(Date.now()<deadline){
      const items=await window.__library.listStoredMedia();
      const results=await Promise.all(items.map(async item=>{const thumbnail=await window.__readThumbnail(item.id);return {valid:!!thumbnail?.blob&&await validThumbnail(thumbnail.blob),preserved:item.liked===1&&item.progress_position===41&&item.metadata_blocked===1};}));
      if(results.length&&results.every(result=>result.valid))return results;
      await new Promise(resolve=>setTimeout(resolve,30));
    }
    throw new Error('Visible thumbnail repairs were not persisted');
  });
  check(restored.every(x=>x.valid),'repairs are persisted in IndexedDB');
  check(restored.every(x=>x.preserved),'favorites, watch progress and metadata are preserved');
  const same=await page.evaluate(async()=>{const item=(await window.__library.listStoredMedia())[0];const urls=await Promise.all(Array.from({length:10},()=>window.__library.ensureLocalThumbnail(item.id)));return new Set(urls).size===1;});
  check(same,'duplicate thumbnail requests share one object URL');
  const updated=await page.evaluate(async()=>{
    const item=(await window.__library.listStoredMedia())[0];await window.__writeThumbnail({id:item.id,blob:window.__black});const previous=window.__library.getLocalScanStatus().finishedAt;await window.__library.startLocalScan();
    while(window.__library.getLocalScanStatus().finishedAt===previous||window.__library.getLocalScanStatus().running)await new Promise(r=>setTimeout(r,30));
    const {validThumbnail}=await import('/src/utils/video-thumbnail.ts');return validThumbnail((await window.__readThumbnail(item.id)).blob);
  });
  check(updated,'unchanged files no longer skip failed thumbnail recovery');
  await page.getByRole('link',{name:'Library',exact:true}).first().click();
  await page.locator('.media-card').first().waitFor();
  const added=await page.evaluate(async()=>{
    const file=new File([window.__files[0]],'new-arrival.mp4',{lastModified:200});
    window.__files.push(file);
    const previous=window.__library.getLocalScanStatus().finishedAt;
    await window.__library.startLocalScan();
    while(window.__library.getLocalScanStatus().running||window.__library.getLocalScanStatus().finishedAt===previous)await new Promise(resolve=>setTimeout(resolve,30));
    const item=(await window.__library.listStoredMedia()).find(item=>item.filename===file.name);
    return {id:item.id,event:window.__thumbnailEvents.some(event=>event.id===item.id&&event.url)};
  });
  check(added.event,'new files publish their generated thumbnail after the scan commits');
  const newCard=page.locator('.media-card').filter({hasText:'new-arrival'});
  await newCard.waitFor();
  await newCard.scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('.media-card')].some(card=>card.textContent.includes('new-arrival')&&card.querySelector('img')?.naturalWidth>1));
  check(true,'an already-open Library displays a new video and its thumbnail without navigation or reload');
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  await page.screenshot({path:join(folder,'home.png')});
  const watchId=await page.evaluate(async()=>{
    const item=(await window.__library.listStoredMedia()).find(item=>item.filename==='intro.mp4');
    const {router}=await import('/src/router.tsx');
    await router.navigate({to:'/app/watch/$mediaId',params:{mediaId:String(item.id)},search:{queue:true}});
    return item.id;
  });
  await page.locator('.playback-queue-list').scrollIntoViewIfNeeded();
  await page.waitForFunction(()=>[...document.querySelectorAll('.playback-queue-art')].every(card=>{const img=card.querySelector('img');return img?.complete&&img.naturalWidth>1;}));
  check(true,'Queue displays repaired thumbnails rather than black stored frames');
  await page.screenshot({path:join(folder,'queue.png')});
  await page.evaluate(async id=>{const {router}=await import('/src/router.tsx');await router.navigate({to:'/app/title/$mediaId',params:{mediaId:String(id)}});},watchId);
  await page.waitForFunction(()=>[...document.querySelectorAll('.detail-backdrop img,.detail-poster img')].every(img=>img.complete&&img.naturalWidth>1)&&document.querySelector('.detail-poster img'));
  check(true,'detail artwork uses repaired thumbnails');
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  await page.reload();await page.locator('.media-card').first().waitFor();
  await page.waitForFunction(()=>[...document.querySelectorAll('.media-card-art img')].some(img=>img.complete&&img.naturalWidth>1));
  check(true,'persisted thumbnails survive reload without file access');
  check(errors.length===0,'no browser errors: '+errors.join('; '));
  const fallbackContext=await browser.newContext({serviceWorkers:'block'});
  const fallbackPage=await fallbackContext.newPage();
  await fallbackPage.route('**/__thumbnail/*',route=>route.fulfill({body:blobs.get('intro.mp4'),contentType:'application/octet-stream'}));
  await fallbackPage.route('**/mediabunny.js*',route=>route.fulfill({body:'throw new Error("Test unavailable WebCodecs decoder");',contentType:'application/javascript'}));
  await fallbackPage.goto(base+'/app/settings');await fallbackPage.locator('.settings-heading').waitFor();
  const fallbackValid=await fallbackPage.evaluate(async()=>{const {probeVideo,validThumbnail}=await import('/src/utils/video-thumbnail.ts');const file=new File([await(await fetch('/__thumbnail/intro.mp4')).blob()],'intro.mp4');const result=await probeVideo(file);return !!result.thumbnail&&await validThumbnail(result.thumbnail);});
  check(fallbackValid,'native fallback waits for decoded, non-black frames');
  await fallbackContext.close();
  console.log(`${checks} checks passed. Fixtures/screenshots: ${folder}`);
  await context.close();
} catch(error) {
  if(debugPage&&!debugPage.isClosed()){
    console.error('ARTWORK_DIAGNOSTIC',await debugPage.evaluate(()=>({
      url:location.href,
      events:window.__thumbnailEvents,
      images:[...document.querySelectorAll('.media-card-art img,.playback-queue-art img,.detail-poster img')].map(img=>({src:img.src,width:img.naturalWidth,loaded:img.dataset.loaded,display:img.style.display})),
      text:document.body.innerText.slice(0,1500)
    })));
    console.error('STORED_THUMBNAILS',await debugPage.evaluate(async()=>{
      if(!window.__library)return [];
      return Promise.all((await window.__library.listStoredMedia()).map(async item=>{
        const thumbnail=await window.__readThumbnail(item.id);
        return {name:item.filename,version:thumbnail?.version,blob:thumbnail?.blob?.size,url:await window.__library.ensureLocalThumbnail(item.id)};
      }));
    }));
    await debugPage.screenshot({path:join(folder,'failure.png')});
    console.error('Failure screenshot:',join(folder,'failure.png'));
  }
  throw error;
} finally { await browser.close(); }
