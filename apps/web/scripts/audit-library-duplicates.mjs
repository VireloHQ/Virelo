import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-folder-duplicates-'));
const clip=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=10:d=0.5','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'],{windowsHide:true});
for(const name of ['Fallback','OtherFallback']){await mkdir(join(root,name));await writeFile(join(root,name,'clip.mp4'),clip);}
const child=spawn(process.execPath,[join(repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser;
try {
  const base=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error(output)),20000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.stderr.on('data',chunk=>output+=chunk);
    child.stdout.on('data',chunk=>{output+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),errors=[];
  await context.route('**/__fixture.mp4',route=>route.fulfill({body:clip,contentType:'video/mp4'}));
  const initialize=async current=>{
    current.on('pageerror',error=>errors.push(error.message));current.setDefaultTimeout(15000);
    await current.goto(base+'/app/settings#libraries');await current.locator('.settings-heading').waitFor();
    await current.evaluate(async()=>{
      const source=await(await fetch('/src/api.ts')).text(),path=source.match(/from\s+["']([^"']*local-library[^"']*)["']/)?.[1]||'/src/local-library.ts';
      window.library=await import(path);window.api=(await import('/src/api.ts')).api;
      window.directory=async(parent,name='Media')=>{const root=await navigator.storage.getDirectory(),outer=await root.getDirectoryHandle(parent,{create:true});return outer.getDirectoryHandle(name,{create:true});};
      window.pick=async(parent,name='Media')=>{const handle=await window.directory(parent,name);window.showDirectoryPicker=async()=>handle;return window.library.addLocalLibrary();};
    });
  };
  await initialize(page);
  const original=await page.evaluate(async()=>{
    const a=await window.directory('A'),file=await a.getFileHandle('clip.mp4',{create:true}),writer=await file.createWritable();await writer.write(await(await fetch('/__fixture.mp4')).blob());await writer.close();
    const first=await window.pick('A'),item=(await window.library.listStoredMedia())[0];
    await window.library.updateStoredMedia(item.id,row=>{row.liked=1;row.progress_position=12;row.progress_duration=60;});
    const playlist=await window.api.createPlaylist({name:'Keep this',mediaIds:[item.id]});
    await window.api.renameLibrary(first.id,'Custom media name');
    const again=await window.pick('A');return {id:first.id,again:again.id,label:again.label,itemId:item.id,playlistId:playlist.id};
  });
  assert.equal(original.again,original.id);
  assert.equal(original.label,'Custom media name','re-registering a handle preserves its display name');
  assert.equal((await page.evaluate(()=>window.library.listLocalLibraries())).length,1);
  const other=await page.evaluate(()=>window.pick('B'));assert.notEqual(other.id,original.id,'same names are allowed for distinct real directories');
  const state=await page.evaluate(async({itemId,playlistId})=>({item:(await window.library.listStoredMedia()).find(item=>item.id===itemId),playlist:await window.api.playlist(playlistId)}),original);
  assert.equal(state.item.liked,1);assert.equal(state.item.progress_position,12);assert.equal(state.playlist.items[0].id,original.itemId);
  await page.reload();await initialize(page);
  assert.equal((await page.evaluate(()=>window.pick('A'))).id,original.id,'persisted handles retain identity after reload');

  const fallback=async(current,name,reconnectId)=>{
    await current.evaluate(()=>{window.showDirectoryPicker=undefined;});
    const choosing=current.waitForEvent('filechooser');
    const result=current.evaluate(async id=>{try{return {library:await(id===undefined?window.library.addLocalLibrary():window.library.reconnectLocalLibrary(id))};}catch(error){return {error:error.message};}},reconnectId);
    await(await choosing).setFiles(join(root,name));return result;
  };
  const firstFallback=await fallback(page,'Fallback');assert.ok(firstFallback.library,JSON.stringify(firstFallback));
  const fallbackId=firstFallback.library.id;
  await page.evaluate(id=>window.api.renameLibrary(id,'Custom fallback name'),fallbackId);
  assert.match((await fallback(page,'Fallback')).error,/already registered/);
  await writeFile(join(root,'Fallback','new.mp4'),clip);
  assert.match((await fallback(page,'Fallback')).error,/already registered/,'a changed selection does not evade the guard');
  const secondFallback=await fallback(page,'OtherFallback');assert.ok(secondFallback.library);
  assert.match((await fallback(page,'OtherFallback',fallbackId)).error,/already registered/,'fallback reconnect cannot replace a library with an existing folder');
  const duplicateReconnect=await page.evaluate(async id=>{const handle=await window.directory('A');window.showDirectoryPicker=async()=>handle;try{await window.library.reconnectLocalLibrary(id);return '';}catch(error){return error.message;}},fallbackId);
  assert.match(duplicateReconnect,/already registered/);
  assert.equal((await page.evaluate(()=>window.library.listLocalLibraries())).find(library=>library.id===fallbackId).path,'Fallback','failed reconnect leaves the original registration intact');
  const restoredFallback=(await fallback(page,'Fallback',fallbackId)).library;
  assert.equal(restoredFallback.id,fallbackId);
  assert.equal(restoredFallback.label,'Custom fallback name','reconnecting files preserves a custom display name');
  await page.reload();await initialize(page);
  assert.match((await fallback(page,'Fallback')).error,/already registered/,'fallback duplicate checks survive reload');

  const sessionOnly=await page.evaluate(async()=>{
    const originalPut=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='libraries'&&value?.handle)throw new DOMException('Handle storage unavailable','DataCloneError');return originalPut.call(this,value,...args);};
    try {const first=await window.pick('Session','Session only'),second=await window.pick('Session','Session only');return {first,second};}
    finally{IDBObjectStore.prototype.put=originalPut;}
  });
  assert.equal(sessionOnly.first.id,sessionOnly.second.id);assert.equal(sessionOnly.first.persistent,false);
  const before=(await page.evaluate(()=>window.library.listLocalLibraries())).length;
  const tab=await context.newPage();await initialize(tab);
  const simultaneous=await Promise.all([page.evaluate(()=>window.pick('Concurrent','Concurrent')),tab.evaluate(()=>window.pick('Concurrent','Concurrent'))]);
  assert.equal(simultaneous[0].id,simultaneous[1].id,'real Web Locks serialize registration across tabs');
  assert.equal((await page.evaluate(()=>window.library.listLocalLibraries())).length,before+1);
  const distinct=await Promise.all([page.evaluate(()=>window.pick('One','Twin')),tab.evaluate(()=>window.pick('Two','Twin'))]);assert.notEqual(distinct[0].id,distinct[1].id,'different concurrent selections never overwrite each other');
  const withoutLocks=await page.evaluate(async()=>{
    Object.defineProperty(navigator,'locks',{value:undefined,configurable:true});
    const handle=await window.directory('NoLocks','No locks');window.showDirectoryPicker=async()=>handle;
    return Promise.all([window.library.addLocalLibrary(),window.library.addLocalLibrary()]);
  });
  assert.equal(withoutLocks[0].id,withoutLocks[1].id,'same-page edits stay serialized without Web Locks');
  const cancelled=await page.evaluate(async()=>{window.showDirectoryPicker=async()=>{throw new DOMException('Cancelled','AbortError');};try{await window.library.addLocalLibrary();}catch(error){return error.name;}});assert.equal(cancelled,'AbortError');
  await page.reload();await initialize(page);
  await page.bringToFront();
  await page.evaluate(()=>{window.cancelledPicker=false;window.showDirectoryPicker=async()=>{window.cancelledPicker=true;throw new DOMException('Cancelled','AbortError');};});
  await page.getByRole('button',{name:'Add folder',exact:true}).click();
  await page.waitForFunction(()=>window.cancelledPicker);
  await page.evaluate(()=>{window.showDirectoryPicker=undefined;});
  const chooser=page.waitForEvent('filechooser');
  await page.locator('.library-list>div').filter({has:page.getByText('Custom fallback name',{exact:true})}).getByRole('button',{name:'Reconnect',exact:true}).click();
  await(await chooser).setFiles(join(root,'OtherFallback'));
  await page.getByRole('alert').filter({hasText:'already registered'}).waitFor();
  const count=await page.evaluate(async id=>{await window.library.removeLocalLibrary(id);const a=await window.directory('A'),file=await(await a.getFileHandle('clip.mp4')).getFile();return file.size;},original.id);
  assert.equal(count,clip.length,'registration changes never delete original files');assert.deepEqual(errors,[]);
  console.log('PASS folder identity, same-name distinct folders, persistent/session-only handles, add/reconnect/fallback guards, concurrent tabs, no-lock fallback, cancellation, personal state and read-only source files');
} finally {
  await browser?.close();child.kill();
  const target=relative(resolve(tmpdir()),resolve(root));assert.ok(target.startsWith('virelo-folder-duplicates-')&&!target.includes('..'));await rm(root,{recursive:true,force:true});
}
