import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const require=createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const {chromium}=require('playwright');
const screenshots=await mkdtemp(join(tmpdir(),'virelo-dialog-audit-'));
const browser=await chromium.launch({headless:true,...(process.env.VIRELO_TEST_CHROMIUM?{executablePath:process.env.VIRELO_TEST_CHROMIUM}:{})});
let checks=0;
const check=(value,message)=>{assert.ok(value,message);checks++;};
try {
  for(const mode of ['npm','web']) {
    const context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce'});
    const page=await context.newPage();
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>{errors.push('Native '+dialog.type());void dialog.dismiss();});
    await page.addInitScript(()=>{
      for(const name of ['confirm','alert','prompt'])window[name]=()=>{throw new Error('Native dialog is forbidden: '+name);};
    });
    const prefix=mode==='npm'?'':'/app';
    const base=(mode==='npm'?process.env.VIRELO_TEST_NPM_URL:process.env.VIRELO_TEST_WEB_URL)||('http://127.0.0.1:'+(mode==='npm'?5198:5199));
    let calls=0,fail=true,release;
    if(mode==='npm')await page.route('**/api/**',async route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/api/metadata') {
        calls++;
        await new Promise(resolve=>{release=resolve;});
        return route.fulfill(fail?{status:500,json:{error:'Test failure. Try again.'}}:{json:{cleared:12}});
      }
      return route.fulfill({json:url.pathname==='/api/settings'?{externalMetadataEnabled:true,externalImagesEnabled:true,queueBehavior:'auto',shortsIncludeLandscapes:false}:url.pathname==='/api/libraries'?[]:{}});
    });
    await page.goto(base+prefix+'/settings');
    await page.locator('#settings-nav-'+(mode==='npm'?'network':'metadata')).click();
    await page.waitForTimeout(2200);
    if(mode==='web')await page.evaluate(async()=>{
      const {api}=await import('/src/api.ts');
      window.__dialogCalls=0;
      window.__dialogFail=true;
      api.clearAllMetadata=async()=>{
        window.__dialogCalls++;
        await new Promise(resolve=>{window.__releaseDialog=resolve;});
        if(window.__dialogFail)throw new Error('Test failure. Try again.');
        return {cleared:12};
      };
    });
    // Refresh mutation options after replacing the browser API with this isolated failure fixture.
    if(mode==='web') {
      await page.locator('#settings-nav-libraries').click();
      await page.locator('#settings-nav-metadata').click();
    }
    const trigger=page.getByRole('button',{name:'Clear all metadata',exact:true});
    const dialog=page.getByRole('alertdialog',{name:'Clear all metadata?'});
    const cancel=dialog.getByRole('button',{name:'Cancel',exact:true});
    const confirm=dialog.getByRole('button',{name:'Clear metadata',exact:true});
    await trigger.click();
    await cancel.waitFor();
    check(await cancel.evaluate(button=>button===document.activeElement),'Cancel has initial focus '+mode);
    check(Boolean(await dialog.getAttribute('aria-describedby')),'confirmation has accessible description '+mode);
    for(let i=0;i<5;i++) {
      await page.keyboard.press('Tab');
      check(await dialog.evaluate(element=>element.contains(document.activeElement)),'Tab stays in modal '+mode);
    }
    await page.keyboard.press('Escape');
    await dialog.waitFor({state:'hidden'});
    check(await trigger.evaluate(button=>button===document.activeElement),'Escape returns focus to trigger '+mode);
    await trigger.click();
    await cancel.click();
    await dialog.waitFor({state:'hidden'});
    check((mode==='npm'?calls:await page.evaluate(()=>window.__dialogCalls))===0,'Cancel does not clear metadata '+mode);
    await trigger.click();
    await page.locator('.virelo-confirm-backdrop').click({position:{x:3,y:3}});
    await dialog.waitFor({state:'hidden'});
    check((mode==='npm'?calls:await page.evaluate(()=>window.__dialogCalls))===0,'outside click does not clear metadata '+mode);
    for(const viewport of [{width:1440,height:900},{width:375,height:812},{width:844,height:390}]) {
      await page.setViewportSize(viewport);
      await trigger.click();
      await dialog.waitFor();
      const box=await dialog.boundingBox();
      check(box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'modal fits viewport '+mode+' '+viewport.width);
      for(const button of [cancel,confirm])check((await button.boundingBox()).height>=44,'dialog touch target '+mode);
      await page.screenshot({path:join(screenshots,mode+'-'+viewport.width+'.png')});
      await cancel.click();
      await dialog.waitFor({state:'hidden'});
    }
    await page.setViewportSize({width:1440,height:900});
    await trigger.click();
    await confirm.click();
    await page.waitForFunction(()=>document.querySelector('.virelo-confirm-action')?.disabled);
    await page.keyboard.press('Escape');
    check(await dialog.isVisible(),'pending operation cannot be dismissed '+mode);
    check(await cancel.isDisabled()&&await confirm.isDisabled(),'pending buttons disabled '+mode);
    check((mode==='npm'?calls:await page.evaluate(()=>window.__dialogCalls))===1,'one request while pending '+mode);
    if(mode==='npm')release();else await page.evaluate(()=>window.__releaseDialog());
    await dialog.getByRole('alert').waitFor();
    check(await dialog.isVisible(),'failure stays in original modal '+mode);
    check((await dialog.getByRole('alert').innerText()).includes('Test failure'),'failure message visible '+mode);
    if(mode==='npm')fail=false;else await page.evaluate(()=>{window.__dialogFail=false;});
    await confirm.click();
    await page.waitForFunction(()=>document.querySelector('.virelo-confirm-action')?.disabled);
    if(mode==='npm')release();else await page.evaluate(()=>window.__releaseDialog());
    await dialog.waitFor({state:'hidden'});
    await page.getByText('Metadata cleared for 12 videos.').waitFor();
    check((mode==='npm'?calls:await page.evaluate(()=>window.__dialogCalls))===2,'retry succeeds without duplicate request '+mode);
    check(await trigger.evaluate(button=>button===document.activeElement),'success restores focus '+mode);
    check(errors.length===0,'no native dialogs or browser errors '+mode+': '+errors.join(', '));
    await context.close();
    console.log('PASS dialogs',mode,'checks',checks);
  }
  console.log(JSON.stringify({checks,result:'passed',screenshots}));
} finally {
  await browser.close();
}
