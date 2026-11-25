import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, devices } from 'playwright';
import { createVireloServer } from '../dist/server.js';

const root=await mkdtemp(join(tmpdir(),'virelo-download-audit-'));
const clip=execFileSync(process.env.FFMPEG_PATH||'ffmpeg',[
  '-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc2=s=160x90:r=20:d=1',
  '-c:v','libx264','-pix_fmt','yuv420p','-movflags','frag_keyframe+empty_moov','-f','mp4','pipe:1'
],{windowsHide:true,timeout:20000});
let browser,server;
try {
  const media=join(root,'media'),dataDir=join(root,'data');
  await mkdir(media);
  const filename='動画 01.mp4',file=join(media,filename);
  await writeFile(file,clip);
  process.env.VIRELO_LOG_LEVEL='silent';
  server=await createVireloServer({dataDir,mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({externalMetadataEnabled:false,libraryWatchEnabled:false});
  const library=server.db.addLibrary(media,'Fixture');
  const item=server.db.upsertMedia({library_id:library.id,path:file,filename,title:'Download fixture',sort_title:'download fixture',
    kind:'movie',folder:'',size:clip.length,mtime:1,duration:1,width:160,height:90,video_codec:'h264',audio_codec:null,
    container:'mp4',series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,
    backdrop_path:null,overview:null,genres:null,external_id:null});
  const base=await server.app.listen({host:'127.0.0.1',port:0});
  browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  const context=await browser.newContext({...devices['Pixel 7'],acceptDownloads:true});
  const setup=await context.request.post(base+'/api/auth/setup',{headers:{'x-virelo-request':'1'},data:{username:'owner',password:'1234'}});
  assert.equal(setup.status(),200,await setup.text());
  const page=await context.newPage();
  await page.goto(base+'/title/'+item.id);
  const link=page.getByRole('link',{name:'Download original',exact:true});
  await link.waitFor();
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);
  assert.equal(download.suggestedFilename(),filename);
  const local=join(root,'saved.mp4');
  await download.saveAs(local);
  assert.deepEqual(await readFile(local),clip);
  await context.setOffline(true);
  await page.goto(pathToFileURL(local).href);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  assert.ok(await page.locator('video').evaluate(video=>video.videoWidth===160));
  console.log('PASS mobile-width browser saves the Unicode original and opens the same video offline');
} finally {
  await browser?.close();
  await server?.app.close();
  const target=relative(resolve(tmpdir()),resolve(root));
  assert.ok(/^virelo-download-audit-[^/\\]+$/.test(target));
  await rm(root,{recursive:true,force:true});
}
