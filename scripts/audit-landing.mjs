import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE||import.meta.url);
const {chromium}=require('playwright');
const base=process.env.VIRELO_LP_URL||'http://127.0.0.1:5199';
const screenshots=await mkdtemp(join(tmpdir(),'virelo-landing-audit-'));
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
let checks=0;
const check=(value,name)=>{assert.ok(value,name);checks++;console.log('PASS',name);};
try {
  const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',permissions:['clipboard-read','clipboard-write']});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('dialog',async dialog=>{errors.push('Unexpected native dialog: '+dialog.type());await dialog.dismiss();});
  const imageReady=async()=>page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
  for(const [width,height] of [[1440,1000],[390,844],[320,780],[768,1024],[1024,768],[1920,1080],[3440,1440]]){
    await page.setViewportSize({width,height});await page.goto(base);await page.locator('.landing-hero').waitFor();
    await page.evaluate(()=>document.fonts.ready);
    await page.locator('.landing-preview').scrollIntoViewIfNeeded();await imageReady();await page.evaluate(()=>scrollTo(0,0));
    check(await page.locator('h1').count()===1,'one H1 '+width);
    check(await page.locator('.landing-hero-art').evaluate(image=>image.currentSrc.endsWith('/landing/hero-coast.webp')&&image.naturalWidth===2000&&image.naturalHeight===1121),'supplied hero photograph decodes '+width);
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no horizontal overflow '+width);
    const launch=await page.locator('.landing-hero-actions a').first().boundingBox();
    check(launch.width>=44&&launch.height>=44&&launch.x>=0&&launch.x+launch.width<=width,'primary CTA fits '+width);
    check(launch.y+launch.height<=height,'primary CTA in first viewport '+width);
    if(width===390){
      check(await page.locator('.landing-hero-art').evaluate(image=>getComputedStyle(image).objectPosition.startsWith('65%')),'coast photograph is framed for mobile');
      const secondary=await page.locator('.landing-hero-actions a').last().boundingBox();
      check(Math.abs(launch.width-secondary.width)<1,'mobile action widths match');
    }
    check(await page.locator('.landing-preview img').evaluate(image=>image.currentSrc.includes(innerWidth<=600?'mobile.webp':'desktop.webp')),'appropriate screenshot for '+width);
    await page.screenshot({path:join(screenshots,'hero-'+width+'.png')});
    if(width===1440||width===390)await page.screenshot({path:join(screenshots,'page-'+width+'.png'),fullPage:true});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('tab',{name:'Library',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.locator('#preview-tab-player[aria-selected="true"]').waitFor();
  check(await page.getByRole('tab',{name:'Player',exact:true}).getAttribute('aria-selected')==='true','keyboard changes screenshot');
  await imageReady();check(await page.locator('.landing-preview img').getAttribute('src')==='/landing/player-desktop.webp','player screenshot loads');
  await page.keyboard.press('Home');await page.locator('#preview-tab-home[aria-selected="true"]').waitFor();check(await page.getByRole('tab',{name:'Library',exact:true}).getAttribute('aria-selected')==='true','Home returns to library tab');
  await page.getByRole('link',{name:'Run locally',exact:true}).click();
  check(await page.getByRole('tab',{name:'Run locally',exact:true}).getAttribute('aria-selected')==='true','local launch CTA opens the command panel');
  await page.getByRole('tab',{name:'In your browser',exact:true}).click();
  await page.getByRole('tab',{name:'In your browser',exact:true}).focus();await page.keyboard.press('ArrowRight');
  await page.locator('#start-tab-cli[aria-selected="true"]').waitFor();
  check(await page.getByRole('tab',{name:'Run locally',exact:true}).getAttribute('aria-selected')==='true','keyboard changes install mode');
  await page.getByRole('button',{name:'Copy npx virelo command'}).click();
  await page.getByRole('status').filter({hasText:'Command copied'}).waitFor();
  check(await page.evaluate(()=>navigator.clipboard.readText())==='npx virelo','correct safe localhost command copied');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Permission denied');}}}));
  await page.getByRole('button',{name:'Copy npx virelo command'}).click();
  await page.getByRole('status').filter({hasText:'Select the command'}).waitFor();check(true,'clipboard failure has inline recovery');
  for(const details of await page.locator('.landing-faq details').all()){
    await details.locator('summary').focus();await page.keyboard.press('Enter');check(await details.getAttribute('open')!==null,'FAQ opens by keyboard');
  }
  const structured=await page.locator('script[type="application/ld+json"]').evaluate(node=>JSON.parse(node.textContent));
  const faq=structured['@graph'].find(entity=>entity['@type']==='FAQPage');
  check(faq.mainEntity.length===await page.locator('.landing-faq details').count(),'schema and visible FAQs agree');
  check(await page.locator('.landing-page').evaluate(root=>[...root.querySelectorAll('a[href^="#"]')].every(link=>document.getElementById(link.hash.slice(1)))),'all in-page links resolve');
  check(await page.locator('.landing-page img').evaluateAll(images=>images.every(image=>new URL(image.currentSrc).origin===location.origin)),'all artwork and screenshots bundled locally');
  await page.evaluate(()=>scrollTo(0,0));await page.getByRole('link',{name:'Skip to content',exact:true}).focus();await page.keyboard.press('Enter');
  check(await page.locator('#landing-main').evaluate(node=>document.activeElement===node),'skip link focuses content');
  await page.emulateMedia({reducedMotion:'reduce'});
  check(await page.locator('.landing-page').evaluate(root=>[...root.querySelectorAll('*')].every(node=>getComputedStyle(node).animationName==='none')),'no autoplay/decorative motion');
  await page.goto(base+'/setup');await page.locator('#setup-title').waitFor();
  check(await page.title()==='Virelo','setup title is only Virelo');
  check(await page.locator('.setup-page').evaluate(node=>getComputedStyle(node).backgroundImage==='none'),'setup shares the flat landing background');
  check(await page.locator('.landing-brand').first().isVisible(),'shared setup header remains usable');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'setup has no overflow');
  for(const width of [320,390,768,1440,3440]){
    await page.setViewportSize({width,height:844});
    await page.evaluate(()=>document.fonts.ready);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'setup mobile has no overflow '+width);
    check(await page.locator('.setup-toc').evaluate(node=>{const rect=node.getBoundingClientRect();return rect.left>=0&&rect.right<=innerWidth+1;}),'setup contents rail fits '+width);
    await page.screenshot({path:join(screenshots,'setup-'+width+'.png')});
    if(width===1440||width===390)await page.screenshot({path:join(screenshots,'setup-page-'+width+'.png'),fullPage:true});
  }
  await page.getByRole('button',{name:'Copy quick start command',exact:true}).click();
  check(await page.evaluate(()=>navigator.clipboard.readText())==='npx virelo','setup copies the correct command');
  await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('Permission denied');}}}));
  await page.getByRole('button',{name:'Copy quick start command',exact:true}).click();
  check(await page.locator('.setup-copy-error').isVisible(),'setup clipboard denial has inline recovery');
  await page.getByRole('link',{name:'Network access',exact:true}).click();
  check(new URL(page.url()).hash==='#network','setup section navigation works');
  await page.goto(base+'/app');check(await page.title()==='Virelo','app title is only Virelo');
  await page.goto(base);check(await page.title()==='Virelo','landing title is only Virelo');
  check(errors.length===0,'no runtime errors or native dialogs '+errors.join('|'));
  const fallback=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'}),nojs=await fallback.newPage();await nojs.goto(base);
  check(await nojs.getByRole('heading',{level:1}).count()===1,'no-JS product heading');
  check(await nojs.locator('main').textContent().then(text=>text.includes('npx virelo')&&text.includes('files stay on your device')),'core install and privacy facts without JS');
  check(await nojs.locator('a[href="/app"]').count()>0,'no-JS launch link');
  await fallback.close();await context.close();
  console.log(JSON.stringify({checks,screenshots,base}));
}finally{await browser.close();}
