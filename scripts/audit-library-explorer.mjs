import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFileSync,spawn} from 'node:child_process';
const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-explorer-audit-')),media=join(root,'media');
const clip=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x354356:s=320x180:r=10:d=2','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true});
await mkdir(join(media,'Shows','Season 1'),{recursive:true});await mkdir(join(media,'Shots'),{recursive:true});
const items=[];
for(let i=1;i<=203;i++){
 const folder=i===202?'Shows/Season 1':i===203?'Shots':'',filename='Clip '+String(i).padStart(3,'0')+'.mp4',source=folder?folder+'/'+filename:filename,path=join(media,source);
 await writeFile(path,clip);
 items.push({id:i,library_id:1,path,source_path:source,filename,title:'Clip '+String(i).padStart(3,'0'),sort_title:'clip '+String(i).padStart(3,'0'),kind:'video',series_title:null,season:null,episode:null,year:null,duration:2,width:320,height:180,video_codec:'h264',audio_codec:null,container:'mp4',folder,size:clip.length,mtime:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,added_at:1,updated_at:1,liked:0,progress_position:0});
}
const modes=[],children=[];let server,browser,page;let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;console.log('PASS',message);};
async function auditFolderPress(page,context,label,width) {
 const folder=page.locator('.explorer-folder-grid .folder-chip').filter({hasText:'Shows'}).first();
 if(width>=760){
  await folder.click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).waitFor();
  await page.keyboard.press('Escape');
  check(await folder.evaluate(element=>element===document.activeElement),label+' right-click menu restores focus without opening the folder');
  return;
 }
 const client=await context.newCDPSession(page);
 const start=async()=>{
  await folder.scrollIntoViewIfNeeded();const box=await folder.boundingBox();assert.ok(box);
  const point={x:box.x+box.width/2,y:box.y+box.height/2,id:1,radiusX:8,radiusY:8,force:1};
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point]});return point;
 };
 const end=()=>client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 const waitPastHold=()=>page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,600)));
 await start();
 check(await folder.getAttribute('data-holding')==='true',label+' touch immediately indicates a held folder');
 if(width===390)await page.waitForFunction(()=>[...document.querySelectorAll('.folder-chip[data-holding]')].some(element=>parseFloat(getComputedStyle(element).scale)<1));
 else check(await folder.evaluate(element=>getComputedStyle(element).scale)==='1',label+' reduced motion keeps feedback without scaling');
 await page.getByRole('menuitem',{name:'Rename',exact:true}).waitFor();await end();
 check(await page.getByRole('heading',{name:'Clips',exact:true}).isVisible(),label+' releasing a long press never navigates');
 await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Rename folder',exact:true});await dialog.waitFor();
 check(await dialog.getByRole('textbox',{name:'Display name',exact:true}).inputValue()==='Shows',label+' touch opens the same folder rename dialog');
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
 let point=await start();
 await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{...point,y:point.y+24}]});await end();await waitPastHold();
 check(await page.getByRole('menu').count()===0&&await page.getByRole('heading',{name:'Clips',exact:true}).isVisible(),label+' dragging cancels the hold and its trailing click');
 await start();await page.evaluate(()=>window.dispatchEvent(new Event('scroll')));await end();await waitPastHold();
 check(await page.getByRole('menu').count()===0,label+' scrolling cancels pending folder menus');
 point=await start();
 await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point,{...point,id:2,x:point.x+28}]});await end();await waitPastHold();
 check(await page.getByRole('menu').count()===0,label+' multi-touch cancels the hold');
 await folder.tap();await page.getByRole('heading',{name:'Shows',exact:true}).waitFor();
 check(await page.getByRole('menu').count()===0,label+' a short tap still opens the folder');
 const input=page.getByRole('combobox',{name:'Path',exact:true});await input.fill('/Clips');await input.press('Enter');
 await page.getByRole('heading',{name:'Clips',exact:true}).waitFor();
 await client.detach();
}
async function serveWeb(directory){
 const child=spawn(process.execPath,[join(directory,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']});children.push(child);
 return new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log)),20000);child.once('error',reject);child.stderr.on('data',data=>log+=data);child.stdout.on('data',data=>{log+=String(data).replace(/\x1b\[[0-9;]*m/g,'');const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});});
}
try {
 if(existsSync(join(repo,'dist/server.js'))){
  process.env.VIRELO_LOG_LEVEL='silent';
  const {createVireloServer}=await import(pathToFileURL(join(repo,'dist/server.js')).href);
  server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  server.db.addLibrary(media,'Clips');
  for(const item of items){const {id,source_path,added_at,updated_at,liked,progress_position,...record}=item;server.db.upsertMedia(record);}
  await server.app.listen({host:'127.0.0.1',port:0});modes.push(['npm','http://127.0.0.1:'+server.app.server.address().port]);
 }
 const web=process.env.VIRELO_TEST_WEB_REPO||(!modes.length?repo:null);
 if(web)modes.push(['web',await serveWeb(resolve(web))]);
 browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
 for(const [mode,base] of modes)for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:900},serviceWorkers:'block',locale:'en-US',reducedMotion:width===390?'no-preference':'reduce',isMobile:width<760,hasTouch:width<760});
  page=await context.newPage();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const prefix=mode==='npm'?'':'/app',label=mode+' '+width;
  if(mode==='npm'){
   const status=await(await page.request.get(base+'/api/auth/status')).json();
   const response=await page.request.post(base+(status.setupRequired?'/api/auth/setup':'/api/auth/login'),{headers:{'X-Virelo-Request':'1'},data:{username:'audit',password:'1'}});
   assert.equal(response.status(),200,await response.text());
  }else{
   await page.route(base+'/__explorer-seed',route=>route.fulfill({body:'<!doctype html><body></body>',contentType:'text/html'}));
   await page.route(base+'/__explorer-clip',route=>route.fulfill({body:clip,contentType:'video/mp4'}));
   await page.goto(base+'/__explorer-seed');
   await page.evaluate(async items=>{
    const directory=await(await navigator.storage.getDirectory()).getDirectoryHandle('Clips',{create:true}),blob=await(await fetch('/__explorer-clip')).blob();
    for(const item of items){
     let folder=directory;for(const segment of item.folder.split('/').filter(Boolean))folder=await folder.getDirectoryHandle(segment,{create:true});
     const writer=await(await folder.getFileHandle(item.filename,{create:true})).createWritable();await writer.write(blob);await writer.close();
    }
    await new Promise((resolve,reject)=>{
     const r=indexedDB.open('virelo-web',2);r.onupgradeneeded=()=>{for(const name of ['media','libraries','thumbnails'])r.result.createObjectStore(name,{keyPath:'id'});r.result.createObjectStore('settings');r.result.createObjectStore('playlists',{keyPath:'id',autoIncrement:true});};
     r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['media','libraries'],'readwrite');items.forEach(item=>tx.objectStore('media').put(item));tx.objectStore('libraries').put({id:1,label:'Clips',path:'Clips',created_at:1,persistent:true,handle:directory});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
    });
   },items);
  }
  const setLayout=async name=>{
    await page.goto(base+prefix+'/settings');
    await page.locator('#settings-nav-appearance').click();
    await page.getByRole('button',{name:'Library view',exact:true}).click();
    await page.getByRole('option',{name,exact:true}).click();
  };
  await setLayout('Explorer view');
  await page.goto(base+prefix+'/library');
  const input=page.getByRole('combobox',{name:'Path',exact:true});
  await input.waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  check(await page.locator('.library-layout-switch,.folder-options').count()===0,label+' layout and folder option controls are absent from the library');
  await page.locator('.explorer-folder-grid .folder-chip').filter({hasText:'Clips'}).click();
  check(await input.inputValue()==='/Clips',label+' settings-selected Explorer opens the registered root');
  await auditFolderPress(page,context,label,width);
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===200);
  check(await page.locator('.media-card').count()===200,label+' first page excludes nested videos');
  await page.getByRole('button',{name:'Load more',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===201);
  check(true,label+' videos beyond the first page remain available');
  await page.getByRole('button',{name:'Sort',exact:true}).click();await page.getByRole('option',{name:'Random',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===200);
  await page.getByRole('button',{name:'Load more',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===201);
  check(await page.locator('.media-card').evaluateAll(cards=>new Set(cards.map(card=>card.getAttribute('href'))).size===cards.length),label+' random pagination never repeats a video');
  await page.getByRole('button',{name:'Sort',exact:true}).click();await page.getByRole('option',{name:'Title',exact:true}).click();
  await input.fill('/Clips/Sh');await input.press('Tab');
  check(await input.evaluate(element=>getComputedStyle(element).outlineStyle==='none'),label+' address focus uses one neutral field boundary');
  const first=await input.inputValue();check(first==='/Clips/Shots/'||first==='/Clips/Shows/',label+' Tab completes a matching folder');
  check(await input.evaluate(element=>element.selectionStart===element.value.length),label+' completion leaves the caret ready for the next segment');
  await input.press('Tab');check(await input.inputValue()!==first,label+' repeated Tab cycles matches');
  await input.press('Shift+Tab');check(await input.inputValue()===first,label+' Shift+Tab reverses completion');
  await input.press('Escape');check(await input.inputValue()==='/Clips',label+' Escape restores the current path');
  await input.fill('/Clips/Shows/');await input.press('ArrowDown');await input.press('Enter');
  await page.getByRole('heading',{name:'Season 1',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
  check(await page.locator('.media-card').count()===1,label+' suggestions navigate to exactly one physical directory');
  await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Clips',exact:true}).waitFor();
  await page.getByRole('button',{name:'Forward',exact:true}).click();await page.getByRole('heading',{name:'Season 1',exact:true}).waitFor();
  await input.focus();await input.press('Alt+ArrowUp');await page.getByRole('heading',{name:'Shows',exact:true}).waitFor();
  check(await page.locator('.media-card').count()===0,label+' parent folders do not mix in descendants');
  await input.fill('../Shots');await input.press('Enter');await page.getByRole('heading',{name:'Shots',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
  check(await page.locator('.media-card').count()===1,label+' relative paths retain the current library');
  await input.fill('/Not registered/private');await input.press('Enter');await page.getByRole('alert').filter({hasText:'Folder not found.'}).waitFor();
  check(await page.getByRole('heading',{name:'Shots',exact:true}).isVisible(),label+' unknown paths do not change the current folder');
  await input.press('Escape');
  if(width<760){
   check(!await page.locator('.explorer-sidebar').isVisible(),label+' mobile leaves full width for videos');
   await page.getByRole('button',{name:'Folders',exact:true}).click();
   check(await page.locator('.explorer-sidebar').isVisible(),label+' folder tree is available on mobile');
  }
  const tree=page.getByRole('navigation',{name:'Folders',exact:true});
  await tree.locator('.folder-control').filter({hasText:'Clips'}).first().locator('.folder-chip').click();
  await page.getByRole('heading',{name:'Clips',exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length>=200);
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.screenshot({path:join(root,mode+'-'+width+'-current.png')});
  if(width===1440){
   await page.getByRole('button',{name:'Play all',exact:true}).click();await page.locator('.playback-queue').waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('.playback-queue-tile').length===201);
   check(true,label+' Play all preserves exact root filtering across pagination');
   await page.reload();await page.locator('.playback-queue').waitFor();
   check(await page.locator('.playback-queue-tile').count()===201,label+' root queue survives a reload without nested videos');
   await page.goto(base+prefix+'/library');
  }else await page.reload();
  await input.waitFor();
  check(await page.locator('.library-view').getAttribute('data-layout')==='explorer',label+' layout preference persists');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' panels fit the viewport');
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.screenshot({path:join(root,mode+'-'+width+'.png')});
  await setLayout('Grid view');
  await page.goto(base+prefix+'/library');
  await page.getByRole('navigation',{name:'Library selection',exact:true}).waitFor();
  check(await page.getByRole('navigation',{name:'Library selection',exact:true}).isVisible(),label+' original library layout remains available');
  check(errors.length===0,label+' no browser exceptions: '+errors.join('; '));
  await context.close();
 }
 for(const item of items)assert.deepEqual(await readFile(item.path),clip);
 console.log(JSON.stringify({checks,root,result:'passed'}));
}catch(error){console.error('Artifacts:',root);if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-3000));await page.screenshot({path:join(root,'failure.png')}).catch(()=>{});}throw error;}
finally{await browser?.close();await server?.app.close();children.forEach(child=>child.kill());}
