// Inspect the actual production output, including the frame before JavaScript runs.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { publicPages, assertPublicHtml } from './helpers/public-seo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const server = spawn(process.execPath, [join(root,'node_modules/vite/bin/vite.js'),'preview','--host','127.0.0.1','--port','0'],
  {cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
let browser, checks = 0;
try {
  const base = await new Promise((resolve,reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output || 'Preview did not start')), 20000);
    server.once('error',reject);
    server.stderr.on('data',chunk => {output += chunk;});
    server.stdout.on('data',chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g,'');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) {clearTimeout(timer);resolve(url);}
    });
  });
  browser = await chromium.launch({headless:true,executablePath:process.env.VIRELO_TEST_CHROMIUM});
  for (const expected of publicPages) {
    const response = await fetch(base + expected.path);
    assert.equal(response.status,200);
    assertPublicHtml(await response.text(),expected);
    const context = await browser.newContext({locale:'en-US',serviceWorkers:'block',viewport:{width:1440,height:900}});
    // Conflicting saved/browser language must not replace the requested public document.
    await context.addInitScript(() => localStorage.setItem('virelo.language.v1','ru'));
    const page = await context.newPage(), errors = [], scripts = [];
    page.on('pageerror',error => errors.push(error.message));
    page.on('console',message => {if (message.type() === 'error') errors.push(message.text());});
    page.on('request',request => {if(request.resourceType() === 'script') scripts.push(request.url());});
    let release;
    const gate = new Promise(resolve => {release = resolve;});
    await page.route('**/*.js',async route => {await gate;await route.continue().catch(() => {});});
    try {
      await page.goto(base + expected.path,{waitUntil:'commit'});
      const heading = page.locator('h1');
      await heading.waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.equal(await page.locator('html').getAttribute('lang'),expected.locale);
      const before = await heading.boundingBox(), text = await heading.textContent();
      assert.ok(before.height > 0 && text.length > 5,'Readable first frame without JavaScript');
      release();
      await page.waitForLoadState('load');
      const trigger = page.locator('.public-language-select .picker-trigger');
      await trigger.click();
      await page.getByRole('listbox').waitFor({state:'visible'});
      await page.keyboard.press('Escape');
      const after = await heading.boundingBox();
      assert.equal(await heading.textContent(),text,'Hydration preserves the requested language');
      for (const key of ['x','y','width','height']) assert.ok(Math.abs(before[key]-after[key]) < 1,'No hydration layout shift: ' + key);
      assert.equal(await page.locator('link[rel="canonical"]').getAttribute('href'),'https://virelo.riyo.me'+expected.path);
      assert.deepEqual(errors,[],'No hydration or browser errors at '+expected.path);
      assert.ok(!scripts.some(url => /\/(?:Player-|mediabunny|ffmpeg|avi-playback)/.test(url)),'Marketing entry does not load the video engine');
      checks++;
      console.log('PASS raw HTML, first frame, hydration and metadata:',expected.path);
    } finally {release();await context.close();}
  }
  for (const path of ['/app','/app/settings','/app/watch/1','/library','/watch/1']) {
    const response = await fetch(base+path), html = await response.text();
    assert.equal(response.status,200);
    assert.ok(html.includes('name="robots" content="noindex, follow"') && !html.includes('landing-title'),path);
    checks++;
  }
  for (const path of ['/assets/virelo-nonexistent.js','/missing-page']) {
    const response = await fetch(base+path);
    assert.equal(response.status,404,path+' remains a real 404');
    checks++;
  }
  console.log(JSON.stringify({checks,result:'passed'}));
} finally {
  if (browser) await browser.close();
  server.kill();
}
