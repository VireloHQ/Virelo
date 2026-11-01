import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'vite';

const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url)(process.env.VIRELO_TEST_PLAYWRIGHT||'playwright');
const media=resolve(process.env.VIRELO_DEMO_MEDIA_DIR||'node_modules/.cache/shorts-blender/sources');
const output=resolve('web/public/landing');
const temporary=await mkdtemp(join(tmpdir(),'virelo-shorts-preview-'));
const ffmpeg=(args)=>execFileSync(process.env.VIRELO_TEST_FFMPEG||'ffmpeg',['-hide_banner','-loglevel','error',...args],{windowsHide:true});
for(const [name,expected] of [
  ['sintel.mp4','151f543969ebd4643aa0cde14e000d8d0559586f1e9ad693d427cf4179e4c8e2'],
  ['bunny.mp4','9695b70ed5e4ae939b230dd50422ce5aed24bcc49c0e37c02f2e51365c60d1d7']
]) assert.equal(createHash('sha256').update(await readFile(join(media,name))).digest('hex'),expected,'Use the licensed working source: '+name);

const clips=[];
for(const [index,[name,start,title,framing]] of [
  ['sintel.mp4',12,'Sintel',.35],['bunny.mp4',0,'Big Buck Bunny',.5],['sintel.mp4',0,'Sintel — The journey',.5]
].entries()) {
  const file=join(temporary,`portrait-${index+1}.mp4`);
  ffmpeg(['-ss',String(start),'-i',join(media,name),'-t','10','-vf',`crop=trunc(ih*9/16/2)*2:ih:(iw-ow)*${framing}:0,scale=540:960,setsar=1`,'-an','-r','30','-c:v','libx264','-preset','fast','-crf','20','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart','-map_metadata','-1',file]);
  clips.push({id:index+1,title,file,bytes:await readFile(file)});
}
const items=clips.map(({id,title,bytes})=>({id,library_id:1,path:`portrait-${id}.mp4`,filename:`${title}.mp4`,title,sort_title:title,
  kind:'video',series_title:null,season:null,episode:null,year:null,duration:10,width:540,height:960,video_codec:'h264',audio_codec:null,
  container:'mp4',folder:'Shorts',size:bytes.length,mtime:id,thumbnail_path:null,poster_path:null,backdrop_path:null,
  overview:null,genres:null,external_id:null,added_at:1,updated_at:1,liked:0}));
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false}});
let browser,context;
try {
  await server.listen();
  const base='http://127.0.0.1:'+server.httpServer.address().port;
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM,args:['--autoplay-policy=no-user-gesture-required']});
  context=await browser.newContext({viewport:{width:390,height:820},locale:'en-US',hasTouch:true,isMobile:true,deviceScaleFactor:1,
    serviceWorkers:'block',recordVideo:{dir:temporary,size:{width:390,height:820}}});
  const started=Date.now(),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>localStorage.setItem('virelo.language.v1','en'));
  await page.route(url=>url.pathname==='/src/api.ts'&&!url.search,async route=>{
    const response=await route.fetch();
    await route.fulfill({response,body:await response.text()+`\nconst demo=${JSON.stringify(items)};
      api.shorts=async()=>({items:demo.map(item=>({...item})),total:demo.length});
      api.mediaById=async id=>({...demo.find(item=>item.id===id)});
      api.mediaSource=async id=>'/__landing-short/'+id+'.mp4';
      api.mediaFile=async id=>new File([await(await fetch('/__landing-short/'+id+'.mp4')).blob()],'portrait-'+id+'.mp4',{type:'video/mp4'});
      api.progress=async()=>{};
      api.setLike=async(id,liked)=>{demo.find(item=>item.id===id).liked=liked?1:0;return {ok:true,liked};};
    `});
  });
  await page.route('**/__landing-short/*.mp4',route=>{
    const clip=clips.find(clip=>route.request().url().endsWith('/'+clip.id+'.mp4'));
    assert.ok(clip);
    const range=route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
    const start=Number(range?.[1]||0),end=range?.[2]?Math.min(Number(range[2]),clip.bytes.length-1):clip.bytes.length-1;
    return route.fulfill({status:range?206:200,contentType:'video/mp4',body:clip.bytes.subarray(start,end+1),headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${clip.bytes.length}`}:{})}});
  });
  await page.goto(base+'/app/shorts?startId=1');
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  const playing=()=>page.waitForFunction(()=>{const video=document.querySelector('.short-player video');return video&&video.readyState>=2&&!video.paused&&video.currentTime>.2;});
  await playing();
  await page.evaluate(()=>document.fonts.ready);
  const first=(Date.now()-started)/1000;
  await page.waitForTimeout(1800);
  await page.locator('.short-actions button').nth(1).click();
  await page.getByRole('button',{name:'Remove from favorites',exact:true}).waitFor();
  await page.waitForTimeout(1100);
  for(let index=1;index<3;index++) {
    await page.getByRole('button',{name:'Next short',exact:true}).click();
    await page.waitForFunction(title=>document.querySelector('.short-info h2')?.textContent===title,items[index].title);
    await playing();
    await page.waitForTimeout(2300);
  }
  await page.evaluate(()=>document.activeElement?.blur());
  await page.keyboard.press('Home');
  await playing();
  await page.waitForTimeout(1500);
  assert.deepEqual(errors,[],'Capture must not hide application errors');
  const duration=(Date.now()-started)/1000-first;
  const recording=page.video();
  await context.close();context=null;
  const raw=await recording.path();
  ffmpeg(['-y','-ss',String(first),'-i',raw,'-t',String(duration),'-an','-r','30','-c:v','libx264','-crf','20','-preset','fast','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart','-map_metadata','-1',join(output,'shorts-blender-demo.mp4')]);
  ffmpeg(['-y','-ss','1','-i',join(output,'shorts-blender-demo.mp4'),'-frames:v','1','-c:v','libwebp','-quality','88',join(output,'shorts-blender-demo.webp')]);
  ffmpeg(['-i',join(output,'shorts-blender-demo.mp4'),'-f','null','-']);
  const encoded=JSON.parse(execFileSync(process.env.VIRELO_TEST_FFPROBE||'ffprobe',['-v','error','-show_streams','-show_format','-of','json',join(output,'shorts-blender-demo.mp4')],{encoding:'utf8',windowsHide:true}));
  assert.equal(encoded.streams.length,1);
  assert.equal(encoded.streams[0].codec_name,'h264');
  assert.equal(encoded.streams[0].width,390);assert.equal(encoded.streams[0].height,820);
  assert.equal(encoded.streams[0].r_frame_rate,'30/1');
  assert.ok(Number(encoded.format.duration)>8&&Number(encoded.format.duration)<30);
  assert.ok(Number(encoded.format.size)<25*1024*1024);
  console.log(JSON.stringify({temporary,duration,clips:clips.length,ui:'current, unmodified',width:390,height:820,audio:false}));
} finally {await context?.close();await browser?.close();await server.close();}
