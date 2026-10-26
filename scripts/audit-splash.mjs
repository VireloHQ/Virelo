import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile,mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,relative,extname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const repo=fileURLToPath(new URL('../',import.meta.url));
const {chromium}=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||join(repo,'package.json'))('playwright');
const artifacts=await mkdtemp(join(tmpdir(),'virelo-splash-'));
const modes=[['npm',join(repo,'dist/web'),'/']];
if(process.env.VIRELO_TEST_WEB_REPO)modes.push(['web',join(resolve(process.env.VIRELO_TEST_WEB_REPO),'dist'),'/app']);
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
let checks=0;
try{
  for(const [mode,dist,path] of modes){
    const server=createServer(async(req,res)=>{
      try{
        const pathname=new URL(req.url,'http://localhost').pathname;
        if(pathname.startsWith('/api/')){res.writeHead(503,{'Content-Type':'application/json'});res.end('{}');return;}
        const file=resolve(dist,'.'+(extname(pathname)?pathname:'/index.html'));
        const local=relative(dist,file);assert.ok(!local.startsWith('..')&&!isAbsolute(local));
        const data=await readFile(file);
        res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(data);
      }catch{res.writeHead(404);res.end();}
    });
    await new Promise(done=>server.listen(0,'127.0.0.1',done));
    const base='http://127.0.0.1:'+server.address().port;
    try{
      for(const scenario of ['fast','slow-css','slow-logo','failed-logo','stalled-logo','reduced','mobile']){
        const context=await browser.newContext({serviceWorkers:'block',reducedMotion:scenario==='reduced'?'reduce':'no-preference',viewport:{width:scenario==='mobile'?390:1440,height:900}});
        const page=await context.newPage(),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        let releaseLogo=()=>{};
        try{
          await page.addInitScript(()=>{
            window.__splashTrace=[];
            const start=performance.now();
            const sample=()=>{
              const element=document.querySelector('.splash-screen');
              if(element){
                const logo=element.querySelector('img'),opacity=Number(getComputedStyle(element).opacity),box=element.getBoundingClientRect();
                window.__splashTrace.push({t:performance.now()-start,visible:box.width>0&&box.right>0&&opacity>.1,opacity,left:box.left,width:box.width,logo:logo.complete&&logo.naturalWidth>0,leaving:element.classList.contains('splash-phase-leaving')});
              }
              if(performance.now()-start<5500)requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          });
          if(scenario==='slow-css')await page.route('**/*.css',async route=>{await new Promise(done=>setTimeout(done,700));await route.continue();});
          if(['slow-logo','failed-logo','stalled-logo'].includes(scenario)){
            const stalled=new Promise(done=>{releaseLogo=done;});
            await page.route(/\/virelo-icon\.png(?:\?|$)/,async route=>{
              if(scenario==='failed-logo')return route.abort();
              if(scenario==='stalled-logo')await stalled;
              else await new Promise(done=>setTimeout(done,800));
              await route.continue();
            });
          }
          const verify=async label=>{
            await page.waitForFunction(()=>{
              const element=document.querySelector('.splash-screen');
              return element&&element.getBoundingClientRect().width>0&&getComputedStyle(element).opacity==='1';
            });
            if(['fast','mobile'].includes(scenario))await page.screenshot({path:join(artifacts,mode+'-'+label+'.png')});
            await page.locator('.splash-screen').waitFor({state:'detached',timeout:5000});
            const trace=await page.evaluate(()=>window.__splashTrace),visible=trace.filter(frame=>frame.visible),leaving=visible.find(frame=>frame.leaving);
            assert.ok(visible.length>2&&visible.at(-1).t-visible[0].t>=500,mode+' '+label+' visibly holds the splash instead of flashing');
            if(!['failed-logo','stalled-logo'].includes(scenario)){
              const firstLogo=visible.find(frame=>frame.logo&&!frame.leaving);
              assert.ok(firstLogo,mode+' '+label+' paints the logo');
              assert.ok((leaving?.t??visible.at(-1).t)-firstLogo.t>=500,mode+' '+label+' holds the loaded logo before leaving');
            }
            if(scenario==='reduced')assert.ok(visible.every(frame=>frame.left===0),'reduced motion does not slide');
            else {
              assert.ok(trace.some(frame=>frame.leaving&&frame.left < -frame.width*.2),'the handoff slides left');
              assert.ok(trace.filter(frame=>frame.leaving).at(-1).left < -trace.at(-1).width*.98,'the slide completes before the splash is removed');
              assert.ok(trace.every(frame=>frame.opacity===1),'the handoff does not fade out');
            }
            assert.ok(await page.evaluate(()=>document.getElementById('root').getBoundingClientRect().width>0),'the app is visible after the splash');
            assert.deepEqual(errors,[]);checks++;console.log('PASS',mode,label);
          };
          await page.goto(base+path,{waitUntil:'domcontentloaded'});await verify(scenario);
          if(scenario==='fast'){await page.reload({waitUntil:'domcontentloaded'});await verify('cached-reload');}
        }finally{releaseLogo();await context.close();}
      }
      if(mode==='web'){
        const page=await browser.newPage();
        await page.goto(base,{waitUntil:'domcontentloaded'});await page.locator('#root > *').first().waitFor();
        assert.equal(await page.locator('.splash-screen').count(),0,'the landing page does not acquire an app splash');
        await page.close();checks++;console.log('PASS web landing page remains unchanged');
      }
    }finally{await new Promise(done=>server.close(done));}
  }
  console.log(JSON.stringify({checks,artifacts}));
}finally{await browser.close();}
