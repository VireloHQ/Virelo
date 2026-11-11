import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../', import.meta.url));
const clip = execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=0.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'], { windowsHide:true });
const server = spawn(process.execPath, [fileURLToPath(new URL('bin/vite.js',import.meta.resolve('vite/package.json'))),'--host','127.0.0.1','--port','0'], { cwd:repo, windowsHide:true, stdio:['ignore','pipe','pipe'] });
let browser;
try {
  const base = await new Promise((resolve,reject) => {
    let output = ''; const timer = setTimeout(()=>reject(new Error(output)),20000);
    server.once('error',reject); server.stderr.on('data',chunk=>output+=chunk);
    server.stdout.on('data',chunk=>{output+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
  });
  browser = await chromium.launch({headless:true, executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context = await browser.newContext({serviceWorkers:'block'}), errors=[];
  await context.route(/https:\/\/(?:app\.virelo\.dev|virelo\.riyo\.me)\//, async route => {
    const url = new URL(route.request().url());
    if(url.pathname==='/__fixture.mp4') return route.fulfill({body:clip,contentType:'video/mp4'});
    const response = await route.fetch({url:base+url.pathname+url.search});
    await route.fulfill({response});
  });
  const page = await context.newPage(); page.on('pageerror',error=>errors.push(error.message)); page.setDefaultTimeout(15000);
  const loadTools = async page => page.evaluate(async()=>{
    window.library = await import('/src/local-library.ts');
    window.backup = await import('/src/browser-backup.ts');
    window.api = (await import('/src/api.ts')).api;
  });
  await page.goto('https://virelo.riyo.me/app/settings?legacy=1');
  await page.locator('.settings-heading').waitFor(); await loadTools(page);
  const original = await page.evaluate(async()=>{
    const root = await navigator.storage.getDirectory(), handle = await root.getDirectoryHandle('Migration videos',{create:true});
    const file = await handle.getFileHandle('日本語.mp4',{create:true}), writer = await file.createWritable();
    await writer.write(await(await fetch('/__fixture.mp4')).blob()); await writer.close();
    window.showDirectoryPicker = async()=>handle;
    const library = await window.library.addLocalLibrary(), item = (await window.library.listStoredMedia())[0];
    await window.library.updateStoredMedia(item.id,row=>{row.liked=1;row.progress_position=.2;row.progress_duration=.5;row.title='Saved title';});
    await window.api.renameLibrary(library.id,'My collection');
    const playlist = await window.api.createPlaylist({name:'Watch again',mediaIds:[item.id]});
    const otherRoot=await root.getDirectoryHandle('Other device',{create:true}),otherHandle=await otherRoot.getDirectoryHandle('Migration videos',{create:true});
    window.showDirectoryPicker=async()=>otherHandle;
    const second=await window.library.addLocalLibrary();
    localStorage.setItem('virelo.language.v1','en');
    localStorage.setItem('virelo.queue-layout','vertical');
    const json = await(await window.backup.exportBrowserData('library')).text();
    return {libraryId:library.id,secondLibraryId:second.id,mediaId:item.id,playlistId:playlist.id,json};
  });
  const parsed = JSON.parse(original.json);
  assert.equal(parsed.media[0].liked,1); assert.equal(parsed.libraries[0].label,'My collection');
  assert.equal(parsed.libraries.length,2);assert.equal(parsed.libraries[0].path,parsed.libraries[1].path);
  assert.ok(!original.json.includes('blob:') && !original.json.includes('"handle"') && !original.json.includes('"thumbnail_path"'));
  await page.goto('https://virelo.riyo.me/app/watch/'+original.mediaId+'?queue=true');
  await page.getByRole('heading',{name:'Virelo has moved'}).waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button',{name:'Export library backup',exact:true}).click();
  assert.equal((await download).suggestedFilename(),'virelo-library-backup.json');
  await loadTools(page);
  assert.equal(await page.evaluate(()=>window.library.listStoredMedia().then(rows=>rows.length)),1,'migration does not remove old data');

  await page.goto('https://app.virelo.dev/settings?section=backup');
  await page.getByRole('heading',{name:'Export / Import',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/settings'); await loadTools(page);
  await page.getByRole('button',{name:'Import',exact:true}).click();
  // Opening the chooser is handled through setInputFiles; no real user data is selected.
  await page.locator('input[type=file]').setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(original.json)});
  await page.getByRole('heading',{name:'Import backup?'}).waitFor();
  await Promise.all([page.waitForEvent('load'), page.getByRole('dialog').getByRole('button',{name:'Import',exact:true}).click()]);
  await page.getByRole('heading',{name:'Export / Import',exact:true}).waitFor(); await loadTools(page);
  const restored = await page.evaluate(async()=>({media:await window.library.listStoredMedia(),libraries:await window.library.listLocalLibraries(),playlists:await window.api.playlists(),layout:localStorage.getItem('virelo.queue-layout')}));
  assert.equal(restored.media[0].id,original.mediaId); assert.equal(restored.media[0].liked,1);
  assert.equal(restored.media[0].progress_position,.2); assert.equal(restored.media[0].title,'Saved title');
  assert.equal(restored.libraries[0].connected,false); assert.equal(restored.libraries[0].label,'My collection');
  assert.equal(restored.playlists[0].id,original.playlistId); assert.equal(restored.layout,'vertical');
  assert.match(await page.evaluate(async json=>{try{await window.backup.importBrowserBackup(await window.backup.readBrowserBackup(new Blob([json])));return '';}catch(error){return error.message;}},original.json),/empty browser library/);

  const reconnect = await page.evaluate(async id=>{
    const root=await navigator.storage.getDirectory(),handle=await root.getDirectoryHandle('Migration videos',{create:true});
    const file=await handle.getFileHandle('日本語.mp4',{create:true}),writer=await file.createWritable();
    await writer.write(await(await fetch('/__fixture.mp4')).blob());await writer.close();
    window.showDirectoryPicker=async()=>handle;
    const lib=await window.library.reconnectLocalLibrary(id);
    return {lib,media:await window.library.listStoredMedia()};
  }, original.libraryId);
  assert.equal(reconnect.lib.connected,true); assert.equal(reconnect.media[0].id,original.mediaId);
  assert.equal(reconnect.media[0].liked,1); assert.equal(reconnect.media[0].progress_position,.2);
  assert.equal((await page.evaluate(id=>window.api.playlist(id),original.playlistId)).items[0].id,original.mediaId);
  const duplicate=await page.evaluate(async id=>{
    const root=await navigator.storage.getDirectory(),handle=await root.getDirectoryHandle('Migration videos');window.showDirectoryPicker=async()=>handle;
    try{await window.library.reconnectLocalLibrary(id);return '';}catch(error){return error.message;}
  },original.secondLibraryId);
  assert.match(duplicate,/already registered/,'confirmed duplicate directories are still blocked');
  const second=await page.evaluate(async id=>{
    const root=await navigator.storage.getDirectory(),parent=await root.getDirectoryHandle('Other device',{create:true}),handle=await parent.getDirectoryHandle('Migration videos',{create:true});
    window.showDirectoryPicker=async()=>handle;return window.library.reconnectLocalLibrary(id);
  },original.secondLibraryId);
  assert.equal(second.connected,true);

  await page.evaluate(async()=>{
    const settings=await window.backup.readBrowserBackup(await window.backup.exportBrowserData('settings'));
    settings.preferences['virelo.queue-layout']='horizontal';await window.backup.importBrowserBackup(settings);
  });
  assert.equal(await page.evaluate(()=>localStorage.getItem('virelo.queue-layout')),'horizontal');
  assert.equal(await page.evaluate(()=>window.library.listStoredMedia().then(rows=>rows.length)),1);
  await page.getByRole('link',{name:'Library',exact:true}).first().click();
  await page.waitForURL('https://app.virelo.dev/library');
  await page.getByRole('link',{name:'Playlists',exact:true}).first().click();
  await page.waitForURL('https://app.virelo.dev/playlists');

  await page.goto('https://app.virelo.dev/settings?section=backup&lang=ja');
  await page.waitForFunction(()=>document.documentElement.lang==='ja');
  await page.locator('#settings-title-backup').waitFor();
  assert.ok(!new URL(page.url()).searchParams.has('lang'));
  await page.reload(); await page.waitForFunction(()=>document.documentElement.lang==='ja');
  const mobile=await context.newPage(); await mobile.setViewportSize({width:390,height:844});
  await mobile.goto('https://app.virelo.dev/settings?section=backup');
  await mobile.locator('#settings-title-backup').waitFor();
  assert.ok(await mobile.locator('#settings-title-backup').isVisible());
  assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));

  const empty=await browser.newContext({serviceWorkers:'block'});
  await empty.route(/https:\/\/(?:app\.virelo\.dev|virelo\.riyo\.me)\//,async route=>{const url=new URL(route.request().url());await route.fulfill({response:await route.fetch({url:base+url.pathname+url.search})});});
  const newcomer=await empty.newPage();
  await newcomer.goto('https://virelo.riyo.me/app/library?search=test');
  await newcomer.waitForURL(url=>url.origin==='https://app.virelo.dev'&&url.pathname==='/library');
  assert.equal(new URL(newcomer.url()).searchParams.get('search'),'test');
  await loadTools(newcomer);
  await newcomer.evaluate(()=>{
    window.otherEdit=window.library.editLibraries(async()=>{
      window.editStarted=true;await new Promise(resolve=>window.releaseEdit=resolve);
      const db=await window.library.openDatabase();
      await new Promise((resolve,reject)=>{const tx=db.transaction('libraries','readwrite');tx.objectStore('libraries').add({id:999,label:'Concurrent folder',path:'Concurrent folder',created_at:0,persistent:false});tx.oncomplete=resolve;tx.onabort=reject;}).finally(()=>db.close());
    });
  });
  await newcomer.waitForFunction(()=>window.editStarted);
  await newcomer.evaluate(json=>{
    window.pendingImport=window.backup.readBrowserBackup(new Blob([json])).then(value=>window.backup.importBrowserBackup(value)).then(()=>{window.importOutcome='unexpected success';},error=>{window.importOutcome=error.message;});
  },original.json);
  await newcomer.waitForFunction(async()=> (await navigator.locks.query()).pending.some(lock=>lock.name==='virelo-library-edit'));
  assert.equal(await newcomer.evaluate(()=>window.importOutcome),undefined,'import waits for ongoing folder registration');
  await newcomer.evaluate(async()=>{window.releaseEdit();await window.otherEdit;await window.pendingImport;});
  assert.match(await newcomer.evaluate(()=>window.importOutcome),/empty browser library/);
  assert.deepEqual(await newcomer.evaluate(()=>window.library.listLocalLibraries().then(rows=>rows.map(row=>row.id))),[999]);
  assert.deepEqual(errors,[]);
  console.log('PASS real IndexedDB export/import, old-origin migration, downloads, atomic overwrite guard, settings-only import, reconnect IDs/favorites/progress/playlists, canonical navigation, language handoff, mobile layout and empty-origin redirects');
} finally { await browser?.close(); server.kill(); }
