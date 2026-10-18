import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,mkdtemp} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const assetDir=process.env.VIRELO_TEST_QUALITY_ASSETS?resolve(process.env.VIRELO_TEST_QUALITY_ASSETS):await mkdtemp(join(tmpdir(),'virelo-quality-'));
if(!process.env.VIRELO_TEST_QUALITY_ASSETS){
  const ffmpeg=args=>execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error',...args],{windowsHide:true});
  ffmpeg(['-f','lavfi','-i','color=c=0x354356:s=1920x1080:r=10','-t','25','-an','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',join(assetDir,'source.mp4')]);
  for(const height of [1080,720,480,360]){
    await mkdir(join(assetDir,String(height)));
    ffmpeg(['-i',join(assetDir,'source.mp4'),'-an','-vf','scale=-2:'+height,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-force_key_frames','expr:gte(t,n_forced*2)','-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',join(assetDir,String(height),'segment-%03d.ts'),join(assetDir,String(height),'index.m3u8')]);
  }
  ffmpeg(['-i',join(assetDir,'source.mp4'),'-an','-vf','scale=-2:480','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-movflags','+faststart',join(assetDir,'source480.mp4')]);
  const variant=(width,height,bitrate)=>'#EXT-X-STREAM-INF:BANDWIDTH='+bitrate+',RESOLUTION='+width+'x'+height+',CODECS="avc1.42c028"\n'+height+'/index.m3u8\n';
  await writeFile(join(assetDir,'master.m3u8'),'#EXTM3U\n#EXT-X-VERSION:3\n'+variant(1920,1080,5000000)+variant(1280,720,2800000)+variant(854,480,1400000)+variant(640,360,800000));
  await writeFile(join(assetDir,'master-high-only.m3u8'),'#EXTM3U\n#EXT-X-VERSION:3\n'+variant(1920,1080,5000000));
}
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{}),
  args:['--autoplay-policy=no-user-gesture-required']});
