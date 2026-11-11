import {createRequire} from 'node:module';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const assets=process.env.VIRELO_TEST_SHORTS_ASSETS;
if(!assets)throw new Error('Set VIRELO_TEST_SHORTS_ASSETS to a test-only directory containing portrait.mp4.');
const video=await readFile(join(assets,'portrait.mp4'));
const dbDir=await mkdtemp(join(tmpdir(),'virelo-shorts-navigation-'));
const {VireloDB}=await import(process.env.VIRELO_TEST_DB_MODULE||'../dist/db.js');
const db=new VireloDB(dbDir);
const library=db.addLibrary(join(dbDir,'clips'),'Navigation audit');
const items=Array.from({length:95},(_,i)=>({
  library_id:library.id,path:join(library.path,'Clip '+i+'.mp4'),source_path:'Clip '+i+'.mp4',filename:'Clip '+i+'.mp4',
  title:'Clip '+i,sort_title:'clip '+i,kind:'movie',series_title:null,season:null,episode:null,year:null,
  duration:15,width:360,height:640,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:1,mtime:1,
  thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null
})).map(item=>({...item,...db.upsertMedia(item)}));
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{}),
  args:['--autoplay-policy=no-user-gesture-required']});
let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label);};
try {
 for(const mode of ['npm','web']){
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:1440,height:900}});
  const page=await context.newPage(),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  const base=(mode==='npm'?process.env.VIRELO_TEST_NPM_URL:process.env.VIRELO_TEST_WEB_URL)||('http://127.0.0.1:'+(mode==='npm'?5198:5199));
  const prefix=mode==='npm'?'':'/app';
  if(mode==='npm')await page.route('**/api/**',async route=>{
   const url=new URL(route.request().url()),path=url.pathname;
   if(path.endsWith('/stream'))return route.fulfill({body:video,contentType:'video/mp4'});
   let json={};
   if(path==='/api/shorts'){
    const params=Object.fromEntries([...url.searchParams].map(([key,value])=>[key,Number(value)]));requests.push(params);
    json=db.getShorts(params);
   }else if(path==='/api/home')json=db.getHome();
   else if(path==='/api/libraries')json=db.listLibraries();
   else if(path==='/api/settings')json=db.getSettings();
   else if(path==='/api/scan/status')json={running:false};
   else if(path.endsWith('/like'))json={ok:true,liked:route.request().postDataJSON().liked};
   return route.fulfill({json});
  });
  else{
   await page.route('**/__shorts-fixture/*',route=>route.fulfill({body:video,contentType:'video/mp4'}));
   await page.route(url=>url.pathname==='/src/api.ts'&&!url.search,async route=>{
    const response=await route.fetch();
    return route.fulfill({response,body:await response.text()+"\napi.mediaSource=async id=>'/__shorts-fixture/'+id;"});
   });
  }
  await page.goto(base+prefix+'/settings');await page.locator('.settings-heading').waitFor();
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await page.evaluate(async items=>{
   const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);
  },items);
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  const card=page.locator('.shorts-card').first();await card.waitFor();
  const href=await card.getAttribute('href'),selected=Number(new URL(href,base).searchParams.get('startId'));
  check(selected>0,mode+' card URL identifies its video');
  const active=page.locator('.short-video[tabindex="0"]');
  const expectClip=async id=>{
   await page.waitForFunction(title=>document.querySelector('.short-info h2')?.textContent===title,items.find(item=>item.id===id).title);
   await page.waitForFunction(()=>{const v=document.querySelector('.short-video[tabindex="0"]');return v&&!v.paused&&v.currentTime>.1;});
   const source=await active.evaluate(v=>v.currentSrc);
   check(source.includes(mode==='npm'?'/api/media/'+id+'/stream':'/__shorts-fixture/'+id),mode+' plays the chosen source '+id);
  };
  await card.click();await expectClip(selected);
  await page.reload();await expectClip(selected);
  await active.click();await page.waitForFunction(()=>document.querySelector('.short-video[tabindex="0"]')?.paused);
  const title=await page.locator('.short-info h2').textContent();
  await active.click({button:'right'});await page.getByRole('menuitem',{name:/Resume playback|Play now/}).click();
  await expectClip(selected);check(await page.locator('.short-info h2').textContent()===title,mode+' context Play resumes the same Short');
  const chosen=db.getShorts({seed:12345,limit:95}).items[85].id;
  await page.evaluate(async ({prefix,id})=>{const {router}=await import('/src/router.tsx');await router.navigate({to:prefix+'/shorts',search:{startId:id}});},{prefix,id:chosen});
  await expectClip(chosen);check(chosen!==selected||await page.locator('.short-slot').count()>0,mode+' same-route selection mounts a fresh feed');
  const verify=await page.evaluate(async id=>{
   const {api}=await import('/src/api.ts');
   const ordered=await api.shorts({seed:12345,limit:95});
   const pages=await Promise.all([0,40,80].map(offset=>api.shorts({seed:12345,startId:id,limit:40,offset})));
   const ids=pages.flatMap(page=>page.items.map(item=>item.id));
   const next=(await api.shorts({seed:98765,startId:id,limit:95})).items.map(item=>item.id);
   return {ids,total:pages[0].total,random:ordered.items.map(item=>item.id),next};
  },chosen);
  check(verify.total===95&&verify.ids.length===95&&new Set(verify.ids).size===95,mode+' pagination has no missing or duplicated clips');
  check(verify.ids[0]===chosen&&JSON.stringify(verify.ids.slice(1))===JSON.stringify(verify.random.filter(id=>id!==chosen)),mode+' a late-page choice is pinned before pagination');
  check(verify.next[0]===chosen&&JSON.stringify(verify.next.slice(1))!==JSON.stringify(verify.ids.slice(1)),mode+' only the first video is pinned; the rest stays randomized');
  await page.getByRole('link',{name:'Shorts',exact:true}).first().click();
  await page.waitForURL(base+prefix+'/shorts');await page.locator('.short-info h2').waitFor();
  check(!new URL(page.url()).searchParams.has('startId'),mode+' Shorts navigation clears the pinned id');
  if(mode==='npm')check(requests.some(q=>q.offset===0&&q.startId===chosen)&&requests.some(q=>q.offset===0&&q.startId===undefined),mode+' API distinguishes pinned and random entries');
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  const another=page.locator('.shorts-card').nth(1);await another.waitFor();
  const second=Number(new URL(await another.getAttribute('href'),base).searchParams.get('startId'));
  await another.click({button:'right'});await page.getByRole('menuitem',{name:/Resume playback|Play now/}).click();await expectClip(second);
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  await page.locator('a.row-link',{hasText:'View all'}).click();await page.waitForURL(base+prefix+'/shorts');
  check(!new URL(page.url()).searchParams.has('startId'),mode+' View all is still random discovery');
  await page.goto(base+prefix+'/shorts?startId=999999');
  await page.getByText('This Short is no longer available in your Shorts feed.').waitFor();
  check(await page.locator('.short-video').count()===0,mode+' missing selected video never silently plays a random replacement');
  if(mode==='web'){await page.goto(base+'/shorts?startId='+chosen);await expectClip(chosen);check(page.url().includes('/app/shorts?startId='+chosen),'web legacy redirect preserves the selected clip');}
  check(errors.length===0,mode+' no browser exceptions '+JSON.stringify(errors));
  await context.close();
 }
 console.log('Shorts navigation audit passed: '+checks+' assertions.');
}finally{
 await browser.close();db.close();
 const auditPrefix=join(tmpdir(),'virelo-shorts-navigation-');
 assert.ok(dbDir.startsWith(auditPrefix));await rm(dbDir,{recursive:true,force:true});
}
