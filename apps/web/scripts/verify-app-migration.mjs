import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

// Opt-in production verification. Only disposable browser profiles are written.
const browser=await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
const screenshots=await mkdtemp(join(tmpdir(),'virelo-domain-verification-'));
try {
  const context=await browser.newContext({locale:'en-US'}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000);
  await page.goto('https://app.virelo.dev/settings?section=backup');
  await page.getByRole('heading',{name:'Export / Import',exact:true}).waitFor();
  assert.equal(new URL(page.url()).pathname,'/settings');
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.screenshot({path:join(screenshots,'backup-desktop.png'),fullPage:true});
  const backup=page.waitForEvent('download');await page.getByRole('button',{name:'Export',exact:true}).click();
  assert.equal((await backup).suggestedFilename(),'virelo-library-backup.json');
  for(const language of ['ja','zh-CN','ko','ru','en']) {
    await page.goto('https://app.virelo.dev/settings?section=backup&lang='+language);
    await page.waitForFunction(lang=>document.documentElement.lang===lang,language);
    await page.locator('#settings-title-backup').waitFor();assert.ok(!new URL(page.url()).searchParams.has('lang'));
  }
  const manifest=await(await page.request.get('https://app.virelo.dev/manifest.webmanifest')).json();
  assert.equal(manifest.start_url,'/');assert.equal(manifest.scope,'/');
  await page.getByRole('link',{name:'Library',exact:true}).first().click();await page.waitForURL('https://app.virelo.dev/library');
  await page.getByRole('link',{name:'Playlists',exact:true}).first().click();await page.waitForURL('https://app.virelo.dev/playlists');
  await page.goto('https://app.virelo.dev/settings?section=backup');await page.locator('#settings-title-backup').waitFor();
  await page.evaluate(()=>navigator.serviceWorker.ready);
  await page.reload();await page.locator('#settings-title-backup').waitFor();
  await context.setOffline(true);await page.reload();await page.locator('#settings-title-backup').waitFor();await context.setOffline(false);
  await page.setViewportSize({width:390,height:844});await page.reload();await page.locator('#settings-title-backup').waitFor();
  assert.ok(await page.locator('#settings-title-backup').isVisible());
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('.splash-screen').waitFor({state:'hidden'});
  await page.screenshot({path:join(screenshots,'backup-mobile.png'),fullPage:true});

  const old=await context.newPage();old.on('pageerror',error=>errors.push(error.message));
  await old.addInitScript(()=>{if(location.hostname==='virelo.riyo.me')localStorage.setItem('virelo.queue-layout','horizontal');});
  await old.goto('https://virelo.riyo.me/app');await old.getByRole('heading',{name:'Virelo has moved'}).waitFor();
  const exported=old.waitForEvent('download');await old.getByRole('button',{name:'Export library backup',exact:true}).click();await exported;
  assert.equal(await old.evaluate(()=>localStorage.getItem('virelo.queue-layout')),'horizontal');
  await old.getByRole('link',{name:'Open old library',exact:true}).click();await old.locator('.app-shell').waitFor();
  assert.equal(new URL(old.url()).searchParams.get('legacy'),'1');
  const oldManifest=await(await old.request.get('https://virelo.riyo.me/manifest.webmanifest')).json();assert.equal(oldManifest.start_url,'/app');

  const empty=await browser.newContext({locale:'en-US',serviceWorkers:'block'}),newcomer=await empty.newPage();
  await newcomer.goto('https://virelo.riyo.me/app/library?search=test');
  await newcomer.waitForURL(url=>url.origin==='https://app.virelo.dev'&&url.pathname==='/library');
  assert.equal(new URL(newcomer.url()).searchParams.get('search'),'test');
  const blocked=await browser.newContext({locale:'en-US',serviceWorkers:'block'}),blockedPage=await blocked.newPage();
  await blockedPage.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Blocked','SecurityError');};Storage.prototype.setItem=function(){throw new DOMException('Blocked','SecurityError');};});
  await blockedPage.goto('https://app.virelo.dev/settings?section=backup&lang=ja');
  await blockedPage.waitForFunction(()=>document.documentElement.lang==='ja');await blockedPage.locator('#settings-title-backup').waitFor();
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'passed',checks:'live root navigation, settings export, five locales, mobile, offline PWA, old data gate/export/opt-out, empty-profile redirect, storage-blocked language handoff',screenshots}));
} finally {await browser.close();}
