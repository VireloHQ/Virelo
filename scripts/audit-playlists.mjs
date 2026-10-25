import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
const repo = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const root = await mkdtemp(join(tmpdir(), 'virelo-playlists-audit-')), media = join(root, 'media');
await mkdir(media);
const clip = join(media, 'sample.mp4');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x354356:s=320x180:r=10','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','120','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',clip], { windowsHide:true });
const bytes = await readFile(clip), items = [];
for (let index = 0; index < 4; index++) {
  const path = join(media, 'Clip-' + (index + 1) + '.mp4'); await writeFile(path, bytes);
  items.push({ id:index+1,library_id:1,path,source_path:path,filename:'Clip-'+(index+1)+'.mp4',title:'Clip '+(index+1),sort_title:'Clip '+(index+1),kind:'video',
    duration:120,width:320,height:180,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:bytes.length,mtime:1,
    thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,series_title:null,season:null,episode:null,year:null,
    added_at:1,updated_at:1,liked:index===0?1:0,progress_position:index===0?12:0 });
}
const children = [], modes = [];
let server, browser, lastPage, checks = 0;
const check = (value, label) => { assert.ok(value,label); checks++; console.log('PASS',label); };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function serveWeb(directory) {
  const child=spawn(process.execPath,[join(directory,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']}); children.push(child);
  return new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log)),20000);child.once('error',reject);child.stderr.on('data',data=>{log+=data;});child.stdout.on('data',data=>{log+=String(data).replace(/\x1b\[[0-9;]*m/g,'');const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});});
}
async function call(page, mode, method, ...args) {
  return page.evaluate(async ({mode,method,args}) => {
    if (mode==='web') return (await import('/src/api.ts')).api[method](...args);
    const urls={playlists:['GET','/api/playlists'],playlist:['GET','/api/playlists/'+args[0]],
      createPlaylist:['POST','/api/playlists',args[0]],updatePlaylist:['PATCH','/api/playlists/'+args[0],args[1]],deletePlaylist:['DELETE','/api/playlists/'+args[0],{revision:args[1]}]};
    const [verb,url,body]=urls[method], response=await fetch(url,{method:verb,headers:{'content-type':'application/json','x-virelo-request':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error(await response.text());return response.json();
  },{mode,method,args});
}
async function addFromDetails(page, base, prefix, title, id) {
  await page.goto(base+prefix+'/title/'+id);
  await page.getByRole('button',{name:'Add to playlist',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Save to playlist'});
  await dialog.getByRole('button',{name:'Playlist',exact:true}).click();
  await dialog.getByRole('option',{name:title,exact:true}).click();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByText('Saved to '+title+'.',{exact:true}).waitFor();
}
async function removeItem(page, title) {
  await page.getByRole('button',{name:'Options for '+title,exact:true}).click();
  await page.getByRole('menuitem',{name:'Remove from playlist',exact:true}).click();
}
try {
  if(existsSync(join(repo,'dist/server.js'))) {
    process.env.VIRELO_LOG_LEVEL='silent';
    const {createVireloServer}=await import(pathToFileURL(join(repo,'dist/server.js')).href);
    server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[],host:'127.0.0.1',port:0});
    server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
    server.db.addLibrary(media,'Test clips');
    for(const item of items) { const {id,source_path,liked,progress_position,added_at,updated_at,...input}=item; server.db.upsertMedia(input); }
    await server.app.listen({host:'127.0.0.1',port:0});modes.push(['npm','http://127.0.0.1:'+server.app.server.address().port]);
  }
  const webRepo=process.env.VIRELO_TEST_WEB_REPO || (!modes.length?repo:null);
  if(webRepo)modes.push(['web',await serveWeb(resolve(webRepo))]);
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required','--no-proxy-server']});
  for(const [mode,base] of modes) for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['small',320,780]].filter(size=>!process.env.VIRELO_TEST_PLAYLIST_SCENARIO||size[0]===process.env.VIRELO_TEST_PLAYLIST_SCENARIO)) {
    const label=mode+' '+name, prefix=mode==='web'?'/app':'', title='Evening '+name;
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce'});
    const page=lastPage=await context.newPage(), errors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
    if(mode==='npm') {
      const status=await(await page.request.get(base+'/api/auth/status')).json();
      const auth=await page.request.post(base+(status.setupRequired?'/api/auth/setup':'/api/auth/login'),{headers:{'X-Virelo-Request':'1'},data:{username:'audit',password:'1'}});
      assert.equal(auth.status(),200,await auth.text());
      await page.goto(base+'/settings');
      for(const row of await call(page,mode,'playlists'))await call(page,mode,'deletePlaylist',row.id,row.revision);
    } else {
      await page.route(base+'/__playlist-seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
      await page.goto(base+'/__playlist-seed');
      await page.evaluate(async items=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('virelo-web',1);request.onupgradeneeded=()=>{for(const name of ['libraries','media','thumbnails'])request.result.createObjectStore(name,{keyPath:'id'});request.result.createObjectStore('settings');};
        request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('media','readwrite');items.forEach(item=>tx.objectStore('media').put(item));tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
      }),items);
      await page.route(base+'/__playlist-fixture.mp4',route=>route.fulfill({body:bytes,contentType:'video/mp4'}));
      await page.route(url=>url.pathname==='/src/api.ts'&&!url.search,async route=>{
        const response=await route.fetch();await route.fulfill({response,body:await response.text()+`
const files=new Map(),urls=new Map();
api.mediaFile=async id=>{if(!files.has(id))files.set(id,fetch('/__playlist-fixture.mp4').then(r=>r.blob()).then(b=>new File([b],'clip-'+id+'.mp4',{type:'video/mp4',lastModified:1})));return files.get(id);};
api.mediaSource=async id=>{if(!urls.has(id))urls.set(id,URL.createObjectURL(await api.mediaFile(id)));return urls.get(id);};
`});
      });
    }
    await page.goto(base+prefix+'/library');
    if(mode==='web') check(await page.evaluate(async()=>{const item=await(await import('/src/local-library.ts')).getStoredMedia(1);return item.liked===1&&item.progress_position===12;}),label+' upgrading browser storage preserves existing favorites and progress');
    await page.locator('.heading-controls').getByRole('link',{name:'Playlists',exact:true}).click();
    await page.getByRole('heading',{name:'Playlists',exact:true}).waitFor();
    check(true,label+' playlists are reachable from mobile and desktop libraries');
    await page.getByRole('textbox',{name:'New playlist name',exact:true}).fill('Weekend');
    await page.getByRole('button',{name:'Create playlist',exact:true}).click();
    await page.getByRole('heading',{name:'Weekend',exact:true}).waitFor();
    await page.waitForURL(/\/playlists\/\d+$/);
    const id=Number(new URL(page.url()).pathname.split('/').pop());
    check((await call(page,mode,'playlist',id)).itemCount===0,label+' creates an empty named playlist');
    await page.getByRole('textbox',{name:'Playlist name',exact:true}).fill(title);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    check((await call(page,mode,'playlist',id)).name===title,label+' renames a saved playlist');
    await addFromDetails(page,base,prefix,title,1);
    let stored=await call(page,mode,'playlist',id);
    check(stored.itemCount===1,label+' adds a video through the real save dialog');
    stored=await call(page,mode,'updatePlaylist',id,{revision:stored.revision,append:true,mediaIds:[1,2,3]});
    await page.goto(base+prefix+'/playlists/'+id);await page.reload();
    await page.getByRole('button',{name:'Reorder Clip 1',exact:true}).waitFor();
    const ids=()=>page.locator('.playback-queue-tile').evaluateAll(rows=>rows.map(row=>Number(row.dataset.queueId)));
    check(JSON.stringify(await ids())==='[1,2,3]',label+' reopening and reloading retain order without duplicates');
    check(await page.locator('video').count()===0,label+' editing does not start video playback');
    const handle=page.getByRole('button',{name:'Reorder Clip 1',exact:true});await handle.focus();await page.keyboard.press('Space');await settle(page);await page.keyboard.press('ArrowDown');await settle(page);await page.keyboard.press('Space');await settle(page);
    check(JSON.stringify(await ids())==='[2,1,3]',label+' keyboard sorting works in the playlist editor');
    check(JSON.stringify((await call(page,mode,'playlist',id)).items.map(item=>item.id))==='[1,2,3]',label+' draft edits do not silently overwrite saved order');
    await removeItem(page,'Clip 3');
    await page.getByRole('button',{name:'Undo playlist change',exact:true}).click();
    check(JSON.stringify(await ids())==='[2,1,3]',label+' queue-style bubble removal and undo work without changing the library');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('button',{name:'Save changes',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.playlist-management')?.textContent.includes('All changes saved'));
    check(JSON.stringify((await call(page,mode,'playlist',id)).items.map(item=>item.id))==='[2,1,3]',label+' explicitly saves the custom order');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' editor fits the viewport');
    await page.evaluate(()=>window.scrollTo(0,0));await settle(page);
    await page.screenshot({path:join(root,mode+'-'+name+'-editor.png')});
    await page.evaluate(()=>{Math.random=()=>.7;});
    await page.getByRole('button',{name:'Shuffle',exact:true}).click();
    await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&document.querySelector('.watch-copy h1')?.textContent==='Clip 3';});
    check(new URL(page.url()).searchParams.get('sort')==='random',label+' shuffle starts from a random selected video, not always the first');
    check(JSON.stringify((await call(page,mode,'playlist',id)).items.map(item=>item.id))==='[2,1,3]',label+' shuffle does not overwrite the saved custom order');
    await page.goto(base+prefix+'/playlists/'+id);
    await page.getByRole('button',{name:'Play all',exact:true}).click();
    await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&video.currentTime>.2;});
    check(new URL(page.url()).searchParams.get('playlistId')===String(id),label+' Play all opens this playlist rather than the full library');
    await page.locator('.player video').evaluate(video=>{window.__playlistVideo=video;window.__playlistSource=video.currentSrc;});
    await page.getByRole('button',{name:'Options for Clip 3',exact:true}).click();await page.getByRole('menuitem',{name:'Remove from queue',exact:true}).click();
    await page.getByRole('button',{name:'Save current order',exact:true}).click();
    await page.getByText('Playlist saved. Playback is unchanged.',{exact:true}).waitFor();
    check(await page.locator('.player video').evaluate(video=>video===window.__playlistVideo&&video.currentSrc===window.__playlistSource&&!video.paused),label+' saving a changed playback queue does not reload the current video');
    check((await call(page,mode,'playlist',id)).itemCount===2,label+' saving queue edits updates only this playlist');
    await page.getByRole('button',{name:'Save queue as playlist',exact:true}).click();
    const copyDialog=page.getByRole('dialog',{name:'Save to playlist'});
    await copyDialog.getByRole('textbox',{name:'Playlist name',exact:true}).fill('Travel');
    await copyDialog.getByRole('textbox',{name:'Playlist name',exact:true}).press('Enter');await copyDialog.waitFor({state:'hidden'});
    const copy=(await call(page,mode,'playlists')).find(row=>row.name==='Travel');
    check(copy?.itemCount===2,label+' saves the current queue as a separate named playlist');
    await page.goto(base+prefix+'/playlists/'+id);
    await page.getByRole('textbox',{name:'Playlist name',exact:true}).fill('Local draft');
    stored=await call(page,mode,'playlist',id);await call(page,mode,'updatePlaylist',id,{revision:stored.revision,name:'Changed elsewhere'});
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByText(/This playlist changed elsewhere/).waitFor();
    check(await page.getByRole('textbox',{name:'Playlist name',exact:true}).inputValue()==='Local draft',label+' conflicting saves keep the unsaved draft and refuse to overwrite');
    await page.getByRole('button',{name:'Reload playlist',exact:true}).click();
    const reload=page.getByRole('alertdialog',{name:'Reload playlist?'});await reload.getByRole('button',{name:'Reload',exact:true}).click();await reload.waitFor({state:'hidden'});
    await page.getByRole('heading',{name:'Changed elsewhere',exact:true}).waitFor();
    for(const clipTitle of ['Clip 2','Clip 1'])await removeItem(page,clipTitle);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.playlist-management')?.textContent.includes('All changes saved'));
    check((await call(page,mode,'playlist',id)).itemCount===0,label+' the last playlist item can be removed without deleting its video');
    await page.getByRole('button',{name:'Delete playlist',exact:true}).click();
    let dialog=page.getByRole('alertdialog',{name:'Delete playlist?'});await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await dialog.waitFor({state:'hidden'});
    check((await call(page,mode,'playlist',id)).id===id,label+' deletion can be cancelled');
    await page.getByRole('button',{name:'Delete playlist',exact:true}).click();dialog=page.getByRole('alertdialog',{name:'Delete playlist?'});await dialog.getByRole('button',{name:'Delete playlist',exact:true}).click();
    await page.getByRole('heading',{name:'Playlists',exact:true}).waitFor();
    check(!(await call(page,mode,'playlists')).some(row=>row.id===id),label+' confirmation deletes only the selected playlist');
    check((await call(page,mode,'playlist',copy.id)).itemCount===2,label+' another playlist remains intact');
    if(mode==='web') {
      check(await page.evaluate(async()=>{
        const {api}=await import('/src/api.ts');const item=await api.createPlaylist({name:'Concurrent',mediaIds:[1]});
        const results=await Promise.allSettled([api.updatePlaylist(item.id,{revision:item.revision,name:'First'}),api.updatePlaylist(item.id,{revision:item.revision,name:'Second'})]);
        const current=await api.playlist(item.id);await api.deletePlaylist(item.id,current.revision);
        return results.filter(result=>result.status==='fulfilled').length===1&&results.filter(result=>result.status==='rejected').length===1;
      }),label+' browser transactions serialize competing playlist saves');
      check(await page.evaluate(async fixture=>{
        const {api}=await import('/src/api.ts'),local=await import('/src/local-library.ts');
        let saved=await api.createPlaylist({name:'Unavailable',mediaIds:[4,1]});
        const db=await local.openDatabase();await new Promise((resolve,reject)=>{const tx=db.transaction('media','readwrite');tx.objectStore('media').delete(4);tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
        const missing=await api.playlist(saved.id);saved=await api.updatePlaylist(saved.id,{revision:saved.revision,mediaIds:[]});
        await local.saveStoredMedia(fixture);const restored=await api.playlist(saved.id);await api.deletePlaylist(saved.id,restored.revision);
        return missing.unavailableCount===1&&saved.unavailableCount===1&&restored.items.length===1&&restored.items[0].id===4;
      },items[3]),label+' temporarily unavailable browser references survive edits and reappear after restoration');
    }
    check(errors.length===0,label+' no browser exceptions: '+errors.join('; '));
    await context.close();
  }
  for(const item of items)assert.deepEqual(await readFile(item.path),bytes,'original fixture file stays unchanged');
  console.log(JSON.stringify({checks,root,result:'passed'}));
} catch(error) {
  if(lastPage&&!lastPage.isClosed()){console.error(await lastPage.locator('body').innerText());await lastPage.screenshot({path:join(root,'failure.png')}).catch(()=>{});}
  console.error('Playlist audit artifacts:',root);throw error;
} finally { await browser?.close();await server?.app.close();children.forEach(child=>child.kill()); }
