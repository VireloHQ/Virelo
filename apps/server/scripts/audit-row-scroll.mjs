import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {buildHome} from '../dist/home.js';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const repro=process.env.VIRELO_SCROLL_REPRO==='1';
let checks=0;const check=(condition,name,details)=>{checks++;if(repro){console.log(JSON.stringify({name,pass:Boolean(condition),details}));return;}assert.ok(condition,name+' '+JSON.stringify(details));};
const items=Array.from({length:90},(_,i)=>({id:i+1,library_id:1,path:'Movie '+i+'.mp4',source_path:'Movie '+i+'.mp4',filename:'Movie '+i+'.mp4',
 title:'Movie '+i,sort_title:'Movie '+i,kind:'movie',series_title:null,season:null,episode:null,year:2020,
 duration:7200,width:1920,height:1080,video_codec:'h264',audio_codec:'aac',container:'mp4',
 folder:'Collection '+String(i).padStart(2,'0'),size:1,mtime:1,added_at:i+1,updated_at:i+1,
 thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,
 progress_completed:1}));
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{})});
try{
 for(const mode of ['npm','web']){
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:900},reducedMotion:'no-preference'});
  // Only count the hook's animation frames, not React/router/browser work.
  await context.addInitScript(()=>{
   const nativeRequest=requestAnimationFrame.bind(window),nativeCancel=cancelAnimationFrame.bind(window),pending=new Set();
   window.__rowFrames=pending;
   window.requestAnimationFrame=callback=>{
    const tracked=new Error().stack.includes('/hooks/useRowWheel');
    const id=nativeRequest(time=>{pending.delete(id);callback(time);});
    if(tracked)pending.add(id);return id;
   };
   window.cancelAnimationFrame=id=>{pending.delete(id);nativeCancel(id);};
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=mode==='npm'?(process.env.VIRELO_TEST_NPM_URL||'http://127.0.0.1:5198'):(process.env.VIRELO_TEST_WEB_URL||'http://127.0.0.1:5199');
  const prefix=mode==='npm'?'':'/app';
  if(mode==='npm')await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const body=path==='/api/home'?buildHome(items):path==='/api/media'?items:path==='/api/folders'?items.map(i=>({library_id:1,folder:i.folder,count:1})):
     path==='/api/shorts'?{total:0,items:[]}:path==='/api/libraries'?[]:path==='/api/scan/status'?{running:false}:{};
   return route.fulfill({json:body});
  });
  await page.goto(base+prefix+'/settings');await page.locator('.settings-heading').waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await page.evaluate(async values=>{const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of values)await saveStoredMedia(item);},items);
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  await page.getByRole('heading',{name:'Recently added',exact:true}).waitFor();
  const state=row=>row.evaluate(el=>({left:el.scrollLeft,max:el.scrollWidth-el.clientWidth,pending:window.__rowFrames.size,snap:getComputedStyle(el).scrollSnapType,commandStart:el.__commandStart??0,step:Math.min(el.clientWidth*.86,1000)}));
  const wheel=async(row,x,y)=>{
   await row.scrollIntoViewIfNeeded();const box=await row.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+Math.min(35,box.height/2));
   await page.mouse.wheel(x,y);
  };
  for(const title of ['Recently added','Movies']){
   const row=page.getByRole('region',{name:title+' titles',exact:true});
   const section=page.locator('.media-section').filter({has:page.getByRole('heading',{name:title,exact:true})});
   const right=section.getByRole('button',{name:'Scroll '+title+' right'}),left=section.getByRole('button',{name:'Scroll '+title+' left'});
   await section.evaluate(el=>{
    const rail=el.querySelector('.media-row');
    el.addEventListener('click',event=>{if(event.target.closest('.row-controls button'))rail.__commandStart=rail.scrollLeft;},true);
    rail.addEventListener('keydown',()=>rail.__commandStart=rail.scrollLeft,true);
   });
   await row.scrollIntoViewIfNeeded();await right.click();await page.waitForTimeout(650);
   let s=await state(row);check(s.left>300,mode+' '+title+' button before wheel',s);
   await left.click();await page.waitForTimeout(650);
   check((await state(row)).left<2,mode+' '+title+' button returns to start',await state(row));
   await wheel(row,0,120);await page.waitForTimeout(400);
   s=await state(row);check(s.left>60&&s.left<190,mode+' '+title+' wheel moves continuously without snapping back',s);
   await page.waitForTimeout(850);
   s=await state(row);check(s.pending===0,mode+' '+title+' wheel animation finishes',s);
   const before=s.left;await right.click();await page.waitForTimeout(650);
   s=await state(row);check(s.left>before+300,mode+' '+title+' button works after wheel',s);
   // Interrupt active wheel easing with the opposite button.
   await wheel(row,0,650);await page.waitForTimeout(30);await left.click();await page.waitForTimeout(750);
   s=await state(row);check(s.pending===0&&Math.abs(s.left-Math.max(0,s.commandStart-s.step))<2,mode+' '+title+' opposite button cancels active wheel',s);
   await wheel(row,0,420);await page.waitForTimeout(40);
   await row.focus();await page.keyboard.press('ArrowLeft');await page.waitForTimeout(750);
   s=await state(row);check(s.pending===0&&Math.abs(s.left-Math.max(0,s.commandStart-s.step))<2,mode+' '+title+' keyboard cancels wheel',s);
   // Horizontal trackpad input stays native and cancels vertical-wheel inertia.
   await wheel(row,0,420);await page.waitForTimeout(30);await wheel(row,-450,0);await page.waitForTimeout(600);
   s=await state(row);check(s.pending===0,mode+' '+title+' horizontal trackpad does not fight wheel animation',s);
   await row.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
   await page.waitForTimeout(100);
   await row.evaluate(el=>{
    const event=new WheelEvent('wheel',{deltaY:200,ctrlKey:true,bubbles:true,cancelable:true});el.dispatchEvent(event);
    window.__pinchPrevented=event.defaultPrevented;
   });
   check(await page.evaluate(()=>!window.__pinchPrevented),mode+' '+title+' pinch zoom is not intercepted');
   await row.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:2,bubbles:true,cancelable:true})));
   await page.waitForTimeout(200);
   s=await state(row);check(s.left>=1&&s.left<=3&&s.pending===0,mode+' '+title+' subpixel easing cannot stall',s);
   await row.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
   await row.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:400,bubbles:true,cancelable:true})));
   await page.waitForTimeout(45);const reversalStart=(await state(row)).left;
   await row.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:-60,bubbles:true,cancelable:true})));
   await page.waitForTimeout(160);
   s=await state(row);check(s.left<reversalStart-35,mode+' '+title+' reversing wheel changes direction immediately',s);
   await page.waitForTimeout(850);
   s=await state(row);check(s.pending===0,mode+' '+title+' reversed animation terminates',s);
   await row.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
   await row.evaluate(el=>{
    el.dispatchEvent(new WheelEvent('wheel',{deltaY:3,deltaMode:1,bubbles:true,cancelable:true}));
    el.dispatchEvent(new WheelEvent('wheel',{deltaY:.25,deltaMode:2,bubbles:true,cancelable:true}));
   });
   await page.waitForTimeout(700);
   s=await state(row);const normalized=48+await row.evaluate(el=>el.clientWidth*.25);
   check(Math.abs(s.left-normalized)<2&&s.pending===0,mode+' '+title+' line and page wheel deltas normalize',s);
   await row.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
   await page.emulateMedia({reducedMotion:'reduce'});
   await row.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:160,bubbles:true,cancelable:true})));
   s=await state(row);check(s.left>=150&&s.pending===0,mode+' '+title+' reduced motion is immediate',s);
   await page.emulateMedia({reducedMotion:'no-preference'});
   await row.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));
   await wheel(row,0,400);await page.waitForTimeout(25);
   await row.dispatchEvent('pointerdown',{pointerType:'touch',bubbles:true});await page.waitForTimeout(100);
   s=await state(row);check(s.pending===0,mode+' '+title+' touch takes over active wheel',s);
   await row.evaluate(el=>el.dispatchEvent(new WheelEvent('wheel',{deltaY:100000,bubbles:true,cancelable:true})));
   await page.setViewportSize({width:3440,height:1000});await page.waitForTimeout(1000);
   s=await state(row);check(s.pending===0&&Math.abs(s.left-s.max)<2,mode+' '+title+' resized animation clamps and finishes',s);
   await page.setViewportSize({width:1440,height:900});await page.waitForTimeout(100);
   // At either end, outward wheel input must remain available for page scrolling.
   await row.evaluate(el=>el.scrollTo({left:el.scrollWidth,behavior:'instant'}));await page.waitForTimeout(100);
   const allowed=await row.evaluate(el=>{
    const event=new WheelEvent('wheel',{deltaY:300,bubbles:true,cancelable:true});el.dispatchEvent(event);return !event.defaultPrevented;
   });
   check(allowed,mode+' '+title+' end-of-row releases page scroll');
   await left.click();await page.waitForTimeout(650);
   s=await state(row);check(s.left<s.max-300,mode+' '+title+' button works at the far end',s);
  }
  // The shared hook must also retain folder rail scrolling.
  const recent=page.getByRole('region',{name:'Recently added titles'});
  await recent.evaluate(el=>el.scrollTo({left:0,behavior:'instant'}));await wheel(recent,0,700);
  await page.getByRole('link',{name:'Library',exact:true}).first().click();
  check(await page.evaluate(()=>window.__rowFrames.size===0),mode+' navigating away cancels shelf animation');
  const folders=page.locator('.folder-row').filter({has:page.getByRole('button',{name:/Collection 00/})});
  await folders.waitFor();await wheel(folders,0,300);await page.waitForTimeout(1100);
  let s=await state(folders);check(s.left>250&&s.pending===0,mode+' folder rail still scrolls',s);
  await wheel(folders,-300,0);await page.waitForTimeout(350);
  s=await state(folders);check(s.pending===0,mode+' folder rail horizontal wheel stays native',s);
  check(errors.length===0,mode+' no runtime errors',errors);
  await context.close();
  const touchContext=await browser.newContext({serviceWorkers:'block',isMobile:true,hasTouch:true,viewport:{width:390,height:844}});
  const touchPage=await touchContext.newPage();
  if(mode==='npm')await touchPage.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   return route.fulfill({json:path==='/api/home'?buildHome(items):path==='/api/shorts'?{total:0,items:[]}:path==='/api/libraries'?[]:path==='/api/scan/status'?{running:false}:{}});
  });
  await touchPage.goto(base+prefix+'/settings');await touchPage.locator('.settings-heading').waitFor();
  await touchPage.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await touchPage.evaluate(async values=>{
   const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of values)await saveStoredMedia(item);
  },items);
  await touchPage.getByRole('link',{name:'Home',exact:true}).first().click();
  const touchRow=touchPage.getByRole('region',{name:'Recently added titles'});
  await touchRow.waitFor();await touchRow.scrollIntoViewIfNeeded();
  const touchState=await touchRow.evaluate(el=>{
   const event=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});el.dispatchEvent(event);
   return {snap:getComputedStyle(el).scrollSnapType,fine:matchMedia('(hover:hover) and (pointer:fine)').matches,prevented:event.defaultPrevented};
  });
  check(!touchState.fine&&touchState.snap!=='none',mode+' touch retains native snap',touchState);
  check(!touchState.prevented,mode+' touch-only device does not translate vertical page wheel');
  const cdp=await touchContext.newCDPSession(touchPage),box=await touchRow.boundingBox();
  const start=box.x+Math.min(box.width-30,300),y=box.y+25;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:start,y}]});
  for(let step=1;step<=8;step++){
   await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:start-step*22,y}]});await touchPage.waitForTimeout(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await touchPage.waitForTimeout(800);
  check(await touchRow.evaluate(el=>el.scrollLeft)>30,mode+' native touch swipe scrolls shelf');
  await touchContext.close();
 }
 console.log(JSON.stringify({result:repro?'reproduction':'passed',checks}));
}finally{await browser.close();}
