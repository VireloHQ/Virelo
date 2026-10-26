import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtemp,mkdir,readFile,rm,stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';
import { openPlaybackSetting } from './helpers/playback-settings.mjs';

process.env.VIRELO_LOG_LEVEL='silent';
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)('playwright');
const root=await mkdtemp(join(tmpdir(),'virelo-communication-')),media=join(root,'media');
let server,browser,vite;const errors=[],results=[];
const check=(value,label)=>{assert.ok(value,label);console.log('PASS',label);};
try{
  await mkdir(media);
  for(const [name,volume,size] of [['quiet',.5,'320x180'],['loud',2,'320x180'],['portrait',.5,'180x320']])execFileSync(process.env.FFMPEG_PATH||'ffmpeg',[
    '-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=0x354358:s='+size+':r=12','-f','lavfi','-i','sine=frequency=440:sample_rate=48000',
    '-t','30','-c:v','libx264','-threads','2','-preset','ultrafast','-pix_fmt','yuv420p','-af','volume='+volume,'-c:a','aac','-ac','2','-movflags','+faststart',join(media,name+'.mp4')],{windowsHide:true,timeout:60000});
  const originals=await Promise.all(['quiet','loud','portrait'].map(name=>readFile(join(media,name+'.mp4'))));
  server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const library=server.db.addLibrary(media,'Generated clips'),items=[];
  for(const name of ['quiet','loud','portrait']){
    const path=join(media,name+'.mp4'),info=await stat(path),portrait=name==='portrait';
    const record={library_id:library.id,path,filename:name+'.mp4',title:name,sort_title:name,kind:'video',folder:'',size:info.size,mtime:1,duration:30,width:portrait?180:320,height:portrait?320:180,video_codec:'h264',audio_codec:'aac',container:'mp4',series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null};
    items.push({...record,...server.db.upsertMedia(record),liked:0,progress_position:0,progress_completed:0,added_at:0,updated_at:0});
  }
  const hash=await hashPassword('1');server.accounts.save({username:'owner',displayName:'Owner',allLibraries:true},hash,undefined,true);
  server.accounts.save({username:'viewer',displayName:'Viewer',allLibraries:true},hash);
  await server.app.listen({host:'127.0.0.1',port:0});const npmBase='http://127.0.0.1:'+server.app.server.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
  const instrument=async context=>{
    await context.addInitScript({path:fileURLToPath(new URL('../node_modules/jsqr/dist/jsQR.js',import.meta.url))});
    return context.addInitScript(()=>{
    window.__contexts=[];
    const Native=window.AudioContext;
    window.AudioContext=class extends Native{
      constructor(...args){super(...args);this.__limiters=[];this.__sources=[];window.__contexts.push(this);}
      createDynamicsCompressor(){const node=super.createDynamicsCompressor();this.__limiters.push(node);return node;}
      createMediaElementSource(element){const node=super.createMediaElementSource(element);this.__sources.push(element);return node;}
    };
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.__copied=text;}}});
    });
  };
  const verifyQr=async(current,expected)=>{
    await current.locator('.share-qr img').evaluate(image=>image.decode());
    const result=await current.locator('.share-qr img').evaluate((image,expected)=>{
      const canvas=document.createElement('canvas'),sizes=[image.naturalWidth,256,192],decoded=[];
      let colored=0;
      for(const size of sizes){
        canvas.width=canvas.height=size;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,size,size);
        const pixels=ctx.getImageData(0,0,size,size);
        if(size===256)for(let i=0;i<pixels.data.length;i+=4)if(Math.max(...pixels.data.subarray(i,i+3))-Math.min(...pixels.data.subarray(i,i+3))>40)colored++;
        decoded.push(window.jsQR(pixels.data,size,size)?.data===expected);
      }
      return {decoded,colored};
    },expected);
    assert.deepEqual(result.decoded,[true,true,true],'rounded, branded QR decodes at native, 256px and 192px sizes');
    assert.ok(result.colored>30,'the downloaded image contains the color logo, not a separate DOM overlay');
    assert.equal(await current.getByRole('link',{name:'Save QR',exact:true}).getAttribute('href'),await current.locator('.share-qr img').getAttribute('src'));
    assert.equal(await current.getByRole('link',{name:'Save QR',exact:true}).getAttribute('download'),'virelo-qr.png');
  };
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1440,height:1000}});await instrument(context);
  let page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));
  const login=async(context,user)=>{const response=await context.request.post(npmBase+'/api/auth/login',{headers:{'x-virelo-request':'1'},data:{username:user,password:'1'}});assert.equal(response.status(),200,await response.text());};
  await login(context,'owner');
  await page.goto(npmBase+'/settings#announcements');
  await page.getByLabel('Announcement title',{exact:true}).fill('Server update');await page.getByLabel('Announcement message',{exact:true}).fill('A message from your administrator. <img onerror=alert(1)>');
  await page.getByRole('button',{name:'Send announcement',exact:true}).click();await page.getByRole('status').filter({hasText:'Sent to 2 users.'}).waitFor();
  const guest=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});await instrument(guest);await login(guest,'viewer');
  const viewer=await guest.newPage();viewer.on('pageerror',error=>errors.push(error.message));await viewer.goto(npmBase+'/settings#playback');
  await viewer.getByRole('button',{name:'Notifications, 1 unread',exact:true}).click();
  await viewer.getByRole('heading',{name:'Server update',exact:true}).waitFor();
  check(await viewer.locator('.notification-message').innerText()==='A message from your administrator. <img onerror=alert(1)>','notifications render administrator content as plain text');
  await viewer.getByRole('button',{name:'Mark as read',exact:true}).click();await viewer.getByRole('button',{name:'Notifications',exact:true}).waitFor();
  await viewer.getByRole('button',{name:'Done',exact:true}).click();await viewer.getByRole('dialog',{name:'Notifications',exact:true}).waitFor({state:'hidden'});
  await viewer.reload();await viewer.getByRole('button',{name:'Notifications',exact:true}).waitFor();check(true,'read state survives reload');
  check(await viewer.getByRole('button',{name:'Announcements',exact:true}).count()===0,'regular users have no announcement publishing controls');
  await viewer.goto(npmBase+'/settings#sharing');
  await viewer.getByRole('button',{name:'Share Virelo',exact:true}).click();await viewer.locator('.share-qr img').waitFor();
  await verifyQr(viewer,npmBase+'/');
  await viewer.waitForFunction(()=>getComputedStyle(document.querySelector('.virelo-confirm-container')).opacity==='1');
  await viewer.waitForTimeout(100);
  await viewer.screenshot({path:join(root,'share-mobile.png')});check(await viewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'share fits mobile');
  check(await viewer.locator('.topbar .share-trigger').count()===0,'sharing is a labelled action outside the header');
  check(await viewer.locator('.topbar-actions button').evaluateAll(buttons=>buttons.filter(button=>button.getBoundingClientRect().width>0).every(button=>{const box=button.getBoundingClientRect(),icon=button.querySelector('svg')?.getBoundingClientRect();return box.width>=48&&box.height>=48&&icon?.width>=28&&icon?.height>=28;})),'header icons are 28px with 48px touch targets');
  await viewer.getByRole('button',{name:'Close share',exact:true}).click();
  for(const address of ['http://192.168.1.42:41777','http://[fd00:1234:5678:90ab::42]:41777','https://virelo.riyo.me',`https://${'media.'.repeat(16)}example.test`]){
    await viewer.route('**/api/share/addresses',route=>route.fulfill({json:[{url:address,name:'Test interface'}]}));
    await viewer.getByRole('button',{name:'Share Virelo',exact:true}).click();
    await viewer.waitForFunction(expected=>document.querySelector('input[aria-label="Share link"]')?.value===expected,address+'/');
    await viewer.locator('.share-qr img').waitFor();await verifyQr(viewer,address+'/');
    check(true,'branded QR decodes LAN, IPv6 and public/long addresses: '+address);
    await viewer.getByRole('button',{name:'Close share',exact:true}).click();
    await viewer.unroute('**/api/share/addresses');
  }
  await guest.close();
  await page.getByRole('button',{name:'Withdraw',exact:true}).click();await page.getByRole('alertdialog').getByRole('button',{name:'Withdraw',exact:true}).click();
  await page.getByText('No announcements sent.',{exact:true}).waitFor();
  check(true,'administrator can send and withdraw notifications through the UI');

  const modes=[['npm',npmBase,context,page]];
  if(process.env.VIRELO_TEST_WEB_REPO){
    const web=resolve(process.env.VIRELO_TEST_WEB_REPO);
    vite=spawn(process.execPath,[join(web,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--port','0'],{cwd:web,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const webBase=await new Promise((done,fail)=>{let output='';const timer=setTimeout(()=>fail(Error('Vite startup timed out.')),30000);vite.once('error',fail);vite.stderr.on('data',chunk=>{output+=String(chunk);});vite.stdout.on('data',chunk=>{output+=String(chunk).replace(/\x1b\[[0-9;]*m/g,'');const url=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];if(url){clearTimeout(timer);done(url);}});});
    const webContext=await browser.newContext({serviceWorkers:'block',viewport:{width:390,height:844}});await instrument(webContext);
    const webPage=await webContext.newPage();webPage.setDefaultTimeout(15000);webPage.on('pageerror',error=>errors.push(error.message));
    await webPage.route('**/__communication/*',async route=>{const index=Number(new URL(route.request().url()).pathname.split('/').at(-1));await route.fulfill({body:originals[index],contentType:'video/mp4'});});
    await webPage.route(url=>url.pathname==='/src/api.ts'&&!url.search,async route=>{
      const response=await route.fetch();await route.fulfill({response,body:await response.text()+`\nconst auditFiles=new Map(),auditUrls=new Map();
api.mediaFile=async id=>{if(!auditFiles.has(id))auditFiles.set(id,fetch('/__communication/'+(${JSON.stringify(items.map(item=>item.id))}.indexOf(id))).then(r=>r.blob()).then(b=>new File([b],'clip-'+id+'.mp4',{type:'video/mp4',lastModified:1})));return auditFiles.get(id);};
api.mediaSource=async id=>{if(!auditUrls.has(id))auditUrls.set(id,URL.createObjectURL(await api.mediaFile(id)));return auditUrls.get(id);};`});
    });
    await webPage.goto(webBase+'/app/settings');await webPage.locator('.settings-heading').waitFor();
    await webPage.evaluate(async items=>{const {saveStoredMedia}=await import('/src/local-library.ts');for(const item of items)await saveStoredMedia(item);},items);
    modes.push(['web',webBase,webContext,webPage]);
  }
  const sample=page=>page.evaluate(async()=>{
    const context=window.__contexts.filter(item=>item.state!=='closed'&&item.__limiters.length).at(-1);
    const output=context.__limiters[0],meter=context.createAnalyser();meter.fftSize=2048;output.connect(meter);
    const data=new Float32Array(2048);let power=0;
    try{for(let n=0;n<6;n++){await new Promise(done=>setTimeout(done,50));meter.getFloatTimeDomainData(data);power+=data.reduce((sum,value)=>sum+value*value,0)/data.length;}}finally{output.disconnect(meter);}
    return {rms:Math.sqrt(power/6),sources:context.__sources.length,state:context.state,volume:document.querySelector('.player video').volume};
  });
  for(const [mode,base,ctx,current] of modes){
    const prefix=mode==='web'?'/app':'';
    await current.goto(base+prefix+'/watch/'+items[0].id+'?queue=false');
    await current.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>.2;});
    const shareLabel=mode==='npm'?'Share video':'Share Virelo';
    await current.getByRole('button',{name:shareLabel,exact:true}).click();await current.locator('.share-qr img').waitFor();
    check(await current.locator('.share-qr img').getAttribute('src').then(value=>value.startsWith('data:image/png;base64,')),mode+' branded PNG QR is generated locally');
    const link=await current.getByLabel('Share link',{exact:true}).inputValue();check(link===base+(mode==='web'?'/app':'/watch/'+items[0].id),mode+' share link has the correct scope');
    await verifyQr(current,link);check(true,mode+' rounded QR and embedded logo decode at three image sizes');
    await current.getByRole('button',{name:'Copy link',exact:true}).click();check(await current.evaluate(()=>window.__copied)===link,mode+' copy action uses the displayed URL');
    await current.keyboard.press('Escape');await current.getByRole('dialog',{name:shareLabel,exact:true}).waitFor({state:'hidden'});
    await openPlaybackSetting(current,'Audio');await current.getByRole('menuitemcheckbox',{name:/Volume leveling/}).click();
    await current.waitForFunction(()=>window.__contexts.some(context=>context.__limiters.length>0));
    await current.getByRole('menuitemcheckbox',{name:/Volume leveling/}).click();await current.waitForTimeout(700);
    const before=await sample(current);check(before.rms>0,mode+' disabling leveling leaves audio audible');
    await current.getByRole('menuitemcheckbox',{name:/Volume leveling/}).click();await current.keyboard.press('Escape');await current.keyboard.press('Escape');
    await current.waitForTimeout(5000);const quiet=await sample(current);check(quiet.rms>before.rms*1.5,mode+' quiet audio is lifted smoothly');
    await current.locator('.player video').evaluate(video=>{video.volume=.5;});await current.waitForTimeout(1500);const lower=await sample(current);
    check(lower.rms/quiet.rms>.35&&lower.rms/quiet.rms<.65,mode+' leveling does not undo manual volume');
    await current.locator('.player video').evaluate(video=>{video.muted=true;});await current.waitForTimeout(300);check((await sample(current)).rms<.00001,mode+' mute remains silent');
    await current.locator('.player video').evaluate(video=>{video.muted=false;video.volume=1;video.currentTime=2;});await current.waitForTimeout(1500);
    check((await sample(current)).rms>0,mode+' seeking keeps normalized audio audible');
    await current.goto(base+prefix+'/watch/'+items[1].id+'?queue=false');await current.waitForFunction(()=>{const v=document.querySelector('.player video');return v&&!v.paused&&v.currentTime>5;});
    const loud=await sample(current);const difference=20*Math.log10(loud.rms/quiet.rms);
    check(Math.abs(difference)<3,mode+' differently mastered clips converge within 3 dB');
    await current.goto(base+prefix+'/shorts?startId='+items[2].id);await current.waitForFunction(()=>{const v=document.querySelector('.short-player video');return v&&!v.paused&&v.currentTime>1;});
    await current.getByRole('button',{name:'Audio',exact:true}).click();check(await current.getByRole('menuitemcheckbox',{name:/Volume leveling/}).getAttribute('aria-checked')==='true',mode+' Shorts shares the saved leveling preference');
    await current.getByRole('menuitemcheckbox',{name:/Volume leveling/}).click();await current.keyboard.press('Escape');check((await sample(current)).rms>0,mode+' Shorts stays audible after disabling leveling');
    await current.screenshot({path:join(root,mode+'-leveling.png')});results.push({mode,before:before.rms,quiet:quiet.rms,loud:loud.rms,differenceDb:difference});
    if(mode==='web')await ctx.close();
  }
  const unsupported=await browser.newContext({serviceWorkers:'block',viewport:{width:320,height:780},userAgent:'Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Version/26.0 Mobile/15E148 Safari/604.1'});
  await instrument(unsupported);await login(unsupported,'viewer');
  await unsupported.addInitScript(()=>localStorage.setItem('virelo-volume-leveling:v1','true'));
  const safe=await unsupported.newPage();await safe.goto(npmBase+'/watch/'+items[0].id+'?queue=false');
  await safe.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&!video.paused&&video.currentTime>.5;});
  check(await safe.evaluate(()=>window.__contexts.length)===0,'unsupported engines keep original audio even with a saved On preference');
  await openPlaybackSetting(safe,'Audio');check(await safe.getByRole('menuitemcheckbox',{name:/Volume leveling/}).isDisabled(),'unsupported leveling is explained and disabled before creating an audio graph');
  await safe.goto(npmBase+'/settings#playback');await safe.getByRole('switch',{name:'Volume leveling',exact:true}).waitFor();
  check(await safe.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'unsupported-browser explanation fits a 320px screen');
  await unsupported.close();
  for(let index=0;index<3;index++)assert.ok((await readFile(join(media,['quiet','loud','portrait'][index]+'.mp4'))).equals(originals[index]));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({results,artifacts:root},null,2));
}catch(error){console.error('Audit artifacts:',root);throw error;
}finally{
  await browser?.close();await server?.app.close();
  if(vite&&vite.exitCode===null){const exited=new Promise(done=>vite.once('exit',done));vite.kill();await exited;}
  const path=relative(resolve(tmpdir()),resolve(root));assert.ok(path.startsWith('virelo-communication-')&&!path.includes('..'));
  // Keep screenshots on failure/success for inspection; remove only generated media/account data.
  await rm(join(root,'media'),{recursive:true,force:true});await rm(join(root,'data'),{recursive:true,force:true});
}
