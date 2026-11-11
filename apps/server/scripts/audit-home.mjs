import {createRequire} from 'node:module';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {buildHome} from '../dist/home.js';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const screenshots=await mkdtemp(join(tmpdir(),'virelo-home-audit-'));
const art=await readFile(process.env.VIRELO_TEST_ART||new URL('../web/public/virelo-og.png',import.meta.url)).catch(()=>null);
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{})});
let checks=0;const check=(condition,name)=>{assert.ok(condition,name);checks++;};
const fixture=(id,patch={})=>({id,library_id:1,path:'Film '+id+'.mp4',source_path:'Film '+id+'.mp4',filename:'Film '+id+'.mp4',title:'Film '+id,sort_title:'film '+id,kind:'movie',series_title:null,season:null,episode:null,year:2020,
  duration:4800,width:1920,height:1080,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:100,mtime:1,added_at:id,updated_at:id,
  thumbnail_path:null,poster_path:'/__art?id='+id,backdrop_path:'/__art?id='+id,overview:'A journey through a collection of stories, waiting to be discovered in your own library.',
  genres:'["Drama","Adventure"]',external_id:'test'+id,liked:0,...patch});
const fixtures=Array.from({length:35},(_,i)=>fixture(i+1,{duration:i%3===0?7200:4800,liked:i===3?1:0,progress_position:i===0?500:0}));
for(let i=1;i<=4;i++)fixtures.push(fixture(100+i,{kind:'series',series_title:'Northbound',season:1,episode:i,title:'Northbound episode '+i,progress_completed:i===1?1:0}));
for(let i=1;i<=4;i++)fixtures.push(fixture(200+i,{kind:'series',series_title:'The long way home',season:1,episode:i,title:'Long way episode '+i,progress_position:i===2?300:0}));
for(let i=1;i<=4;i++)fixtures.push(fixture(300+i,{kind:'series',series_title:'New horizons',season:1,episode:i,title:'Horizons episode '+i}));
fixtures.push(fixture(400,{width:720,height:1280,duration:45}));
try{
 for(const mode of ['npm','web']){
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});const page=await context.newPage();const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const base=mode==='npm'?(process.env.VIRELO_TEST_NPM_URL||'http://127.0.0.1:5198'):(process.env.VIRELO_TEST_WEB_URL||'http://127.0.0.1:5199');
  const prefix=mode==='npm'?'':'/app';
  await page.route('**/__art?*',route=>route.fulfill(art?{body:art,contentType:'image/png'}:{body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#324c65"/><circle cx="850" cy="280" r="180" fill="#739799"/></svg>',contentType:'image/svg+xml'}));
  if(mode==='npm')await page.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   const body=path==='/api/home'?buildHome(fixtures,86400000):path==='/api/shorts'?{total:1,items:fixtures.filter(i=>i.id===400)}:path==='/api/libraries'?[]:path==='/api/settings'?{}:path==='/api/scan/status'?{running:false}:{};
   if(path.includes('/artwork'))return route.fulfill(art?{body:art,contentType:'image/webp'}:{body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#324c65"/></svg>',contentType:'image/svg+xml'});
   return route.fulfill({json:body});
  });
  await page.goto(base+prefix+'/settings');await page.locator('.settings-heading').waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await page.evaluate(async items=>{const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);},fixtures);
  await page.getByRole('link',{name:'Home',exact:true}).first().click();await page.locator('.home-feature').waitFor();
  await page.waitForFunction(()=>document.querySelector('.home-feature .hero-backdrop')?.naturalWidth>1);
  check(true,mode+' feature artwork renders');
  for(const title of ['Continue watching','Up next','Not watched yet','Your favorites','Recently added','Movies','A movie in 90 minutes','Your series','Adventure','Shorts']){
   check(await page.getByRole('heading',{name:title,exact:true}).count()===1,mode+' shelf '+title);
  }
  check(await page.getByRole('heading',{name:'Drama',exact:true}).count()===0,mode+' identical genre collection omitted');
  const homeData=mode==='web'?await page.evaluate(async()=>{const {api}=await import('/src/api.ts');return api.home();}):buildHome(fixtures);
  check(homeData.nextEpisodes.length===1&&homeData.nextEpisodes[0].id===102,mode+' next episode');
  check(homeData.series.length===3,mode+' unique shows');
  check(homeData.unwatched.some(i=>i.id===301),mode+' new show starts at E1');
  const rowIds=title=>page.getByRole('region',{name:title+' titles',exact:true}).locator('a.media-card')
    .evaluateAll(cards=>cards.map(card=>Number(new URL(card.href).pathname.split('/').at(-1))));
  const recentIds=new Set(await rowIds('Recently added'));
  const movieIds=await rowIds('Movies');
  check(movieIds.length>0&&movieIds.every(id=>!recentIds.has(id)),mode+' movies complement Recent');
  check(movieIds.includes(1),mode+' older movies remain reachable before payload limit');
  const hero=await page.locator('.home-feature h1').innerText();
  await page.locator('.home-feature-dots button').nth(1).click();check((await page.locator('.home-feature h1').innerText())!==hero,mode+' feature dot selection');
  await page.getByRole('button',{name:'Movies',exact:true}).click();check(await page.getByRole('heading',{name:'Up next',exact:true}).count()===0,mode+' movies filter');
  check(await page.getByRole('heading',{name:'Your series',exact:true}).count()===0,mode+' series excluded from movies');
  check((await rowIds('Movies')).every(id=>!recentIds.has(id)),mode+' movie filter retains complementary shelf');
  await page.getByRole('button',{name:'Series',exact:true}).click();check(await page.getByRole('heading',{name:'A movie in 90 minutes',exact:true}).count()===0,mode+' series filter');
  check(await page.getByRole('heading',{name:'Up next',exact:true}).count()===1,mode+' episode shelf survives filter');
  await page.getByRole('link',{name:'Home',exact:true}).first().click();
  const row=page.getByRole('region',{name:'Not watched yet titles'});await row.scrollIntoViewIfNeeded();await row.focus();await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(100);check(await row.evaluate(e=>e.scrollLeft)>0,mode+' keyboard shelf scroll');
  const play=page.locator('.home-feature').getByRole('button',{name:/^(Play|Resume)$/});
  await play.click();await page.waitForURL('**/watch/*');check(page.url().includes('/watch/'),mode+' hero play destination');await page.goBack();await page.locator('.home-feature').waitFor();
  for(const [w,h] of [[1440,1000],[320,720],[375,812],[844,390],[3440,1440]]){
   await page.setViewportSize({width:w,height:h});await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(180);
   check(await page.locator('body').evaluate(e=>e.scrollWidth<=innerWidth+1),mode+' no page overflow '+w);
   const box=await page.locator('.home-feature .hero-actions').boundingBox();check(box.x>=0&&box.x+box.width<=w+1,mode+' hero controls fit '+w);
   await page.screenshot({path:join(screenshots,mode+'-'+w+'.png')});
   const heading=page.locator('.home-feature h1'),original=await heading.innerText();
   await heading.evaluate(e=>{e.textContent='A very long movie title '.repeat(20);});
   const featureBox=await page.locator('.home-feature').boundingBox(),actionsBox=await page.locator('.home-feature .hero-actions').boundingBox();
   check(actionsBox.y>=featureBox.y&&actionsBox.y+actionsBox.height<=featureBox.y+featureBox.height,mode+' long title preserves Play '+w);
   await heading.evaluate((e,text)=>{e.textContent=text;},original);
  }
  check(errors.length===0,mode+' no runtime errors '+errors.join('|'));
  await context.close();
  // A fresh browser context owns this small fixture database; never alter user data.
  const smallContext=await browser.newContext({serviceWorkers:'block'});
  const smallPage=await smallContext.newPage(),smallErrors=[];
  smallPage.on('pageerror',e=>smallErrors.push(e.message));
  const smallItems=Array.from({length:6},(_,i)=>fixture(i+1,{genres:null,poster_path:null,backdrop_path:null,duration:7200}));
  if(mode==='npm')await smallPage.route('**/api/**',route=>{
   const path=new URL(route.request().url()).pathname;
   return route.fulfill({json:path==='/api/home'?buildHome(smallItems):path==='/api/shorts'?{total:0,items:[]}:path==='/api/libraries'?[]:path==='/api/scan/status'?{running:false}:{}});
  });
  await smallPage.goto(base+prefix+'/settings');await smallPage.locator('.settings-heading').waitFor();
  await smallPage.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await smallPage.evaluate(async items=>{
    const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);
  },smallItems);
  await smallPage.getByRole('link',{name:'Home',exact:true}).first().click();
  await smallPage.getByRole('heading',{name:'Recently added',exact:true}).waitFor();
  check(await smallPage.getByRole('heading',{name:'Movies',exact:true}).count()===0,mode+' small library hides duplicate Movies row');
  check(await smallPage.getByRole('heading',{name:'Not watched yet',exact:true}).count()===0,mode+' reordered duplicate discovery row omitted');
  check(await smallPage.getByRole('region',{name:'Recently added titles'}).locator('a.media-card').count()===6,mode+' small library keeps all recent titles');
  await smallPage.getByRole('button',{name:'Movies',exact:true}).click();
  check(await smallPage.locator('.home-feature .hero-actions').count()===1,mode+' small library keeps movie-category Play');
  check(await smallPage.locator('.home-category-empty').count()===0,mode+' small movie category is not falsely empty');
  check(await smallPage.getByRole('link',{name:'Library',exact:true}).first().isVisible(),mode+' full library remains available in header');
  await smallPage.screenshot({path:join(screenshots,mode+'-small-library.png')});
  await smallPage.reload();await smallPage.getByRole('heading',{name:'Recently added',exact:true}).waitFor();
  check(await smallPage.getByRole('heading',{name:'Movies',exact:true}).count()===0,mode+' refreshed small library stays deduplicated');
  const newerShows=Array.from({length:24},(_,i)=>fixture(1001+i,{kind:'series',series_title:'New show '+i,season:1,episode:1}));
  smallItems.push(...newerShows);
  if(mode==='web')await smallPage.evaluate(async items=>{
    const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);
  },newerShows);
  await smallPage.reload();await smallPage.getByRole('heading',{name:'Recently added',exact:true}).waitFor();
  await smallPage.getByRole('button',{name:'Movies',exact:true}).click();
  await smallPage.getByRole('heading',{name:'Movies',exact:true}).waitFor();
  check(await smallPage.getByRole('region',{name:'Movies titles'}).locator('a.media-card').count()===6,mode+' older movies remain after only-series Recent');
  check(await smallPage.locator('.home-category-empty').count()===0,mode+' absent-from-Recent does not mean empty category');
  check(smallErrors.length===0,mode+' small library no runtime errors '+smallErrors.join('|'));
  await smallContext.close();
  const rotationContext=await browser.newContext({serviceWorkers:'block',reducedMotion:'no-preference',viewport:{width:1440,height:900}});
  const rotationPage=await rotationContext.newPage(),rotationErrors=[];
  rotationPage.on('pageerror',e=>rotationErrors.push(e.message));
  await rotationPage.route('**/__art?*',route=>route.fulfill({body:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="700"><rect width="1200" height="700" fill="#324c65"/></svg>',contentType:'image/svg+xml'}));
  if(mode==='npm')await rotationPage.route('**/api/**',route=>{
    const path=new URL(route.request().url()).pathname;
    return route.fulfill({json:path==='/api/home'?buildHome(fixtures,86400000):path==='/api/shorts'?{total:0,items:[]}:path==='/api/libraries'?[]:path==='/api/scan/status'?{running:false}:{}});
  });
  await rotationPage.goto(base+prefix+'/settings');await rotationPage.locator('.settings-heading').waitFor();
  await rotationPage.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web')await rotationPage.evaluate(async items=>{const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);},fixtures);
  await rotationPage.clock.install({time:new Date('2026-10-06T00:00:00Z')});
  await rotationPage.getByRole('link',{name:'Home',exact:true}).first().click();await rotationPage.locator('.home-feature').waitFor();
  await rotationPage.clock.fastForward(0);
  await rotationPage.mouse.move(1400,10);await rotationPage.clock.runFor(100);
  const current=()=>rotationPage.locator('.home-feature-dots button[aria-pressed="true"]').getAttribute('aria-label');
  const tick=async()=>{await rotationPage.clock.fastForward(8100);await rotationPage.clock.runFor(50);};
  check(await rotationPage.locator('.home-browse,.home-feature-previews,.home-feature-navigation').count()===0,mode+' no secondary band, preview cards or counter');
  const headerBox=await rotationPage.locator('.topbar').boundingBox(),filterBox=await rotationPage.getByRole('button',{name:'Movies',exact:true}).boundingBox();
  check(filterBox.y>=headerBox.y&&filterBox.y+filterBox.height<=headerBox.y+headerBox.height,mode+' categories share the header');
  check((await rotationPage.locator('.home-feature').boundingBox()).y<=1,mode+' artwork starts behind the header without a second band');
  check(await rotationPage.locator('.home-feature-dots button span').evaluateAll(es=>es.every(e=>getComputedStyle(e).width==='7px'&&getComputedStyle(e).borderRadius==='50%')),mode+' compact round dots');
  const first=await current();await tick();check(await current()!==first,mode+' rotates after mouse navigation Home');
  await rotationPage.locator('.home-feature').hover();const hovered=await current();await tick();check(await current()===hovered,mode+' hover pauses rotation');
  await rotationPage.mouse.move(1400,10);await tick();check(await current()!==hovered,mode+' leaving hover resumes rotation');
  await rotationPage.keyboard.press('Tab');const focused=await current();await tick();check(await current()===focused,mode+' keyboard focus pauses rotation');
  await rotationPage.evaluate(()=>document.activeElement?.blur());await rotationPage.clock.runFor(50);await tick();check(await current()!==focused,mode+' keyboard blur resumes rotation');
  await rotationPage.getByRole('button',{name:'Pause banner rotation',exact:true}).click();await rotationPage.mouse.move(1400,10);
  const paused=await current();await tick();check(await current()===paused,mode+' explicit pause is respected');
  await rotationPage.getByRole('button',{name:'Resume banner rotation',exact:true}).click();await rotationPage.mouse.move(1400,10);await tick();check(await current()!==paused,mode+' explicit resume rotates');
  const dot=rotationPage.locator('.home-feature-dots button').first();await dot.click();await rotationPage.mouse.move(1400,10);
  const manual=await current();await rotationPage.clock.fastForward(7000);check(await current()===manual,mode+' dot selection receives a full reading interval');
  await rotationPage.clock.fastForward(1200);await rotationPage.clock.runFor(50);check(await current()!==manual,mode+' dot selection then returns to auto');
  const inView=await current();await rotationPage.evaluate(()=>scrollTo(0,900));await rotationPage.clock.runFor(100);await tick();check(await current()===inView,mode+' offscreen banner does not rotate');
  await rotationPage.evaluate(()=>scrollTo(0,0));await rotationPage.clock.runFor(100);await tick();check(await current()!==inView,mode+' returning to the banner restarts rotation');
  await rotationPage.emulateMedia({reducedMotion:'reduce'});await rotationPage.clock.runFor(100);const reduced=await current();await tick();
  check(await current()===reduced&&await rotationPage.getByRole('button',{name:'Pause banner rotation'}).count()===0,mode+' reduced motion disables automatic rotation');
  await rotationPage.locator('.home-feature-dots button[aria-pressed="false"]').first().click();check(await current()!==reduced,mode+' reduced motion retains manual dot controls');
  await rotationPage.emulateMedia({reducedMotion:'no-preference'});await rotationPage.mouse.move(1400,10);await rotationPage.clock.runFor(100);
  const hid=await current();
  await rotationPage.evaluate(()=>{window.__hidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.__hidden});document.dispatchEvent(new Event('visibilitychange'));});
  await tick();check(await current()===hid,mode+' hidden document does not rotate');
  await rotationPage.evaluate(()=>{window.__hidden=false;document.dispatchEvent(new Event('visibilitychange'));});await tick();check(await current()!==hid,mode+' visible document restarts without catch-up');
  await rotationPage.getByRole('button',{name:'Movies',exact:true}).click();check(await rotationPage.getByRole('link',{name:'Home',exact:true}).first().getAttribute('class')!=='active',mode+' only the chosen header category is active');
  await rotationPage.setViewportSize({width:375,height:812});await rotationPage.clock.runFor(100);
  check(await rotationPage.getByRole('navigation',{name:'Home categories'}).isVisible(),mode+' mobile categories remain accessible over the artwork');
  await rotationPage.getByRole('button',{name:'Series',exact:true}).click();check(await rotationPage.getByRole('button',{name:'Series',exact:true}).getAttribute('aria-pressed')==='true',mode+' mobile filter stays functional');
  await rotationPage.getByRole('link',{name:'Home',exact:true}).first().click();check(await rotationPage.getByRole('button',{name:'For you',exact:true}).getAttribute('aria-pressed')==='true',mode+' mobile Home resets category');
  check(rotationErrors.length===0,mode+' rotation has no browser exceptions '+rotationErrors.join('|'));
  await rotationContext.close();console.log('PASS Home',mode,checks);
 }
 console.log(JSON.stringify({checks,result:'passed',screenshots}));
}finally{await browser.close();}
