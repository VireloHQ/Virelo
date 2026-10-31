import assert from 'node:assert/strict';
import { auditPlaylistField } from './helpers/playlist-field-audit.mjs';
import { auditPlaylistListLayout } from './helpers/compact-library-audit.mjs';
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
const thumbnail=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-i',clip,'-frames:v','1','-f','image2pipe','-c:v','png','pipe:1'],{windowsHide:true});
for (let index = 0; index < 4; index++) {
  const folder=index===3?'Shows/Season 1':'';
  const directory=join(media,folder);if(folder)await mkdir(directory,{recursive:true});
  const path = join(directory, 'Clip-' + (index + 1) + '.mp4'); await writeFile(path, bytes);
  items.push({ id:index+1,library_id:1,path,source_path:path,filename:'Clip-'+(index+1)+'.mp4',title:'Clip '+(index+1),sort_title:'Clip '+(index+1),kind:'video',
    duration:120,width:320,height:180,video_codec:'h264',audio_codec:'aac',container:'mp4',folder,size:bytes.length,mtime:1,
    thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,series_title:null,season:null,episode:null,year:null,
    added_at:1,updated_at:1,liked:index===0?1:0,progress_position:index===0?12:0 });
}
const children = [], modes = [];
let server, browser, lastPage, checks = 0;
const check = (value, label) => { assert.ok(value,label); checks++; console.log('PASS',label); };
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function auditWatchActions(page, label) {
  const bar=page.locator('.watch-info-actions'), queue=page.locator('.playback-queue');
  check(await bar.getByRole('button',{name:'Add to playlist',exact:true}).count()===1,label+' the video has its own Add to playlist action');
  check(await bar.getByText(/Save current order|Save queue as playlist/).count()===0,label+' queue-wide saves do not crowd the video action bar');
  check(await bar.locator('button').evaluateAll(buttons=>{
    const rows=new Set(buttons.map(button=>Math.round(button.getBoundingClientRect().top)));
    return rows.size<=2 && buttons.every(button=>{
      const rect=button.getBoundingClientRect();return rect.height===48 && rect.left>=0 && rect.right<=innerWidth;
    });
  }),label+' video actions have equal heights and fit in at most two rows');
  check(await queue.locator('h2 a').count()===1,label+' the playlist link belongs to the queue heading');
  check(await queue.locator('h2 a').evaluate(link=>{
    const rect=link.getBoundingClientRect(),parent=link.closest('.playback-queue-head').getBoundingClientRect();
    return rect.left>=parent.left && rect.right<=parent.right && rect.width>0;
  }),label+' the playlist heading fits beside the queue controls');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' watch layout has no horizontal overflow');
}
async function serveWeb(directory) {
  const child=spawn(process.execPath,[join(directory,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:directory,windowsHide:true,stdio:['ignore','pipe','pipe']}); children.push(child);
  return new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(new Error(log)),20000);child.once('error',reject);child.stderr.on('data',data=>{log+=data;});child.stdout.on('data',data=>{log+=String(data).replace(/\x1b\[[0-9;]*m/g,'');const url=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});});
}
async function call(page, mode, method, ...args) {
  return page.evaluate(async ({mode,method,args}) => {
    if (mode==='web') return (await import('/src/api.ts')).api[method](...args);
    const urls={libraries:['GET','/api/libraries'],mediaById:['GET','/api/media/'+args[0]],renameLibrary:['PATCH','/api/libraries/'+args[0],{label:args[1],folder:args[2]??''}],playlists:['GET','/api/playlists'],playlist:['GET','/api/playlists/'+args[0]],
      createPlaylist:['POST','/api/playlists',args[0]],updatePlaylist:['PATCH','/api/playlists/'+args[0],args[1]],deletePlaylist:['DELETE','/api/playlists/'+args[0],{revision:args[1]}]};
    const [verb,url,body]=urls[method], response=await fetch(url,{method:verb,headers:{'content-type':'application/json','x-virelo-request':'1'},...(body?{body:JSON.stringify(body)}:{})});
    if(!response.ok)throw new Error(await response.text());return response.json();
  },{mode,method,args});
}
async function auditLibraryNames(page,mode,base,prefix,label) {
  await call(page,mode,'renameLibrary',1,'Test clips');
  await call(page,mode,'renameLibrary',1,'Shows','Shows');
  await call(page,mode,'renameLibrary',1,'Season 1','Shows/Season 1');
  const before=await call(page,mode,'mediaById',4);
  await page.goto(base+prefix+'/library');
  const library=page.getByRole('navigation',{name:'Library selection',exact:true}).locator('.folder-control').first();
  await library.locator('.folder-chip').click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).waitFor();
  check(await page.getByRole('menu').evaluate(menu=>{const row=menu.querySelector('button'),icon=row.querySelector('svg');return row.offsetHeight>=44&&getComputedStyle(row).display==='flex'&&parseFloat(getComputedStyle(icon).width)>=16;}),label+' folder context actions retain player-menu styling on a direct Library load');
  await page.getByRole('menu').screenshot({path:join(root,mode+'-'+label.split(' ').at(-1)+'-folder-context.png')});
  await page.keyboard.press('Escape');
  check(await library.locator('.folder-chip').evaluate(element=>element===document.activeElement),label+' folder context menu restores focus on Escape');
  await library.locator('.folder-chip').click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Rename library',exact:true});await dialog.waitFor();
  await auditPlaylistField(page,dialog.getByRole('textbox',{name:'Display name',exact:true}),label+' library name',check);
  await dialog.getByRole('textbox',{name:'Display name',exact:true}).fill('');await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await dialog.getByText('Enter a name with 1–200 characters.',{exact:true}).waitFor();
  const rootName='Library '+label;
  await dialog.getByRole('textbox',{name:'Display name',exact:true}).fill(rootName);await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.getByRole('heading',{name:rootName,exact:true}).waitFor();
  check(true,label+' a single registered library can be renamed from its context menu');
  const folders=page.getByRole('navigation',{name:'Folder navigation',exact:true});
  let child=folders.locator('.folder-control').filter({hasText:'Shows'}).first();
  await child.locator('.folder-chip').click({button:'right'});await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Rename folder',exact:true});await dialog.waitFor();
  const series='Series '+label;
  await dialog.getByRole('textbox',{name:'Display name',exact:true}).fill(series);await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  child=folders.locator('.folder-control').filter({hasText:series}).first();await child.locator('.folder-chip').click();await page.getByRole('heading',{name:series,exact:true}).waitFor();
  const seasonButton=folders.locator('.folder-control').filter({hasText:'Season 1'}).first().locator('.folder-chip');
  await seasonButton.waitFor();
  check(await seasonButton.isVisible(),label+' renamed parent folders retain their nested directory');
  await seasonButton.focus();await page.keyboard.press('Shift+F10');await page.getByRole('menuitem',{name:'Rename',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Rename folder',exact:true});await dialog.waitFor();
  check(await dialog.evaluate(element=>element.closest('.virelo-confirm-backdrop').dataset.animate==='false'),label+' keyboard folder rename uses the shared dialog without pointer animation');
  const season='Season '+label;
  await dialog.getByRole('textbox',{name:'Display name',exact:true}).fill(season);await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await folders.locator('.folder-control').filter({hasText:season}).first().locator('.folder-chip').click();await page.getByRole('heading',{name:season,exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelectorAll('.media-card').length===1);
  check(await page.locator('.media-card').count()===1,label+' renamed leaf folders retain their physical filter and video membership');
  check(await folders.locator('.crumb').filter({hasText:series}).count()===1,label+' breadcrumb labels retain physical folder identity');
  await page.reload();await page.getByRole('heading',{name:rootName,exact:true}).waitFor();
  check(await folders.locator('.folder-control').filter({hasText:series}).count()===1,label+' display names persist after reload');
  const renamed=(await call(page,mode,'libraries')).find(library=>library.id===1);
  check(renamed.folderLabels.Shows===series&&renamed.folderLabels['Shows/Season 1']===season,label+' nested labels are stored per library and original relative path');
  const after=await call(page,mode,'mediaById',4);
  check(['id','path','folder','liked','progress_position','progress_duration'].every(key=>before[key]===after[key]),label+' rename preserves video IDs, paths, favorites and progress');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' folder controls fit the viewport');
  await page.locator('.splash-screen').waitFor({state:'hidden'});await page.screenshot({path:join(root,mode+'-'+label.split(' ').at(-1)+'-library-names.png')});
}
async function addFromDetails(page, base, prefix, title, id, label) {
  await page.goto(base+prefix+'/title/'+id);
  const detail=page.locator('.detail-main');await detail.waitFor();
  check(await detail.evaluate(element=>{
    const copy=element.querySelector('.detail-copy');
    return innerWidth<=900||Math.abs(element.getBoundingClientRect().right-copy.getBoundingClientRect().right)<1;
  }),label+' detail copy uses the available horizontal space');
  check(await detail.locator('h1').evaluate(element=>getComputedStyle(element).textWrapStyle!=='balance'),label+' title wraps naturally instead of balancing into short lines');
  await page.getByRole('button',{name:'Add to playlist',exact:true}).click();
  const before = await page.locator('.save-playlist').boundingBox();
  const dialog=page.getByRole('dialog',{name:'Save to playlist'});
  await dialog.getByRole('button',{name:'Playlist',exact:true}).click();
  await dialog.getByRole('option',{name:title,exact:true}).click();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.getByText('Saved to '+title+'.',{exact:true}).waitFor();
  check(await page.locator('.playlist-save-notice').evaluate(element => getComputedStyle(element).position === 'fixed' && !element.closest('.save-playlist')), label+' saved feedback is outside the action row');
  const after = await page.locator('.save-playlist').boundingBox();
  check(Math.abs(before.width-after.width)<1 && Math.abs(before.height-after.height)<1, label+' saving does not change the action button layout');
  await page.locator('.playlist-save-notice').waitFor({state:'hidden',timeout:5000});
  check(true,label+' playlist save feedback dismisses automatically');
}
async function removeItem(page, title) {
  await page.getByRole('button',{name:'Options for '+title,exact:true}).click();
  await page.getByRole('menuitem',{name:'Remove from playlist',exact:true}).click();
}
async function addFromContext(page,mode,base,prefix,label) {
  await page.goto(base+prefix+'/library');
  const card=page.locator('.media-card').filter({hasText:'Clip 4'}).first();
  const open=async()=>{
    await card.click({button:'right'});
    const menu=page.getByRole('menu',{name:'Clip 4 actions',exact:true});
    await menu.waitFor();return menu;
  };
  let menu=await open();
  check(await menu.getByRole('menuitem',{name:'Add to playlist',exact:true}).locator('svg').count()===1,label+' card context has a playlist action with an icon');
  await menu.getByRole('menuitem',{name:'Add to playlist',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Save to playlist',exact:true});await dialog.waitFor();
  check(await page.getByRole('menu',{name:'Clip 4 actions',exact:true}).count()===0,label+' playlist dialog replaces the menu without navigating to details');
  check(new URL(page.url()).pathname===prefix+'/library',label+' dialog clicks do not follow the enclosing video-card link');
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.classList.contains('media-card'));
  check(await card.evaluate(element=>element===document.activeElement),label+' Escape restores focus to the originating video');
  menu=await open();await menu.press('End');await page.keyboard.press('Enter');
  dialog=page.getByRole('dialog',{name:'Save to playlist',exact:true});await dialog.waitFor();
  check(await dialog.evaluate(element=>element.closest('.virelo-confirm-backdrop').dataset.animate==='false'),label+' keyboard playlist action opens without pointer animation');
  const title='Context '+label;
  await dialog.getByRole('textbox',{name:'Playlist name',exact:true}).fill(title);
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.activeElement?.classList.contains('media-card'));
  const saved=(await call(page,mode,'playlists')).find(row=>row.name===title);
  check(Boolean(saved)&&(await call(page,mode,'playlist',saved.id)).items.map(item=>item.id).join(',')==='4',label+' context action creates a playlist containing the selected video');
  menu=await open();await menu.getByRole('menuitem',{name:'Add to playlist',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Save to playlist',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Playlist',exact:true}).click();await dialog.getByRole('option',{name:title,exact:true}).click();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const existing=await call(page,mode,'playlist',saved.id);
  check(existing.itemCount===1,label+' context action appends to an existing playlist without duplicating a video');
  const renamed=title+' updated';
  await call(page,mode,'updatePlaylist',existing.id,{revision:existing.revision,name:renamed});
  await page.locator('.media-card').filter({hasText:'Clip 3'}).first().click({button:'right'});
  await page.getByRole('menu',{name:'Clip 3 actions',exact:true}).getByRole('menuitem',{name:'Add to playlist',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Save to playlist',exact:true});await dialog.waitFor();
  await dialog.getByRole('button',{name:'Playlist',exact:true}).click();await dialog.getByRole('option',{name:renamed,exact:true}).click();
  await dialog.getByRole('button',{name:'Save',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const appended=await call(page,mode,'playlist',saved.id);
  check(appended.name===renamed,label+' context dialog refreshes a recently cached playlist changed elsewhere');
  check(appended.items.map(item=>item.id).join(',')==='4,3',label+' a different card adds its own video to the existing playlist');
  check(new URL(page.url()).pathname===prefix+'/library',label+' saving from context leaves the library open');
  await call(page,mode,'deletePlaylist',appended.id,appended.revision);
}
try {
  if(existsSync(join(repo,'dist/server.js'))) {
    process.env.VIRELO_LOG_LEVEL='silent';
    const {createVireloServer}=await import(pathToFileURL(join(repo,'dist/server.js')).href);
    server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[],host:'127.0.0.1',port:0});
    server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
    server.db.addLibrary(media,'Test clips');
    for(const item of items) { const {id,source_path,liked,progress_position,added_at,updated_at,...input}=item; server.db.upsertMedia(input); }
    const artwork=join(root,'data','thumbnails','fixture.png');await writeFile(artwork,thumbnail);
    for(const id of [1,2])server.db.updateTechnicalMetadata(id,{thumbnail_path:artwork});
    await server.app.listen({host:'127.0.0.1',port:0});modes.push(['npm','http://127.0.0.1:'+server.app.server.address().port]);
  }
  const webRepo=process.env.VIRELO_TEST_WEB_REPO || (!modes.length?repo:null);
  if(webRepo)modes.push(['web',await serveWeb(resolve(webRepo))]);
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required','--no-proxy-server']});
  for(const [mode,base] of modes) for(const [name,width,height] of [['desktop',1440,900],['mobile',390,844],['small',320,780]].filter(size=>!process.env.VIRELO_TEST_PLAYLIST_SCENARIO||size[0]===process.env.VIRELO_TEST_PLAYLIST_SCENARIO)) {
    const label=mode+' '+name, prefix=mode==='web'?'/app':'', title='Evening '+name;
    const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height},isMobile:width<600,hasTouch:width<600,reducedMotion:'reduce'});
    const page=lastPage=await context.newPage(), errors=[];page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.stack||error.message));
    if(mode==='npm') {
      const status=await(await page.request.get(base+'/api/auth/status')).json();
      const auth=await page.request.post(base+(status.setupRequired?'/api/auth/setup':'/api/auth/login'),{headers:{'X-Virelo-Request':'1'},data:{username:'audit',password:'1'}});
      assert.equal(auth.status(),200,await auth.text());
      await page.goto(base+'/settings');
      for(const row of await call(page,mode,'playlists'))await call(page,mode,'deletePlaylist',row.id,row.revision);
    } else {
      await page.route(base+'/__playlist-seed',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
      await page.goto(base+'/__playlist-seed');
      await page.route(base+'/__playlist-thumbnail.png',route=>route.fulfill({body:thumbnail,contentType:'image/png'}));
      await page.evaluate(async()=>{window.__playlistThumbnail=await(await fetch('/__playlist-thumbnail.png')).blob();});
      await page.evaluate(async items=>new Promise((resolve,reject)=>{
        const request=indexedDB.open('virelo-web',1);request.onupgradeneeded=()=>{for(const name of ['libraries','media','thumbnails'])request.result.createObjectStore(name,{keyPath:'id'});request.result.createObjectStore('settings');};
        request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction(['media','libraries','thumbnails'],'readwrite');items.forEach(item=>tx.objectStore('media').put(item));for(const id of [1,2])tx.objectStore('thumbnails').put({id,blob:window.__playlistThumbnail});tx.objectStore('libraries').put({id:1,label:'Test clips',path:'Test clips',created_at:1,persistent:false});tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};
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
    await auditLibraryNames(page,mode,base,prefix,label);
    await addFromContext(page,mode,base,prefix,label);
    await page.goto(base+prefix+'/library');
    if(mode==='web') check(await page.evaluate(async()=>{const item=await(await import('/src/local-library.ts')).getStoredMedia(1);return item.liked===1&&item.progress_position===12;}),label+' upgrading browser storage preserves existing favorites and progress');
    const playlistEntry=page.locator('.heading-controls').getByRole('link',{name:'Playlists',exact:true});
    await playlistEntry.waitFor();await page.evaluate(()=>document.fonts.ready);
    const entryStyle=await playlistEntry.evaluate(element=>{
      const style=getComputedStyle(element),rect=element.getBoundingClientRect();
      return {background:style.backgroundColor,border:parseFloat(style.borderTopWidth),width:rect.width,height:rect.height,left:rect.left,right:rect.right,viewport:innerWidth,icons:element.querySelectorAll('svg[aria-hidden="true"]').length};
    });
    check(entryStyle.height>=44&&entryStyle.width>=120&&entryStyle.border>=1&&entryStyle.background!=='rgba(0, 0, 0, 0)',label+' playlist entry is a filled button-sized control, not plain text');
    check(entryStyle.icons===2,label+' playlist entry includes a list icon and navigation arrow');
    check(entryStyle.left>=0&&entryStyle.right<=entryStyle.viewport&&await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' playlist navigation fits beside sorting on narrow screens');
    await page.screenshot({path:join(root,mode+'-'+name+'-library-navigation.png')});
    await playlistEntry.focus();
    check(await playlistEntry.evaluate(element=>element===document.activeElement&&getComputedStyle(element).outlineStyle!=='none'),label+' playlist navigation has a visible keyboard focus indicator');
    await page.keyboard.press('Enter');await page.getByRole('heading',{name:'Playlists',exact:true}).waitFor();
    check(true,label+' playlist navigation works with the keyboard');
    await page.goBack();await playlistEntry.waitFor();await playlistEntry.click();
    await page.getByRole('heading',{name:'Playlists',exact:true}).waitFor();
    check(true,label+' playlists are reachable from mobile and desktop libraries');
    await auditPlaylistField(page,page.getByRole('textbox',{name:'New playlist name',exact:true}),label+' create',check);
    const fieldBox=await page.getByRole('textbox',{name:'New playlist name',exact:true}).boundingBox(),createBox=await page.getByRole('button',{name:'Create playlist',exact:true}).boundingBox();
    check(Math.abs(fieldBox.height-createBox.height)<1,label+' create button and name field have the same height');
    await page.getByRole('textbox',{name:'New playlist name',exact:true}).fill('Weekend');
    await page.getByRole('button',{name:'Create playlist',exact:true}).click();
    await page.getByRole('heading',{name:'Weekend',exact:true}).waitFor();
    await page.waitForURL(/\/playlists\/\d+$/);
    const id=Number(new URL(page.url()).pathname.split('/').pop());
    const empty=await call(page,mode,'playlist',id);
    check(empty.itemCount===0&&empty.cover===null,label+' creates an empty named playlist without artwork');
    await page.goto(base+prefix+'/playlists');
    const emptyRow=page.locator('.playlist-collection a').filter({hasText:'Weekend'});
    await emptyRow.waitFor();
    check(await emptyRow.locator('.playlist-artwork svg').isVisible()&&await emptyRow.locator('img').count()===0,label+' empty playlists use a playlist-specific fallback icon');
    await page.goto(base+prefix+'/playlists/'+id);await page.getByRole('heading',{name:'Weekend',exact:true}).waitFor();
    await auditPlaylistField(page,page.getByRole('textbox',{name:'Playlist name',exact:true}),label+' rename',check);
    await page.getByRole('textbox',{name:'Playlist name',exact:true}).fill(title);
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('heading',{name:title,exact:true}).waitFor();
    check((await call(page,mode,'playlist',id)).name===title,label+' renames a saved playlist');
    await addFromDetails(page,base,prefix,title,1,label);
    let stored=await call(page,mode,'playlist',id);
    check(stored.itemCount===1,label+' adds a video through the real save dialog');
    stored=await call(page,mode,'updatePlaylist',id,{revision:stored.revision,append:true,mediaIds:[1,2,3]});
    await page.goto(base+prefix+'/playlists/'+id);await page.reload();
    await page.getByRole('button',{name:'Reorder Clip 1',exact:true}).waitFor();
    const ids=()=>page.locator('.playback-queue-tile').evaluateAll(rows=>rows.map(row=>Number(row.dataset.queueId)));
    check(JSON.stringify(await ids())==='[1,2,3]',label+' reopening and reloading retain order without duplicates');
    check(await page.locator('video').count()===0,label+' editing does not start video playback');
    const panel=page.locator('.playback-queue[data-editing]');
    await auditPlaylistListLayout(panel,label,check);
    const reset=panel.getByRole('button',{name:'Reset changes',exact:true});
    check(await panel.evaluate(element=>{const style=getComputedStyle(element);return style.borderTopStyle==='solid'&&parseFloat(style.borderTopWidth)>=1&&parseFloat(style.borderRadius)>0;}),label+' playlist videos are grouped inside a bordered panel');
    check(await panel.getByRole('heading',{name:'Playlist videos',exact:true}).isVisible(),label+' the list has its own visible heading');
    check(await panel.locator('.playback-queue-tile').evaluateAll(rows=>rows.every(row=>{const style=getComputedStyle(row);return parseFloat(style.borderTopWidth)===0&&parseFloat(style.borderBottomWidth)===0&&parseFloat(style.paddingTop)===0&&parseFloat(style.paddingBottom)===0;})),label+' video rows are compact without separator lines');
    check(await reset.isDisabled()&&await panel.getByRole('button',{name:'Playlist options',exact:true}).count()===0,label+' whole-list reset is explicit, disabled when unchanged, and not another ellipsis');
    check(await panel.getByRole('link',{name:'Add videos',exact:true}).getAttribute('href')===prefix+'/library',label+' add videos is a visible library action inside the list header');
    check(await panel.locator('.queue-item-menu').evaluateAll(buttons=>buttons.length===3&&buttons.every(button=>{const rect=button.getBoundingClientRect();return rect.width>=44&&rect.height>=44;})),label+' each video retains its own touch-sized options button');
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),label+' playlist header and rows fit without horizontal page overflow');
    await page.locator('.splash-screen').waitFor({state:'hidden'});
    await panel.screenshot({path:join(root,mode+'-'+name+'-playlist-video-list.png')});
    const handle=page.getByRole('button',{name:'Reorder Clip 1',exact:true});await handle.focus();await page.keyboard.press('Space');await settle(page);await page.keyboard.press('ArrowDown');await settle(page);await page.keyboard.press('Space');await settle(page);
    check(JSON.stringify(await ids())==='[2,1,3]',label+' keyboard sorting works in the playlist editor');
    check(JSON.stringify((await call(page,mode,'playlist',id)).items.map(item=>item.id))==='[1,2,3]',label+' draft edits do not silently overwrite saved order');
    check(await reset.isEnabled(),label+' reordering enables the list-level reset');
    await reset.click();
    check(JSON.stringify(await ids())==='[1,2,3]'&&await reset.isDisabled(),label+' explicit reset restores the original video list');
    await page.getByRole('button',{name:'Undo playlist change',exact:true}).click();
    check(JSON.stringify(await ids())==='[2,1,3]',label+' resetting the video list remains undoable');
    await removeItem(page,'Clip 3');
    await page.getByRole('button',{name:'Undo playlist change',exact:true}).click();
    check(JSON.stringify(await ids())==='[2,1,3]',label+' queue-style bubble removal and undo work without changing the library');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('button',{name:'Save changes',exact:true}).waitFor({state:'visible'});
    await page.waitForFunction(()=>document.querySelector('.playlist-management')?.textContent.includes('All changes saved'));
    check(JSON.stringify((await call(page,mode,'playlist',id)).items.map(item=>item.id))==='[2,1,3]',label+' explicitly saves the custom order');
    const ordered=await call(page,mode,'playlist',id),listed=(await call(page,mode,'playlists')).find(row=>row.id===id);
    check(ordered.cover.mediaId===2&&listed.cover.mediaId===2,label+' collection artwork follows the first video after reordering');
    await page.goto(base+prefix+'/playlists');
    const collectionRow=page.locator('.playlist-collection a').filter({hasText:title}),image=collectionRow.locator('.playlist-artwork img');
    await image.waitFor();await image.evaluate(element=>element.decode());
    check(await image.isVisible(),label+' first-video thumbnail remains visible on desktop and mobile');
    await page.locator('.splash-screen').waitFor({state:'hidden'});
    await page.screenshot({path:join(root,mode+'-'+name+'-playlist-covers.png')});
    await image.evaluate(element=>{element.src='/__missing-playlist-cover.png';});
    await image.waitFor({state:'detached'});
    check(await collectionRow.locator('.playlist-artwork svg').isVisible(),label+' a failed image falls back to the playlist icon');
    await page.goto(base+prefix+'/playlists/'+id);await page.getByRole('heading',{name:title,exact:true}).waitFor();
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
    await auditWatchActions(page,label+' horizontal');
    await page.getByRole('button',{name:'Queue options',exact:true}).click();
    check(await page.getByRole('menuitem',{name:'Save current order',exact:true}).isDisabled(),label+' an unchanged order cannot be saved again');
    await page.keyboard.press('Escape');
    await page.locator('.watch-info-actions').getByRole('button',{name:'Add to playlist',exact:true}).click();
    const singleDialog=page.getByRole('dialog',{name:'Save to playlist',exact:true});
    await singleDialog.getByRole('textbox',{name:'Playlist name',exact:true}).fill('Single video');
    await singleDialog.getByRole('button',{name:'Save',exact:true}).click();await singleDialog.waitFor({state:'hidden'});
    const single=(await call(page,mode,'playlists')).find(row=>row.name==='Single video');
    check(single?.itemCount===1&&(await call(page,mode,'playlist',single.id)).items[0].id===2,label+' Add to playlist saves only the current video, not the whole queue');
    await call(page,mode,'deletePlaylist',single.id,single.revision);
    await page.getByRole('button',{name:'Use vertical queue',exact:true}).click();
    await auditWatchActions(page,label+' vertical');
    await page.screenshot({path:join(root,mode+'-'+name+'-watch-actions.png')});
    if(name==='desktop'){
      for(const index of [0,1]){
        const row=page.locator('.playback-queue-tile').nth(index);await row.locator('.playback-queue-item').hover();
        const colors=await row.evaluate(element=>({row:getComputedStyle(element).backgroundColor,button:getComputedStyle(element.querySelector('.playback-queue-item')).backgroundColor}));
        check(colors.row!=='rgba(0, 0, 0, 0)'&&colors.button==='rgba(0, 0, 0, 0)',label+' current/upcoming hover fills the entire row without an inner block: '+JSON.stringify(colors));
      }
    }
    await page.getByRole('button',{name:'Use horizontal queue',exact:true}).click();
    await page.locator('.player video').evaluate(video=>{window.__playlistVideo=video;window.__playlistSource=video.currentSrc;});
    await page.getByRole('button',{name:'Options for Clip 3',exact:true}).click();await page.getByRole('menuitem',{name:'Remove from queue',exact:true}).click();
    await page.getByRole('button',{name:'Queue options',exact:true}).click();
    await page.getByRole('menuitem',{name:'Save current order',exact:true}).click();
    await page.waitForFunction(()=>[...document.querySelectorAll('.playback-queue [role="status"]')].some(status=>status.textContent==='Saved'));
    check(await page.locator('.player video').evaluate(video=>video===window.__playlistVideo&&video.currentSrc===window.__playlistSource&&!video.paused),label+' saving a changed playback queue does not reload the current video');
    check((await call(page,mode,'playlist',id)).itemCount===2,label+' saving queue edits updates only this playlist');
    const queueOptions=page.getByRole('button',{name:'Queue options',exact:true});
    await queueOptions.focus();await page.keyboard.press('Enter');
    const saveCopy=page.getByRole('menuitem',{name:'Save queue as playlist',exact:true});
    await saveCopy.focus();await page.keyboard.press('Enter');
    const copyDialog=page.getByRole('dialog',{name:'Save to playlist'});
    await auditPlaylistField(page,copyDialog.getByRole('textbox',{name:'Playlist name',exact:true}),label+' save dialog',check);
    await copyDialog.getByRole('textbox',{name:'Playlist name',exact:true}).fill('Travel');
    await copyDialog.getByRole('textbox',{name:'Playlist name',exact:true}).press('Enter');await copyDialog.waitFor({state:'hidden'});
    const copy=(await call(page,mode,'playlists')).find(row=>row.name==='Travel');
    check(copy?.itemCount===2,label+' saves the current queue as a separate named playlist');
    check(await queueOptions.evaluate(button=>button===document.activeElement),label+' saving from Queue options returns keyboard focus to the queue');
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
        return missing.unavailableCount===1&&missing.cover?.mediaId===1&&saved.unavailableCount===1&&saved.cover===null&&restored.items.length===1&&restored.items[0].id===4&&restored.cover?.mediaId===4&&restored.cover.url===null;
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
