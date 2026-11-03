import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const mode=JSON.parse(await readFile(join(repo,'package.json'),'utf8')).name;
const artifacts=await mkdtemp(join(tmpdir(),'virelo-controls-polish-'));
const server=spawn(process.execPath,[join(repo,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:repo,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser,page,checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;console.log('PASS',mode,message);};
try{
  const base=await new Promise((resolve,reject)=>{
    let output='';const timer=setTimeout(()=>reject(new Error(output)),20000);
    server.once('error',error=>{clearTimeout(timer);reject(error);});
    server.stderr.on('data',chunk=>output+=chunk);
    server.stdout.on('data',chunk=>{output+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);resolve(url);}});
  });
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  for(const touch of [false,true]){
    const context=await browser.newContext({viewport:{width:touch?390:1440,height:900},locale:'en-US',hasTouch:touch,isMobile:touch,serviceWorkers:'block'});
    page=await context.newPage();page.setDefaultTimeout(15000);
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.route(base+'/__controls-audit',route=>route.fulfill({body:'<!doctype html><body><div id="root"></div></body>',contentType:'text/html'}));
    await page.goto(base+'/__controls-audit');
    await page.evaluate(async()=>{
      const refresh=(await import('/@react-refresh')).default;
      refresh.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
      const main=await(await fetch('/src/main.tsx')).text();
      const imports=[...main.matchAll(/from ["']([^"']+)["']/g)].map(match=>match[1]);
      const React=(await import(imports.find(url=>url.includes('/react.js')))).default;
      const dom=await import(imports.find(url=>url.includes('/react-dom_client.js')));
      const createRoot=dom.createRoot||dom.default.createRoot;
      const {QueryClient,QueryClientProvider}=await import(imports.find(url=>url.includes('react-query')));
      const {PlayerControls}=await import('/src/components/PlayerControls.tsx');
      const {RepeatControl}=await import('/src/components/RepeatControl.tsx');
      const {AppearanceProvider}=await import('/src/components/AppearanceProvider.tsx');
      const {api}=await import('/src/api.ts');
      await import('/src/styles.css');await import('/src/player-ui.css');await import('/src/ui-motion.css');
      const lateQueueStyle=document.head.appendChild(document.createElement('style'));
      lateQueueStyle.textContent=(await import('/src/playback-queue.css?raw')).default;
      window.__appearance={controllerStyle:'classic',accentColor:'#c3a6ff'};
      api.appearance=async()=>window.__appearance;
      const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
      client.setQueryData(['appearance'],window.__appearance);window.__client=client;
      function Fixture(){
        const [repeat,setRepeat]=React.useState('off'),[paused,setPaused]=React.useState(true),[hasQueue,setHasQueue]=React.useState(true);
        window.__setRepeat=setRepeat;window.__setQueue=setHasQueue;
        return React.createElement('div',{className:'app-shell'},
          React.createElement('div',{className:'player controls-visible has-queue',style:{width:'min(1100px,100%)',margin:'24px auto'}},
            React.createElement(PlayerControls,{current:10,duration:120,paused,busy:false,volume:.6,muted:false,pip:false,pipSupported:false,canGoPrev:true,canGoNext:true,hasQueue,
              repeat,onRepeat:setRepeat,onToggle:()=>setPaused(value=>!value),onSeek:()=>{},onSeekBy:()=>{},onPrev:()=>{},onNext:()=>{},onShuffle:()=>{},onVolume:()=>{},onMute:()=>{},onFullscreen:()=>{},onPip:()=>{},favorite:null,settings:null})),
          React.createElement('div',{className:'playback-queue-nav',style:{margin:'16px'}},React.createElement(RepeatControl,{mode:repeat,hasQueue:true,onChange:setRepeat,queueOnly:true})));
      }
      createRoot(document.getElementById('root')).render(React.createElement(QueryClientProvider,{client},React.createElement(AppearanceProvider,null,React.createElement(Fixture))));
    });
    await page.locator('.player-controls').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    const queueRepeat=page.locator('.playback-queue-nav .repeat-control>button');
    if(!touch){
      await queueRepeat.hover();
      check(await queueRepeat.evaluate(element=>getComputedStyle(element).backgroundColor==='rgba(0, 0, 0, 0)'),'late Queue CSS cannot paint the larger repeat hit area');
    }
    await page.keyboard.press('Tab');await queueRepeat.focus();
    check(await queueRepeat.evaluate(element=>getComputedStyle(element).outlineStyle==='none'),'late Queue CSS cannot restore the purple outline');
    check(await queueRepeat.locator('.repeat-button-face').evaluate(element=>getComputedStyle(element).boxShadow!=='none'),'Queue keyboard focus stays inside the compact face');
    if(touch){
      check(await queueRepeat.evaluate(element=>element.offsetWidth>=44&&element.offsetHeight>=44),'touch repeat retains a 44px target');
      await queueRepeat.tap();check(await queueRepeat.getAttribute('aria-pressed')==='true','touch toggles queue repeat');
      check(await queueRepeat.getAttribute('data-repeat-mode')==='queue'&&await queueRepeat.locator('svg.repeat-icon').count()===1,'queue repeat uses the shared icon style');
      await queueRepeat.tap();check(await queueRepeat.getAttribute('aria-pressed')==='false','touch turns queue repeat off');
    }else{
      const repeat=page.locator('.player-transport .repeat-control>button'),face=repeat.locator('.repeat-button-face');
      const loopPath=await repeat.locator('svg.repeat-icon').innerHTML();
      const iconIs=async mode=>await repeat.getAttribute('data-repeat-mode')===mode&&await repeat.locator('svg.repeat-icon').count()===1&&(mode==='one'?(await repeat.locator('svg.repeat-icon').innerHTML())!==loopPath:(await repeat.locator('svg.repeat-icon').innerHTML())===loopPath);
      check(await iconIs('off'),'off uses the shared icon style');
      for(const expected of ['one','queue','off']){await repeat.click();check(await iconIs(expected),'repeat cycle shows '+expected);}
      await repeat.hover();
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.player-transport .repeat-button-face')).backgroundColor!=='rgba(0, 0, 0, 0)');
      check(await repeat.evaluate(element=>element.offsetWidth>=40&&element.offsetHeight>=44),'desktop repeat retains its accessible target');
      check(await face.evaluate(element=>element.offsetWidth===32&&element.offsetHeight===32),'visible hover face is a compact 32px square');
      check(await repeat.evaluate(element=>getComputedStyle(element).backgroundColor==='rgba(0, 0, 0, 0)'),'hover never paints the oversized hit area');
      const hover=await face.evaluate(element=>getComputedStyle(element).backgroundColor);
      await page.mouse.down();
      await page.waitForFunction(previous=>{const style=getComputedStyle(document.querySelector('.player-transport .repeat-button-face'));return style.backgroundColor!==previous&&Number(style.scale)<1;},hover);
      check(await face.evaluate(element=>Number(getComputedStyle(element).scale)<1),'press provides a small physical response');
      await page.mouse.up();await page.mouse.move(1,1);
      await page.keyboard.press('Tab');await repeat.focus();
      check(await repeat.evaluate(element=>element.matches(':focus-visible')&&getComputedStyle(element).outlineStyle==='none'),'keyboard focus has no purple outer outline');
      check(await face.evaluate(element=>getComputedStyle(element).boxShadow!=='none'),'keyboard focus remains visible inside the compact face');
      await page.evaluate(()=>window.__setRepeat('off'));
      await page.keyboard.press('Space');
      check(await repeat.getAttribute('aria-pressed')==='true','Space still operates repeat');
      const appearance=async(value)=>{
        await page.evaluate(async value=>{window.__appearance=value;window.__client.setQueryData(['appearance'],value);await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));},value);
      };
      const play=()=>page.locator('.player-play-button');
      const gradient=()=>play().evaluate(element=>getComputedStyle(element,'::before').backgroundImage);
      const initial=await gradient();
      check(initial.includes('linear-gradient'),'Original play/pause uses a real gradient ring');
      check(await play().evaluate(element=>getComputedStyle(element).borderRadius==='15px'&&getComputedStyle(element,'::before').padding==='2px'),'Original uses its own rounded-square shape and thin accent edge');
      await page.locator('body').click({position:{x:1,y:1}});
      await page.locator('.player-transport').screenshot({path:join(artifacts,mode+'-original.png'),animations:'disabled'});
      const box=await play().boundingBox();await play().click();
      check(await play().getAttribute('aria-label')==='Pause'&&await gradient()===initial,'pause retains the same gradient');
      check((await play().boundingBox()).width===box.width,'play/pause does not change its footprint');
      const gradients=new Set([initial]);
      for(const color of ['#38bdf8','#34d399','#fb7185','#000000','#ffffff']){
        await appearance({controllerStyle:'classic',accentColor:color});
        const image=await gradient();
        check(image.includes('linear-gradient')&&!gradients.has(image),'gradient follows the '+color+' accent, including neutral themes');gradients.add(image);
        if(color==='#34d399'){await page.locator('body').click({position:{x:1,y:1}});await page.locator('.player-transport').screenshot({path:join(artifacts,mode+'-mint.png'),animations:'disabled'});}
      }
      for(const controllerStyle of ['streamline','theater','centerstage']){
        await appearance({controllerStyle,accentColor:'#38bdf8'});
        check(await play().evaluate(element=>getComputedStyle(element,'::before').content==='none'),controllerStyle+' keeps its existing button design');
      }
      await appearance({controllerStyle:'classic',accentColor:'#c3a6ff'});
      await page.evaluate(()=>{window.__setQueue(false);window.__setRepeat('off');});
      await repeat.click();check(await iconIs('one'),'a single video can repeat');
      await repeat.click();check(await iconIs('off'),'without a queue, repeat cycles straight back to off');
      await page.emulateMedia({reducedMotion:'reduce'});await repeat.hover();await page.mouse.down();
      check(await face.evaluate(element=>getComputedStyle(element).scale==='1'&&getComputedStyle(element).transitionProperty==='none'),'reduced motion keeps press feedback without scaling');
      await page.mouse.up();
    }
    check(errors.length===0,(touch?'touch':'desktop')+' has no browser exceptions: '+errors.join('; '));
    await context.close();
  }
  console.log(JSON.stringify({checks,artifacts,result:'passed'}));
}catch(error){if(page&&!page.isClosed()){console.error((await page.locator('body').innerText()).slice(-2000));await page.screenshot({path:join(artifacts,'failure.png')}).catch(()=>{});}console.error('Artifacts:',artifacts);throw error;}
finally{await browser?.close();server.kill();}
