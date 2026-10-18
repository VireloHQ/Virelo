import {createRequire} from 'node:module';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const {chromium}=require('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-browser-audit-'));
const runFfmpeg=(args)=>execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',['-y','-hide_banner','-loglevel','error',...args],{windowsHide:true});
runFfmpeg(['-f','lavfi','-i','testsrc2=size=360x640:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','15','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-c:a','aac','-movflags','+faststart',join(root,'portrait.mp4')]);
runFfmpeg(['-f','lavfi','-i','testsrc2=size=1280x720:rate=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-f','lavfi','-i','sine=frequency=880:sample_rate=48000','-t','15','-map','0:v','-map','1:a','-map','2:a','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-g','48','-c:a','aac','-metadata:s:a:0','language=eng','-metadata:s:a:1','language=jpn','-movflags','+faststart',join(root,'landscape.mp4')]);
const portrait=await readFile(root+'/portrait.mp4'),landscape=await readFile(root+'/landscape.mp4');
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM ? {executablePath:process.env.VIRELO_TEST_CHROMIUM} : {}),args:['--no-proxy-server']});
let checks=0;
const check=(value,name)=>{assert.ok(value,name);checks++;};
try{
 for(const mode of ['npm','web']){
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.on('dialog',dialog=>{errors.push('Unexpected native dialog: '+dialog.type());void dialog.dismiss();});
  const base=(mode==='npm'?process.env.VIRELO_TEST_NPM_URL:process.env.VIRELO_TEST_WEB_URL)||('http://127.0.0.1:'+(mode==='npm'?5198:5199)),prefix=mode==='npm'?'':'/app';
  const fixtures=Array.from({length:46},(_,i)=>({id:i+1,library_id:1,path:'Clip '+i+'.mp4',source_path:'Clip '+i+'.mp4',filename:'Clip '+i+'.mp4',title:'Clip '+i,sort_title:'clip '+i,kind:'movie',series_title:null,season:null,episode:null,year:2020,duration:15,width:i===45?1280:360,height:i===45?720:640,video_codec:'h264',audio_codec:'aac',container:'mp4',folder:'',size:1,mtime:1,added_at:1,updated_at:1,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null,liked:0}));
  let shortsSeeds=[],qualityStarts=0,gate=null;
  if(mode==='npm'){
   await page.route('**/api/**',async route=>{
    const req=route.request(),u=new URL(req.url());let body;
    const id=Number(u.pathname.split('/')[3]),item=fixtures.find(i=>i.id===id);
    if(u.pathname.endsWith('/stream'))return route.fulfill({body:id===46?landscape:portrait,contentType:'video/mp4'});
    if(u.pathname.includes('/artwork/'))return route.fulfill({status:404,body:''});
    if(u.pathname==='/api/settings')body={externalMetadataEnabled:true,externalImagesEnabled:true,queueBehavior:'auto',shortsIncludeLandscapes:false};
    else if(u.pathname==='/api/libraries')body=[{id:1,label:'Audit',path:'Audit',created_at:1}];
    else if(u.pathname==='/api/home')body={total:fixtures.length,recent:fixtures,movies:fixtures,series:[],continueWatching:[]};
    else if(u.pathname==='/api/folders')body=[];
    else if(u.pathname==='/api/media')body=fixtures;
    else if(u.pathname==='/api/shorts'){
     const seed=Number(u.searchParams.get('seed'));shortsSeeds.push(seed);
     const rank=id=>{let h=(id^seed)>>>0;h=Math.imul(h^(h>>>16),0x7feb352d);h=Math.imul(h^(h>>>15),0x846ca68b);return(h^(h>>>16))>>>0;};
     const all=fixtures.slice(0,45).sort((a,b)=>rank(a.id)-rank(b.id)||a.id-b.id),offset=Number(u.searchParams.get('offset')||0);
     body={items:all.slice(offset,offset+40),total:45};
    }else if(u.pathname.endsWith('/playback')){
     if(gate)await gate;
     body={videoCodec:'h264',width:item.width,height:item.height,qualityOptions:[{height:item.height,label:item.height+'p',bitrate:3000000},...(id===46?[{height:360,label:'360p',bitrate:700000}]:[])],audioTracks:[{index:1,typeIndex:0,codec:'aac',language:'eng',default:true,supported:true}],subtitleTracks:[],defaultAudioStream:1,requiresVideoTranscode:false,requiresAudioTranscode:false,requiresTranscode:false};
    }else if(u.pathname.endsWith('/quality/start')){qualityStarts++;body={status:'error',error:'Audit forced unavailable rendition'};}
    else if(u.pathname.endsWith('/like')){item.liked=req.postDataJSON().liked?1:0;body={ok:true,liked:Boolean(item.liked)};}
    else if(u.pathname==='/api/metadata'&&req.method()==='DELETE'){for(const media of fixtures)Object.assign(media,{title:media.filename.replace('.mp4',''),overview:null,genres:null,poster_path:null,backdrop_path:null,external_id:null,metadata_blocked:1,metadata_revision:(media.metadata_revision||0)+1});body={cleared:fixtures.length};}
    else if(u.pathname.endsWith('/metadata')&&req.method()==='DELETE'){Object.assign(item,{title:item.filename.replace('.mp4',''),overview:null,genres:null,poster_path:null,backdrop_path:null,external_id:null,metadata_blocked:1,metadata_revision:1});body=item;}
    else if(u.pathname.endsWith('/progress'))body={ok:true};
    else if(item)body=item;
    else body={};
    await route.fulfill({json:body});
   });
  }else{
   await page.route('**/__portrait',route=>route.fulfill({body:portrait,contentType:'video/mp4'}));
   await page.route('**/__landscape',route=>route.fulfill({body:landscape,contentType:'video/mp4'}));
  }
  await page.goto(base+prefix+'/settings');await page.locator('.settings-heading').waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  if(mode==='web'){
   await page.evaluate(async()=>{
    const portrait=await(await fetch('/__portrait')).blob(),landscape=await(await fetch('/__landscape')).blob();
    const files=Array.from({length:46},(_,i)=>new File([i===45?landscape:portrait],'Clip '+i+'.mp4',{type:'video/mp4',lastModified:1}));
    window.showDirectoryPicker=async()=>({name:'Audit',kind:'directory',queryPermission:async()=> 'granted',async *values(){for(const file of files)yield{name:file.name,kind:'file',getFile:async()=>file};}});
    const {api}=await import('/src/api.ts');await api.addLibrary();
    window.__api=api;window.__landscapeId=(await api.media()).find(i=>i.height===720).id;
    const {getStoredMedia,saveStoredMedia}=await import('/src/local-library.ts');
    window.__get=getStoredMedia;window.__save=saveStoredMedia;
   });
   check((await page.evaluate(()=>window.__api.shorts({seed:1}))).total===45,'web portrait filter');
   const pages=await page.evaluate(async()=>[...(await window.__api.shorts({seed:31415,limit:40})).items,...(await window.__api.shorts({seed:31415,limit:40,offset:40})).items].map(i=>i.id));
   check(new Set(pages).size===45,'web seeded pagination no duplicates');
  }
  await page.getByRole('link',{name:'Library',exact:true}).first().click();await page.locator('.media-card').first().waitFor();
  const card=page.locator('.media-card').first();const before=page.url();await card.focus();await card.click({button:'right'});
  const menu=page.getByRole('menu');await menu.waitFor();const box=await menu.boundingBox();
  await menu.click({button:'right',position:{x:25,y:18}});
  check(page.url()===before,'menu rightclick no navigation '+mode);
  const box2=await menu.boundingBox();check(box.x===box2.x&&box.y===box2.y,'menu rightclick no reopening '+mode);
  await page.getByRole('menuitem').first().focus();await page.keyboard.press('ArrowDown');
  check((await page.evaluate(()=>document.activeElement.textContent)).includes('Play'),'menu arrow focus '+mode);
  await page.keyboard.press('Escape');check(await menu.count()===0,'menu Escape '+mode);
  check(await card.evaluate(e=>e===document.activeElement),'menu restores keyboard focus '+mode);
  await card.click({button:'right'});await page.getByRole('menuitem',{name:'Add to favorites'}).click();
  check(page.url()===before,'menu action does not trigger card Link '+mode);
  await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('textbox',{name:'Search library'}).waitFor();
  await page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='Search library');
  const focus=await page.locator('.header-search-shell').evaluate(e=>({outline:getComputedStyle(e).outlineStyle,shadow:getComputedStyle(e).boxShadow}));
  check(focus.outline==='none'&&focus.shadow.includes('inset'),'contained search focus '+mode);
  await page.getByRole('textbox',{name:'Search library'}).press('Escape');
  await page.getByRole('link',{name:'Shorts',exact:true}).first().click();await page.locator('.short-info h2').waitFor();
  const order1=await page.locator('.short-slot .short-video').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
  check(await page.locator('.short-top-actions,.short-pause-chip').count()===0,'Shorts no playback overlays '+mode);
  check(await page.locator('.short-actions').count()===1,'only active action rail '+mode);
  const rail=page.locator('.short-actions');
  const labels=await rail.locator('button').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
  check(['Mute','Unmute'].includes(labels[0])&&labels[1]==='Like','audio above Like '+mode);
  const v=page.locator('.short-video[tabindex="0"]');
  await page.waitForFunction(()=>{const v=document.querySelector('.short-video[tabindex="0"]');return v&&!v.paused&&v.currentTime>.2}).catch(async e=>{console.log('SHORTS_FAILED',mode,await page.locator('body').innerText(),await v.evaluate(v=>({src:v.currentSrc,paused:v.paused,muted:v.muted,time:v.currentTime,ready:v.readyState,error:v.error?.message})));throw e;});
  await v.click();await page.waitForTimeout(200);check(await v.evaluate(v=>v.paused),'tap pauses '+mode);
  await v.focus();await page.keyboard.press('Space');await page.waitForTimeout(200);check(!(await v.evaluate(v=>v.paused)),'Space plays '+mode);
  const firstTitle=await page.locator('.short-info h2').innerText();
  await rail.getByRole('button',{name:'Next short'}).click();await page.waitForFunction(title=>document.querySelector('.short-info h2').textContent!==title,firstTitle);
  check(await page.locator('.short-actions').count()===1,'single rail after next '+mode);
  for(const [width,height] of [[1440,900],[375,812],[844,390]]){
   await page.setViewportSize({width,height});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   check(await rail.getByRole('button',{name:/^(Mute|Unmute)$/}).isVisible(),'audio visible '+mode+width);
   const audioBox=await rail.getByRole('button',{name:/^(Mute|Unmute)$/}).boundingBox();
   check(audioBox.y>=64&&audioBox.y+audioBox.height<=height-(width<=900?62:0),'audio stays in viewport '+mode+width);
   const seekBox=await page.locator('.short-video[tabindex="0"]').locator('..').locator('.short-progress').boundingBox();
   check(seekBox.y>=64&&seekBox.y<height,'seek stays aligned after resize '+mode+width);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Shorts no overflow '+mode+width);
   await page.screenshot({path:root+'/'+mode+'-shorts-'+width+'.png'});
  }
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole('link',{name:'Library',exact:true}).first().click();
  await page.getByRole('link',{name:'Shorts',exact:true}).first().click();await page.locator('.short-info h2').waitFor();
  const order2=await page.locator('.short-slot .short-video').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));
  check(JSON.stringify(order1)!==JSON.stringify(order2),'Shorts new visit shuffled '+mode);
  if(mode==='npm')check(new Set(shortsSeeds).size>=2,'new query seed '+mode);
  // Navigate within the SPA so browser-only session file handles remain available.
  if(mode==='web')await page.evaluate(async()=>{const {router}=await import('/src/router.tsx');await router.navigate({to:'/app/watch/$mediaId',params:{mediaId:String(window.__landscapeId)},search:{queue:false}});}).catch(async()=>{
    await page.getByRole('link',{name:'Library',exact:true}).first().click();await page.locator('.media-card').filter({hasText:'Clip 45'}).click();await page.getByRole('button',{name:'Play',exact:true}).click();
  });
  else await page.goto(base+'/watch/46?queue=false');
  await page.locator('.player').waitFor();await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.2});
  check(true,'normal autoplay policy starts video '+mode);
  await page.getByRole('button',{name:'Pause',exact:true}).click();
  await page.locator('.player video').evaluate(v=>{v.currentTime=3});
  await page.waitForTimeout(400);check(await page.locator('.player video').evaluate(v=>v.paused),'seek does not resume paused playback '+mode);
  check(await page.locator('.player-status').count()===0,'no spinner while paused '+mode);
  const range=await page.locator('.player-seek').evaluate(e=>({appearance:getComputedStyle(e).appearance,border:getComputedStyle(e,'::-webkit-slider-runnable-track').borderWidth}));
  check(range.appearance==='none'&&range.border==='0px','flat progress track '+mode);
  await page.getByRole('button',{name:'Quality',exact:true}).click();
  check(await page.getByRole('menuitemradio',{name:/^Auto/}).count()===0,'local has no Auto '+mode);
  await page.getByRole('menuitemradio',{name:/^360p/}).click();
  if(mode==='web')await page.waitForFunction(()=>document.querySelector('.player video')?.videoHeight===360,{},{timeout:60000});
  else await page.waitForTimeout(1000);
  check(await page.locator('.player video').evaluate(v=>v.paused),'quality conversion preserves paused state '+mode);
  check(await page.locator('.player-status').count()===0,'paused quality no spinner '+mode);
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.player video')?.paused);
  if(mode==='web'){
   await page.getByRole('button',{name:'Audio',exact:true}).click();
   await page.getByRole('menuitemradio',{name:/Japanese/}).click();
   await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.webkitAudioDecodedByteCount>0&&document.querySelector('.player-status')===null;},{},{timeout:60000});
   check(await page.locator('.player video').evaluate(v=>v.webkitAudioDecodedByteCount>0),'web reduced-quality audio switch decodes audio');
   await page.getByRole('button',{name:'Quality',exact:true}).click();
   await page.getByRole('menuitemradio',{name:/^720p/}).click();
   await page.waitForFunction(()=>{const v=document.querySelector('.player video'),a=document.querySelector('.player audio');return v?.videoHeight===720&&!v.paused&&a&&!a.paused&&Math.abs(a.currentTime-v.currentTime)<.5;},{},{timeout:60000});
   check(true,'web restore original keeps selected converted audio synchronized');
   const id=await page.evaluate(()=>window.__landscapeId);
   await page.evaluate(async id=>{
     const item=await window.__get(id);item.title='Wrong match';item.external_id='wrong';item.overview='wrong';item.poster_path='/virelo-icon.png';await window.__save(item);
     await Promise.all([window.__api.clearMetadata(id),window.__api.setLike(id,true),window.__api.progress(id,5,15)]);
   },id);
   const item=await page.evaluate(id=>window.__get(id),id);
   check(item.external_id===null&&item.liked===1&&item.progress_position===5,'atomic metadata reset keeps concurrent like/progress '+mode);
  }
  let resetId=1;
  if(mode==='npm')Object.assign(fixtures[0],{title:'Wrong match',external_id:'wrong',overview:'Wrong description'});
  else resetId=await page.evaluate(async()=>{const item=(await window.__api.media())[0];const stored=await window.__get(item.id);stored.title='Wrong match';stored.external_id='wrong';stored.overview='Wrong description';await window.__save(stored);return stored.id;});
  await page.evaluate(async({prefix,id})=>{const {router}=await import('/src/router.tsx');await router.navigate({to:prefix+'/title/$mediaId',params:{mediaId:String(id)}});},{prefix,id:resetId});
  await page.locator('.detail-copy h1').waitFor();
  check(await page.getByRole('button',{name:'Clear metadata',exact:true}).count()===0,'no per-video metadata clear button '+mode);
  await page.evaluate(async prefix=>{const {router}=await import('/src/router.tsx');await router.navigate({to:prefix+'/settings'});},prefix);
  await page.locator('#settings-nav-'+(mode==='npm'?'network':'metadata')).click();
  const clearAll=page.getByRole('button',{name:'Clear all metadata',exact:true});
  await clearAll.waitFor();
  await clearAll.click();
  const confirmation=page.getByRole('alertdialog',{name:'Clear all metadata?'});
  await confirmation.waitFor();
  check(await confirmation.getByRole('button',{name:'Cancel',exact:true}).evaluate(button=>button===document.activeElement),'confirmation initially focuses Cancel '+mode);
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await confirmation.waitFor({state:'hidden'});
  check(await page.getByText(/Metadata cleared for/).count()===0,'bulk clear cancellation keeps data '+mode);
  await clearAll.click();
  await confirmation.getByRole('button',{name:'Clear metadata',exact:true}).click();
  await confirmation.waitFor({state:'hidden'});
  await page.getByText(/Metadata cleared for/).waitFor();
  if(mode==='web') {
    const items=await page.evaluate(()=>window.__api.media());
    check(items.every(item=>item.external_id===null&&item.overview===null&&item.metadata_blocked===1),'bulk clear resets every browser video '+mode);
    const preserved=await page.evaluate(()=>window.__get(window.__landscapeId));
    check(preserved.liked===1&&preserved.progress_position===5,'bulk clear preserves browser likes and progress '+mode);
  } else check(fixtures.every(item=>item.external_id===null&&item.overview===null&&item.metadata_blocked===1),'bulk clear resets every server video '+mode);
  await page.evaluate(async({prefix,id})=>{const {router}=await import('/src/router.tsx');await router.navigate({to:prefix+'/title/$mediaId',params:{mediaId:String(id)}});},{prefix,id:resetId});
  await page.waitForFunction(()=>document.querySelector('.detail-copy h1')?.textContent==='Clip 0');
  check(await page.getByRole('button',{name:'Clear metadata',exact:true}).count()===0,'bulk clear refreshes detail title '+mode);
  check(errors.length===0,'no browser errors '+mode+': '+errors.join(','));
  await page.evaluate(async ({prefix})=>{
    const {router}=await import('/src/router.tsx');
    const firstId=window.__api?(await window.__api.media())[0].id:1;
    await router.navigate({to:prefix+'/watch/$mediaId',params:{mediaId:String(firstId)},search:{queue:true}});
  },{prefix});
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.2});
  await page.getByRole('button',{name:'Next video',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return document.querySelector('.watch-copy h1')?.textContent==='Clip 1'&&v&&!v.paused&&v.currentTime>.2;},{},{timeout:15000});
  check(true,'queue next starts playing '+mode);
  await page.getByRole('button',{name:'Previous video',exact:true}).click();
  await page.waitForFunction(()=>{const v=document.querySelector('.player video');return document.querySelector('.watch-copy h1')?.textContent==='Clip 0'&&v&&!v.paused&&v.currentTime>.2;},{},{timeout:15000});
  check(true,'queue previous starts playing '+mode);
  await page.locator('.player video').dispatchEvent('ended');
  await page.waitForFunction(()=>document.querySelector('.watch-copy h1')?.textContent==='Clip 1');
  check(true,'queue advances on ended '+mode);
  console.log('PASS',mode,'checks',checks);
  await context.close();
 }
 console.log(JSON.stringify({checks,result:'passed',screenshots:root}));
}finally{await browser.close();}
