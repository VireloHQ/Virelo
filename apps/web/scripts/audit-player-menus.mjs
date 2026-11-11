import {createRequire} from 'node:module';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const screenshots=await mkdtemp(join(tmpdir(),'virelo-player-menus-'));
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{})});
const servers=[];
async function serve(mode){
 const repo=join(fileURLToPath(new URL('../../',import.meta.url)),mode==='web'?'virelo-web':'virelo');
 const child=spawn(process.execPath,[join(repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
 servers.push(child);
 return new Promise((resolve,reject)=>{
  let output='';
  const timeout=setTimeout(()=>reject(new Error('Vite startup timed out: '+output)),20000);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Vite exited: '+code+' '+output));});
  child.stderr.on('data',chunk=>{output+=chunk;});
  child.stdout.on('data',chunk=>{
   output+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');
   const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
   if(url){clearTimeout(timeout);resolve(url);}
  });
 });
}
let checks=0;
const check=(value,name)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
try {
 for(const [mode,url] of [['npm',process.env.VIRELO_TEST_NPM_URL],['web',process.env.VIRELO_TEST_WEB_URL]]){
  const base=url||await serve(mode);
  const context=await browser.newContext({serviceWorkers:'block'});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({json:route.request().url().includes('/libraries')?[]:{recent:[],featured:[],continueWatching:[],liked:[],series:[],shorts:[],nextEpisodes:[],unwatched:[],shortMovies:[],genres:[]}}));
  await page.setViewportSize({width:1440,height:900});
  await page.goto(base+(mode==='web'?'/app/settings':'/settings'));
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.evaluate(async mode=>{
   const main=await(await fetch('/src/main.tsx')).text();
   const imports=[...main.matchAll(/from ["']([^"']+)["']/g)].map(match=>match[1]);
   const React=(await import(imports.find(url=>url.includes('/react.js')))).default;
   const {createRoot}=(await import(imports.find(url=>url.includes('/react-dom_client.js')))).default;
   const {PlaybackSettingsMenu}=await import('/src/components/PlaybackSettingsMenu.tsx');
   const {Play,SpeakerHigh,ArrowsOut,Rewind,FastForward,RepeatOnce,PictureInPicture,SkipBack,SkipForward}=await import('/@id/@phosphor-icons/react');
   document.body.replaceChildren();
   const node=document.createElement('main');node.style.cssText='max-width:980px;margin:48px auto;';document.body.append(node);
   const root=createRoot(node),h=React.createElement;
   window.__selections=[];
   const tracks=Array.from({length:22},(_,i)=>({index:i+1,typeIndex:i,codec:'aac',language:i===0?'eng':i===1?'jpn':null,title:i===0?'English':i===1?'Japanese':'Audio track '+(i+1),supported:i!==2,channels:2,channelLayout:'stereo'}));
   const captions=Array.from({length:22},(_,i)=>({...tracks[i],codec:'srt',title:i===0?'English':i===1?'Japanese':'Subtitle '+(i+1)}));
   function Demo(){
    const [selectedAudio,audio]=React.useState(1),[selectedSubtitle,subtitle]=React.useState(null),[selectedQuality,quality]=React.useState(1080);
    const [busy,setBusy]=React.useState(false),[limited,setLimited]=React.useState(false);
    window.__busy=setBusy;window.__limited=setLimited;
    const select=(kind,set)=>value=>{window.__selections.push({kind,value});set(value);};
    const button=(Icon,label)=>h('button',{'aria-label':label},h(Icon));
    return h('div',{className:'player has-queue controls-visible'},
      h('video',{'aria-label':'Demo video',style:{background:'linear-gradient(125deg,#866242,#343a43 55%,#171d25)'}}),
      h('div',{className:'player-gradient'}),
      h('div',{className:'player-controls'},
       h('input',{className:'player-seek',type:'range','aria-label':'Seek'}),
       h('div',{className:'player-toolbar'},
        button(SkipBack,'Previous video'),h('button',{className:'skip-button','aria-label':'Rewind'},h(Rewind)),button(Play,'Play'),
        h('button',{className:'skip-button','aria-label':'Fast-forward'},h(FastForward)),button(SkipForward,'Next video'),
        button(RepeatOnce,'Loop'),button(SpeakerHigh,'Mute'),
        h('input',{className:'volume-slider',type:'range','aria-label':'Volume'}),
        h('span',{className:'player-time'},'24:14 / 1:48:00'),h('span',{className:'player-queue'},'1 / 12'),
        h(PlaybackSettingsMenu,{audioTracks:limited?tracks.slice(0,1):tracks,subtitleTracks:limited?[]:captions,
          qualityOptions:limited?[{height:1080,label:'1080p',bitrate:5000000}]:[1080,720,480,360].map(height=>({height,label:height+'p',bitrate:1400000})),
          selectedAudio,selectedSubtitle,selectedQuality,qualityPreference:selectedQuality,busy,allowAutoQuality:false,
          onSelectAudio:select('audio',audio),onSelectSubtitle:select('subtitles',subtitle),onSelectQuality:select('quality',quality)}),
        button(PictureInPicture,'Picture in Picture'),button(ArrowsOut,'Fullscreen'))));
   }
   root.render(h(Demo));
  },mode);
  if(process.env.VIRELO_TEST_BUILT_CSS==='1'){
   const dist=join(fileURLToPath(new URL('../../',import.meta.url)),mode==='web'?'virelo-web/dist':'virelo/dist/web');
   const html=await readFile(join(dist,'index.html'),'utf8');
   const asset=html.match(/href="(\/assets\/index-[^"]+\.css)"/)?.[1];
   assert.ok(asset,'build the project before auditing production CSS');
   const watchStyles=(await readdir(join(dist,'assets'))).filter(name=>/^WatchView-.*\.css$/.test(name));
   const css=[await readFile(join(dist,asset.slice(1)),'utf8'),...await Promise.all(watchStyles.map(name=>readFile(join(dist,'assets',name),'utf8')))].join('\n');
   await page.evaluate(css=>{
    document.querySelectorAll('style,link[rel="stylesheet"]').forEach(node=>node.remove());
    const style=document.createElement('style');style.textContent=css;document.head.append(style);
   },css);
  }
  const trigger=label=>page.getByRole('button',{name:label,exact:true});
  const menu=label=>page.getByRole('menu',{name:label,exact:true});
  await trigger('Quality').waitFor();
  for(const label of ['Quality','Audio','Subtitles']){
   await trigger(label).click();
   check(await menu(label).evaluate(e=>e.getAnimations().some(animation=>{
    const frames=animation.effect.getKeyframes();
    return frames.some(frame=>frame.opacity==='0'||String(frame.transform).includes('0.97'));
   })),mode+' opening animation actually runs '+label);
   check(await page.getByRole('menu').count()===1&&await menu(label).isVisible(),mode+' independent '+label+' menu');
   check(await menu(label).locator('h3').count()===1,mode+' no unrelated sections in '+label);
   check(await trigger(label).getAttribute('aria-expanded')==='true',mode+' '+label+' trigger expanded');
   check(await menu(label).evaluate(e=>e.dataset.animate==='true'&&getComputedStyle(e).transitionDuration==='0.18s, 0.18s'),mode+' pointer opening has a short transition '+label);
   check(await menu(label).evaluate(e=>{
    const style=getComputedStyle(e);
    return style.backgroundColor==='rgba(24, 24, 28, 0.9)'&&style.borderWidth==='0px'&&style.backdropFilter==='blur(18px)';
   }),mode+' frosted bubble with working blur and no decorative border '+label);
   if(label==='Quality'){
    await menu(label).evaluate(e=>Promise.all(e.getAnimations().map(animation=>animation.finished)));
    await page.screenshot({path:join(screenshots,mode+'-quality.png')});
   }
  }
  await menu('Subtitles').getByRole('menuitemradio',{name:/^Japanese/}).click();
  check(JSON.stringify(await page.evaluate(()=>window.__selections))===JSON.stringify([{kind:'subtitles',value:2}]),mode+' subtitle selection routes only to subtitles');
  check(await page.getByRole('menu').count()===0&&await trigger('Subtitles').evaluate(e=>e===document.activeElement),mode+' selection closes menu and restores focus');
  await trigger('Audio').focus();await page.keyboard.press('ArrowDown');
  check(await menu('Audio').evaluate(e=>e.dataset.animate==='false'&&getComputedStyle(e).transitionDuration==='0s'),mode+' keyboard opening is instant');
  check(await page.locator(':focus').getAttribute('aria-checked')==='true',mode+' keyboard opens first audio option');
  await page.keyboard.press('ArrowDown');await page.keyboard.press('ArrowDown');
  check((await page.locator(':focus').innerText()).includes('Audio track 4'),mode+' arrow navigation skips unsupported track');
  await page.keyboard.press('End');
  check((await page.locator(':focus').innerText()).includes('Audio track 22'),mode+' End reaches final track');
  await page.keyboard.press('Home');check((await page.locator(':focus').innerText()).includes('English'),mode+' Home reaches first track');
  await page.keyboard.press('Escape');
  check(await page.getByRole('menu').count()===0&&await trigger('Audio').evaluate(e=>e===document.activeElement),mode+' Escape restores trigger focus');
  await trigger('Quality').click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
  check(await page.evaluate(()=>window.__selections.at(-1).kind==='quality'&&window.__selections.at(-1).value===720),mode+' keyboard selects quality');
  check((await trigger('Quality').innerText()).includes('720p'),mode+' current quality shown in toolbar');
  await trigger('Audio').click();await page.locator('video').click({position:{x:16,y:16}});
  check(await page.getByRole('menu').count()===0,mode+' outside click closes menu');
  await trigger('Audio').click();await page.keyboard.press('Tab');
  check(await page.getByRole('menu').count()===0&&await trigger('Subtitles').evaluate(e=>e===document.activeElement),mode+' Tab closes and continues toolbar navigation');
  await page.evaluate(()=>window.__busy(true));await trigger('Quality').click();
  check(await menu('Quality').getByRole('menuitemradio').evaluateAll(options=>options.every(e=>e.disabled)),mode+' busy options cannot start competing changes');
  await page.keyboard.press('Escape');await page.evaluate(()=>window.__busy(false));
  for(const viewport of [{width:1440,height:900},{width:320,height:780},{width:390,height:844},{width:844,height:390}]){
   await page.setViewportSize(viewport);await trigger('Audio').click();
   await menu('Audio').evaluate(e=>Promise.all(e.getAnimations().map(animation=>animation.finished)));
   const rect=await menu('Audio').boundingBox();
   check(rect.x>=0&&rect.y>=0&&rect.x+rect.width<=viewport.width+1&&rect.y+rect.height<=viewport.height+1,mode+' menu inside viewport '+viewport.width+'x'+viewport.height);
   check(await menu('Audio').locator('.playback-track-list').evaluate(e=>e.scrollHeight>e.clientHeight),mode+' long track list scrolls '+viewport.width);
   check(await page.locator('.player-toolbar').evaluate(e=>e.scrollWidth<=e.clientWidth),mode+' toolbar does not overflow '+viewport.width);
   check(await menu('Audio').evaluate(e=>{
    const button=document.querySelector('[data-setting="audio"]').getBoundingClientRect(),rect=e.getBoundingClientRect();
    const tip=getComputedStyle(e,'::after');
    return Math.abs(rect.left+parseFloat(tip.left)+parseFloat(tip.width)/2-(button.left+button.width/2))<1&&tip.content!=='none';
   }),mode+' bubble tail points at its trigger '+viewport.width);
   await menu('Audio').getByRole('menuitemradio',{name:/^Audio track 22/}).click();
   check(await page.evaluate(()=>window.__selections.at(-1).value===22),mode+' final track accessible '+viewport.width);
   await trigger('Audio').click();
   await menu('Audio').evaluate(e=>Promise.all(e.getAnimations().map(animation=>animation.finished)));
   await page.screenshot({path:join(screenshots,mode+'-'+viewport.width+'.png')});
   await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440,height:900});
  await page.locator('.player-controls').evaluate(e=>{e.style.cssText='position:fixed;top:12px;bottom:auto;';});
  await trigger('Quality').click();
  check(await menu('Quality').getAttribute('data-side')==='below',mode+' bubble flips below a trigger near the top');
  check(await menu('Quality').evaluate(e=>getComputedStyle(e,'::after').top==='-10px'),mode+' flipped bubble tail stays attached');
  await page.keyboard.press('Escape');await page.locator('.player-controls').evaluate(e=>{e.style.cssText='';});
  await page.emulateMedia({reducedMotion:'reduce'});await trigger('Quality').click();
  check(await menu('Quality').evaluate(e=>getComputedStyle(e).transitionProperty==='opacity'&&getComputedStyle(e).transform==='none'),mode+' reduced motion fades without moving');
  await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('.player').evaluate(e=>e.requestFullscreen());
  await trigger('Quality').click();
  check(await menu('Quality').evaluate(e=>document.fullscreenElement?.contains(e)),mode+' menu renders inside fullscreen');
  await page.keyboard.press('Escape');await page.evaluate(()=>document.exitFullscreen());
  await page.evaluate(()=>window.__limited(true));
  await trigger('Audio').waitFor({state:'hidden'});await trigger('Subtitles').waitFor({state:'hidden'});
  check(await trigger('Audio').count()===0&&await trigger('Subtitles').count()===0,mode+' unavailable track controls omitted');
  await trigger('Quality').click();
  check(await menu('Quality').getByRole('menuitemradio').count()===2&&await menu('Quality').getByRole('menuitemradio',{name:/^Original Quality/}).count()===1,mode+' Original Quality remains distinct from the sole fixed resolution');

  await page.keyboard.press('Escape');
  await page.evaluate(async()=>{
   const main=await(await fetch('/src/main.tsx')).text();
   const imports=[...main.matchAll(/from ["']([^"']+)["']/g)].map(match=>match[1]);
   const React=(await import(imports.find(url=>url.includes('/react.js')))).default;
   const {createRoot}=(await import(imports.find(url=>url.includes('/react-dom_client.js')))).default;
   const {MediaContextMenu}=await import('/src/components/MediaContextMenu.tsx');
   const {PlayerActionMenu}=await import('/src/components/PlayerActionMenu.tsx');
   const {Pause,Rewind,FastForward,SpeakerHigh,Repeat,PictureInPicture,ArrowsOut}=await import('/@id/@phosphor-icons/react');
   document.body.replaceChildren();
   const node=document.createElement('div');document.body.append(node);
   window.__contextCount=0;window.__contextActions=0;
   const h=React.createElement;
   function ContextDemo(){
    const [menu,setMenu]=React.useState(null),surface=React.useRef(null);
    window.__openContext=(kind,x,y,keyboard=false)=>setMenu({kind,position:{x,y,keyboard}});
    const choose=()=>window.__contextActions++;
    const actions=[['Pause',Pause],['Rewind 10 seconds',Rewind],['Fast-forward 10 seconds',FastForward],
      ['Mute',SpeakerHigh],['Repeat video',Repeat],['Picture in Picture',PictureInPicture],['Fullscreen',ArrowsOut]]
      .map(([label,Icon],index)=>({label,icon:h(Icon),action:choose,disabled:index===1,checked:index===4?true:undefined}));
    return h('div',{ref:surface,id:'context-surface',tabIndex:0,'aria-label':'Context menu target',
      style:{width:'100vw',height:'100dvh',background:'repeating-linear-gradient(45deg,#66523c 0px,#66523c 70px,#202b38 70px,#202b38 140px)'},
      onContextMenu:event=>{event.preventDefault();window.__contextCount++;setMenu({kind:window.__contextKind||'media',position:{x:event.clientX,y:event.clientY}});}},
      menu&&(menu.kind==='media'?h(MediaContextMenu,{position:menu.position,item:{id:1,title:'At World’s END'},
        favorite:false,onFavorite:choose,onPlay:choose,onDetails:choose,returnFocus:surface.current,onClose:()=>setMenu(null)}):
        h(PlayerActionMenu,{position:menu.position,label:'Video actions',actions,returnFocus:surface.current,onClose:()=>setMenu(null)})));
   }
   createRoot(node).render(h(ContextDemo));
  });
  const contextMenu=()=>page.locator('.context-popover');
  for(const kind of ['media','player']){
   await page.evaluate(kind=>window.__contextKind=kind,kind);
   for(const viewport of [{width:1440,height:900},{width:320,height:780},{width:844,height:390},{width:320,height:240}]){
    await page.setViewportSize(viewport);
    for(const point of [{x:48,y:48},{x:viewport.width-24,y:viewport.height-24},{x:viewport.width/2,y:viewport.height/2}]){
     await page.locator('#context-surface').click({button:'right',position:point});
     await contextMenu().evaluate(e=>Promise.all(e.getAnimations().map(animation=>animation.finished)));
     const rect=await contextMenu().boundingBox();
     if(viewport.width>=844&&point.x===48)check(Math.abs(rect.x-point.x-14)<1,mode+' '+kind+' opens immediately right of the pointer');
     check(kind!=='player'||Math.abs(rect.width-224)<1,mode+' player context uses its compact vertical layout');
     check(kind!=='player'||await contextMenu().getByRole('menuitem').evaluateAll(buttons=>buttons.every(button=>getComputedStyle(button).display==='flex')),
       mode+' player context items retain their row styling');
     check(rect.x>=15&&rect.y>=15&&rect.x+rect.width<=viewport.width-15&&rect.y+rect.height<=viewport.height-15,
       mode+' '+kind+' context bubble stays inside '+viewport.width+'x'+viewport.height+' at '+point.x+','+point.y);
     check(await contextMenu().evaluate(e=>{
      const style=getComputedStyle(e),tail=getComputedStyle(e,'::after');
      return style.backdropFilter==='blur(18px)'&&style.borderWidth==='0px'&&style.borderRadius==='16px'
        &&style.overflow==='visible'&&tail.content!=='none'&&tail.width==='10px'&&tail.height==='22px';
     }),mode+' '+kind+' context bubble has readable blur and an unclipped tail');
     check(await contextMenu().evaluate((e,point)=>{
      const rect=e.getBoundingClientRect(),tail=getComputedStyle(e,'::after');
      const tipY=rect.top+parseFloat(tail.top)+parseFloat(tail.height)/2;
      const target=Math.max(rect.top+24,Math.min(point.y,rect.bottom-24));
      const tipX=e.dataset.side==='right'?rect.left-10:rect.right+10;
      return Math.abs(tipY-target)<1&&tipX>=0&&tipX<=innerWidth;
     },point),mode+' '+kind+' context tail follows its click with safe edge clamping');
     if(kind==='player'&&viewport.height===240&&point.y===viewport.height/2){
      const content=contextMenu().locator('.context-popover-content');
      check(await content.evaluate(e=>e.scrollHeight>e.clientHeight),mode+' '+kind+' tall context list scrolls on short screens');
      await content.evaluate(e=>{e.scrollTop=e.scrollHeight;});
      check(await contextMenu().count()===1,mode+' internal context scrolling does not close the menu');
     }
     if(viewport.width===1440&&point.y===48)await page.screenshot({path:join(screenshots,mode+'-'+kind+'-context.png')});
     await page.keyboard.press('Escape');
     check(await contextMenu().count()===0&&await page.locator('#context-surface').evaluate(e=>e===document.activeElement),
       mode+' '+kind+' Escape restores focus');
    }
   }
   await page.setViewportSize({width:1440,height:900});
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.evaluate(kind=>window.__openContext(kind,500,300,true),kind);
   await page.waitForFunction(()=>document.querySelector('.context-popover')?.dataset.animate==='false');
   check(await contextMenu().evaluate(e=>e.dataset.animate==='false'&&getComputedStyle(e).transitionDuration==='0s'),
     mode+' '+kind+' keyboard context opening is instant');
   await page.evaluate(()=>document.dispatchEvent(new Event('scroll')));
   check(await contextMenu().count()===1,mode+' '+kind+' ignores queued scrolling without movement');
   await page.keyboard.press('End');await page.keyboard.press('Enter');
   check(await contextMenu().count()===0,mode+' '+kind+' keyboard action remains available');
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.locator('#context-surface').click({button:'right',position:{x:400,y:300}});
   check(await contextMenu().evaluate(e=>getComputedStyle(e).transitionProperty==='opacity'&&getComputedStyle(e).transform==='none'),
     mode+' '+kind+' context reduced motion only fades');
   await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
   await page.locator('#context-surface').evaluate(e=>e.requestFullscreen());
   await page.locator('#context-surface').click({button:'right',position:{x:400,y:300}});
   check(await contextMenu().evaluate(e=>document.fullscreenElement?.contains(e)),mode+' '+kind+' context portal works in fullscreen');
   const opened=await page.evaluate(()=>window.__contextCount);
   await contextMenu().getByRole('menuitem').first().click({button:'right'});
   check(await page.evaluate(()=>window.__contextCount)===opened&&await contextMenu().count()===1,
     mode+' '+kind+' menu does not open another context menu on itself');
   await page.keyboard.press('Escape');await page.evaluate(()=>document.exitFullscreen());
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   await page.evaluate(kind=>{
    document.body.style.paddingBottom='2000px';
    window.__openContext(kind,500,300,true);
   },kind);
   await contextMenu().waitFor();
   await page.evaluate(()=>window.scrollTo({top:100,behavior:'instant'}));
   await contextMenu().waitFor({state:'hidden'});
   check(await contextMenu().count()===0,mode+' '+kind+' dismisses on genuine outside scrolling');
   await page.evaluate(()=>{document.body.style.removeProperty('padding-bottom');window.scrollTo({top:0,behavior:'instant'});});
   await page.waitForFunction(()=>scrollY===0);
  }

  check(errors.length===0,mode+' no runtime errors '+errors.join('|'));
  await context.close();
 }
 console.log(JSON.stringify({checks,result:'passed',screenshots}));
}finally{await browser.close();for(const child of servers)child.kill();}