let checks=0;
const check=(value,name)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
try {
 for(const mode of ['npm','web','npm-network']){
  const npmBase=process.env.VIRELO_TEST_NPM_URL||'http://127.0.0.1:5198';
  const base=mode==='npm-network'?npmBase.replace('127.0.0.1','127.0.0.2'):mode==='npm'?npmBase:(process.env.VIRELO_TEST_WEB_URL||'http://127.0.0.1:5199');
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();const errors=[],requested=[];
  page.on('pageerror',error=>errors.push(error.message));
  if(mode==='npm-network')await page.route(url=>url.origin===new URL(base).origin,async route=>{
    const response=await route.fetch({url:route.request().url().replace(new URL(base).origin,new URL(npmBase).origin)});
    await route.fulfill({response});
  });
  await page.route('**/__quality/**',async route=>{
    const path=new URL(route.request().url()).pathname.replace('/__quality/','');requested.push(path);
    const file=resolve(assetDir,path);assert.ok(file.startsWith(assetDir+sep));
    const body=await readFile(file);
    await route.fulfill({body,contentType:path.endsWith('.m3u8')?'application/vnd.apple.mpegurl':path.endsWith('.ts')?'video/mp2t':'video/mp4'});
  });
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url());
    if(url.pathname.endsWith('/stream'))return route.fulfill({body:await readFile(join(assetDir,url.pathname.includes('/3/')?'source480.mp4':'source.mp4')),contentType:'video/mp4'});
    return route.fulfill({json:url.pathname==='/api/libraries'?[]:url.pathname==='/api/home'?{recent:[],featured:[],continueWatching:[],liked:[],series:[],shorts:[],nextEpisodes:[],unwatched:[],shortMovies:[],genres:[]}:{running:false}});
  });
  if(mode==='web')await page.route(url=>url.pathname==='/src/browser-transcode.ts'&&!url.search,route=>route.fulfill({contentType:'text/javascript',body:
    `import {prepareBrowserQuality as real,probeBrowserPlayback as probe,prepareBrowserAudio,prepareBrowserSubtitle} from '/src/browser-transcode.ts?quality-audit-original=1';
     export {prepareBrowserAudio,prepareBrowserSubtitle};
     export async function prepareBrowserQuality(...args){window.__conversions.push(args[1]);if(window.__failQuality)throw new Error('Test conversion failed');return real(...args);}
     export async function probeBrowserPlayback(file){const info=await probe(file);return {...info,audioTracks:[{index:1,typeIndex:0,codec:'aac',title:'One',supported:true},{index:2,typeIndex:1,codec:'aac',title:'Two',supported:true}],defaultAudioStream:null,qualityOptions:window.__noLower?info.qualityOptions.slice(0,1):info.qualityOptions};}
    `}));
  await page.goto(base+(mode==='web'?'/app/settings':'/settings'));await page.locator('.splash-screen').waitFor({state:'hidden'});
  const setup=async()=>page.evaluate(async({base,mode})=>{
    const main=await(await fetch('/src/main.tsx')).text();
    const imports=[...main.matchAll(/from ["']([^"']+)["']/g)].map(match=>match[1]);
    const React=(await import(imports.find(url=>url.includes('/react.js')))).default;
    const {createRoot}=(await import(imports.find(url=>url.includes('/react-dom_client.js')))).default;
    const {api}=await import('/src/api.ts');
    const {Player}=await import('/src/components/Player.tsx');
    const {PlaybackQueue}=await import('/src/components/PlaybackQueue.tsx');
    const {QueryClient,QueryClientProvider}=await import(imports.find(url=>url.includes('react-query')));
    const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    window.__failQuality=false;window.__noLower=false;window.__conversions=[];window.__starts=[];window.__plays=[];
    const item=id=>({id,title:'Quality test '+id,filename:'test-'+id+'.mp4',duration:25,width:id===3?854:1920,height:id===3?480:1080,progress_position:0});
    api.progress=async()=>{};
    api.playbackInfo=async id=>{
      await new Promise(r=>setTimeout(r,40));
      return {qualityOptions:(id===3?[480,360]:[1080,720,480,360]).map(height=>({height,label:height+'p',bitrate:1000000})),
        audioTracks:[{index:1,typeIndex:0,codec:'aac',title:'One',supported:true},{index:2,typeIndex:1,codec:'aac',title:'Two',supported:true}],
        subtitleTracks:[],defaultAudioStream:null,requiresTranscode:false,requiresAudioTranscode:false};
    };
    api.startQualityTranscode=async(id,audio)=>{
      window.__starts.push({id,audio});
      if(window.__failQuality)return {status:'error',error:'Test conversion failed'};
      return {status:'ready',complete:true,playlist:base+'/__quality/'+(window.__noLower?'master-high-only.m3u8':'master.m3u8'),
        variants:[1080,720,480,360].map(height=>({height,label:height+'p',bitrate:1000000,url:base+'/__quality/'+height+'/index.m3u8'}))};
    };
    api.mediaFile=async id=>new File([await(await fetch(base+'/__quality/'+(id===3?'source480.mp4':'source.mp4'))).arrayBuffer()],'test-'+id+'.mp4',{type:'video/mp4'});
    api.mediaSource=async id=>base+'/__quality/'+(id===3?'source480.mp4':'source.mp4');
    document.body.replaceChildren();const rootNode=document.createElement('div');document.body.append(rootNode);const root=createRoot(rootNode);
    document.addEventListener('playing',event=>{if(event.target.tagName==='VIDEO')window.__plays.push({id:window.__itemId,height:event.target.videoHeight,src:event.target.currentSrc});},true);
    function Harness({id}) {
      const [repeat,setRepeat]=React.useState('off');
      const queue=Array.from({length:10},(_,i)=>item(i+1));
      return React.createElement(React.Fragment,null,
        React.createElement(Player,{item:item(id),autoPlay:true,queue,queueIndex:0,repeatMode:repeat,onRepeatChange:setRepeat}),
        React.createElement(PlaybackQueue,{items:queue,activeIndex:0,repeatMode:repeat,onRepeatChange:setRepeat,onSelect:()=>{}})
      );
    }
    window.__mount=id=>{window.__itemId=id;root.render(React.createElement(QueryClientProvider,{client},React.createElement(Harness,{id})));};
  },{base,mode});
  const mount=async id=>{await page.evaluate(id=>{window.__plays=[];window.__mount(id);},id);};
  const waitVideo=async height=>{
    try{await page.waitForFunction(height=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.videoHeight===height&&v.currentTime>.2;},height,{timeout:30000});}
    catch(reason){console.error('VIDEO',mode,height,await page.locator('.player video').evaluate(v=>({time:v.currentTime,paused:v.paused,height:v.videoHeight,ready:v.readyState,src:v.currentSrc,error:v.error?.message})),await page.locator('body').innerText(),await page.evaluate(()=>({plays:window.__plays,starts:window.__starts,conversions:window.__conversions})));throw reason;}
  };
  const choose=async height=>{
    await page.getByRole('button',{name:'Quality',exact:true}).click();
    await page.getByRole('menuitemradio',{name:new RegExp('^'+height+'p')}).click();
  };
  const preference=()=>page.evaluate(()=>localStorage.getItem('virelo-playback-quality:v1'));
  await setup();await mount(1);await waitVideo(1080);
  check(true,mode+' default original playback');
  const repeatButton=page.getByRole('button',{name:'Repeat',exact:true});
  for(const [label,loop] of [['Repeat video',true],['Repeat queue',false],['Repeat off',false]]) {
    await repeatButton.click();
    check((await repeatButton.getAttribute('title')).startsWith(label)&&await page.locator('.player video').evaluate(v=>v.loop)===loop,mode+' direct repeat cycle '+label);
    check(await page.getByRole('menu',{name:'Repeat',exact:true}).count()===0,mode+' repeat opens no menu');
  }
  const queueRepeat=page.locator('.playback-queue').getByRole('button',{name:'Repeat queue',exact:true});
  await queueRepeat.click();await queueRepeat.click();
  check((await repeatButton.getAttribute('title')).startsWith('Repeat queue'),mode+' queue repeat selects queue immediately and is idempotent');
  await repeatButton.click();
  await page.locator('.player video').click({button:'right'});
  const actions=page.getByRole('menu',{name:'Video actions'});
  check(await actions.getByRole('menuitemradio',{name:'Repeat video',exact:true}).count()===1&&await actions.getByRole('menuitemradio').count()===1
    &&await actions.getByRole('menuitem',{name:'Quality',exact:true}).count()===0,mode+' context only has Repeat video and no Quality');
  check(await actions.getByRole('menuitemradio',{name:'Repeat video',exact:true}).locator('svg').count()===1,mode+' context repeat has an icon');
  await page.keyboard.press('Escape');
  check(await page.evaluate(()=>['html','body','.playback-queue-list'].every(selector=>getComputedStyle(document.querySelector(selector)).scrollbarWidth==='none')),mode+' horizontal and vertical native scrollbars hidden');
  await page.locator('.playback-queue-list').hover();await page.mouse.wheel(0,350);
  await page.waitForFunction(()=>document.querySelector('.playback-queue-list').scrollLeft>10);
  check(true,mode+' queue wheel remains scrollable without a scrollbar');
  await page.getByRole('button',{name:'Scroll queue right',exact:true}).click();
  check(true,mode+' queue arrow remains usable after wheel');
  await page.locator('[aria-label="Volume"]').fill('0.35');
  check(await page.locator('.player video').evaluate(v=>v.volume===.35),mode+' actual volume applied');
  await page.getByRole('button',{name:'Quality',exact:true}).click();
  check(await page.getByRole('menuitemradio',{name:/^Auto/}).count()===(mode==='npm-network'?1:0),mode+' Auto is available only on network connections');
  check(await page.getByRole('menuitemradio',{name:/^Original Quality/}).count()===1&&await page.getByRole('menuitemradio',{name:/^1080p/}).count()===1,mode+' Original Quality and 1080p are separate options');
  check(await page.getByRole('menuitemradio',{name:/^Original Quality/}).getAttribute('aria-checked')==='true',mode+' default is Original Quality without preparation');
  await page.getByRole('button',{name:'Quality',exact:true}).click();
  await choose(720);await waitVideo(720);
  check(await preference()==='720',mode+' manual quality saved');
  await mount(2);await waitVideo(720);
  check(await page.locator('.player video').evaluate(v=>v.volume===.35),mode+' volume retained on next video');
  check((await page.evaluate(()=>window.__plays)).every(play=>play.height<=720),mode+' next video never starts above 720p');
  await mount(3);await waitVideo(480);
  check(await preference()==='720',mode+' lower source keeps 720p preference');
  await mount(4);await waitVideo(720);
  check(true,mode+' higher source returns to saved ceiling, not highest');
  await page.reload();await page.locator('.splash-screen').waitFor({state:'hidden'});await setup();await mount(4);await waitVideo(720);
  check(await preference()==='720',mode+' page reload retains selection');
  check(await page.locator('.player video').evaluate(v=>v.volume===.35),mode+' volume retained after reload');
  await page.evaluate(()=>{window.__failQuality=true;});await mount(5);
  await page.locator('.player-status.error').waitFor({timeout:45000});
  check(await page.locator('.player video').evaluate(v=>v.paused),mode+' conversion failure remains paused');
  await page.getByRole('button',{name:'Play',exact:true}).click();await page.waitForTimeout(250);
  check(await page.locator('.player video').evaluate(v=>v.paused),mode+' Play does not bypass the limit after failure');
  check(await preference()==='720',mode+' failed conversion keeps saved ceiling');
  await choose(1080);await waitVideo(1080);
  check(await preference()==='1080',mode+' explicit original-quality recovery works');
  await choose(720);await page.locator('.player-status.error').waitFor();
  check(await preference()==='720'&&await page.locator('.player video').evaluate(v=>v.paused),mode+' failed mid-video switch never resumes original');
  await page.evaluate(()=>{window.__failQuality=false;});await choose(720);await waitVideo(720);
  check(true,mode+' retry same quality works');
  await page.getByRole('button',{name:'Pause',exact:true}).click();await choose(480);await page.waitForTimeout(800);
  check(await page.locator('.player video').evaluate(v=>v.paused),mode+' changing quality preserves pause');
  await page.getByRole('button',{name:'Play',exact:true}).click();await waitVideo(480);
  await page.evaluate(()=>{window.__failQuality=true;});
  await page.getByRole('button',{name:'Audio',exact:true}).click();await page.getByRole('menuitemradio',{name:/^Two/}).click();
  await page.locator('.player-status.error').waitFor();
  check(await page.locator('.player video').evaluate(v=>v.paused)&&await preference()==='480',mode+' audio-switch failure cannot bypass manual ceiling');
  await page.evaluate(()=>{window.__failQuality=false;window.__noLower=true;localStorage.removeItem('virelo-playback-audio:v1');localStorage.setItem('virelo-playback-quality:v1','720');});
  await page.reload();await page.locator('.splash-screen').waitFor({state:'hidden'});await setup();
  await page.evaluate(()=>{window.__noLower=true;});requested.length=0;await mount(6);
  await page.locator('.player-status.error').waitFor({timeout:45000});
  check(await page.locator('.player video').evaluate(v=>v.paused),mode+' unavailable lower rendition never becomes Auto or highest');
  if(mode!=='web')check(!requested.some(path=>path.startsWith('1080/segment-')),mode+' missing rendition never downloads higher segments');
  await choose(1080);await waitVideo(1080);
  check(true,mode+' original-quality recovery remains accessible when no lower rendition exists');
  await page.evaluate(()=>{window.__noLower=false;});
  await mount(1);await waitVideo(1080);
  await choose(720);await waitVideo(720);
  await page.getByRole('button',{name:'Quality',exact:true}).click();
  await page.getByRole('menuitemradio',{name:/^Original Quality/}).click();
  await waitVideo(1080);
  check(await preference()==='source',mode+' return from lower quality to Original uses original stream');
  const preparations=await page.evaluate(()=>window.__starts.length+window.__conversions.length);
  await mount(3);await waitVideo(480);
  await mount(1);await waitVideo(1080);
  check(await preference()==='source'&&await page.evaluate(()=>window.__starts.length+window.__conversions.length)===preparations,mode+' Original follows each source without quality preparation');
  await page.getByRole('button',{name:'Mute',exact:true}).click();
  await mount(2);await waitVideo(1080);
  check(await page.locator('.player video').evaluate(v=>v.muted&&v.volume===.35),mode+' mute and saved volume both follow next video');
  check(errors.length===0,mode+' no runtime errors: '+errors.join('|'));
  await context.close();
 }
 console.log(JSON.stringify({checks,result:'passed'}));
}finally{await browser.close();}
