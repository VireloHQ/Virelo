import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createVireloServer } from '../dist/server.js';

const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const artifacts = await mkdtemp(join(tmpdir(), 'virelo-motion-'));
process.env.VIRELO_LOG_LEVEL = 'silent';
const { app, db } = await createVireloServer({ dataDir: join(artifacts, 'data'), mediaPaths: [], host: '127.0.0.1', port: 0 });
db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
await app.listen({ host: '127.0.0.1', port: 0 });
const modes = [['npm', 'http://127.0.0.1:' + app.server.address().port]];
let browser, lastPage, webServer, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS', label); };
async function serveWeb() {
  const repo = resolve(process.env.VIRELO_TEST_WEB_REPO);
  webServer = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
    { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Vite startup timed out: ' + output)), 20000);
    webServer.once('error', error => { clearTimeout(timer); reject(error); });
    webServer.stderr.on('data', chunk => { output += chunk; });
    webServer.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
}
const scenarios = [
  { name: 'desktop', width: 1440, height: 900, touch: false, reduce: false },
  { name: 'touch', width: 390, height: 844, touch: true, reduce: false },
  { name: 'landscape', width: 844, height: 390, touch: true, reduce: false },
  { name: 'reduced', width: 1440, height: 900, touch: false, reduce: true }
];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}) });
  if (process.env.VIRELO_TEST_WEB_REPO) modes.push(['web', await serveWeb()]);
  for (const [mode, base] of modes) for (const [index, scenario] of scenarios.entries()) {
    const label = mode + ' ' + scenario.name, prefix = mode === 'npm' ? '' : '/app';
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: scenario.width, height: scenario.height },
      isMobile: scenario.touch, hasTouch: scenario.touch, reducedMotion: scenario.reduce ? 'reduce' : 'no-preference' });
    const page = lastPage = await context.newPage(), errors = [];
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__motion = [];
      for (const type of ['transitionrun', 'animationstart']) document.addEventListener(type, event => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const animations = target.getAnimations().map(animation => ({ name: animation.animationName || '', property: animation.transitionProperty || '',
          duration: animation.effect.getTiming().duration, easing: animation.effect.getTiming().easing,
          frames: animation.effect.getKeyframes().map(frame => ({ opacity: frame.opacity, transform: frame.transform, scale: frame.scale })) }));
        window.__motion.push({ type, className: String(target.className), property: event.propertyName || '', name: event.animationName || '', animations });
      }, true);
      window.__capture = selector => new Promise(resolve => {
        const frames = [];
        const sample = () => {
          const element = document.querySelector(selector);
          if (element) { const r = element.getBoundingClientRect(); frames.push({ x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }); }
          if (frames.length >= 28) resolve(frames); else requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
      });
    });
    if (mode === 'npm') {
      const response = await page.request.post(base + (index === 0 ? '/api/auth/setup' : '/api/auth/login'),
        { headers: { 'X-Virelo-Request': '1' }, data: { username: 'motion-audit', displayName: 'Motion audit', password: '1' } });
      assert.equal(response.status(), 200, await response.text());
    }
    async function settings(section) {
      await page.goto(base + prefix + '/settings#' + section);
      await page.locator('.splash-screen').waitFor({ state: 'hidden' });
      if (mode === 'web') {
        const nav = page.locator('#settings-nav-' + section);
        await nav.waitFor({ state: 'attached' });
        if (!(await nav.isVisible())) await page.getByRole('button', { name: 'All settings', exact: true }).click();
        await nav.click();
      }
      await page.locator('#settings-panel-' + section).waitFor();
      await page.evaluate(() => document.fonts.ready);
    }
    const settled = locator => locator.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const focused = async locator => {
      const element = await locator.elementHandle();
      try { await page.waitForFunction(target => document.activeElement === target, element, { timeout: 1000 }); }
      finally { await element.dispose(); }
    };
    const stable = (frames, name) => {
      const spread = field => Math.max(...frames.map(r => r[field])) - Math.min(...frames.map(r => r[field]));
      check(frames.length === 28 && ['x', 'y', 'width', 'height'].every(field => spread(field) < 0.6), label + ' ' + name);
    };
    await settings('shorts');
    stable(await page.evaluate(() => window.__capture('.settings-heading h1')), 'page text stays in its final position after loading');
    const pageEvents = await page.evaluate(() => window.__motion.filter(event => /content-view|settings-section/.test(event.className)));
    check(pageEvents.every(event => event.property === 'opacity' && event.type === 'transitionrun'), label + ' page entry changes opacity only');
    const rowText = '#settings-panel-shorts .setting-copy';
    const thumb = page.locator('#settings-panel-shorts .switch__thumb');
    const toggle = page.getByRole('switch', { name: 'Include landscape videos' });
    const original = await toggle.isChecked();
    await page.evaluate(() => { window.__motion = []; });
    const recording = page.evaluate(selector => window.__capture(selector), rowText);
    await page.locator('#settings-panel-shorts .switch__control').click();
    await settled(thumb);
    check((await toggle.isChecked()) !== original, label + ' Switch updates immediately');
    stable(await recording, 'Switch does not move its description');
    const thumbEvents = await page.evaluate(() => window.__motion.filter(event => event.className.includes('switch__thumb') && event.property === 'transform'));
    check(scenario.reduce ? thumbEvents.length === 0 : thumbEvents.some(event => event.animations.some(animation => animation.duration === 200)),
      label + ' Switch uses the shared transform timing, with reduced-motion support');
    await toggle.focus(); await page.keyboard.press('Space'); await settled(thumb);
    check((await toggle.isChecked()) === original, label + ' keyboard Switch operation stays immediate and reversible');

    await settings('playback');
    const trigger = page.getByRole('button', { name: 'Queue advance', exact: true });
    const panel = page.locator('.settings-picker .picker-menu');
    const triggerRect = () => trigger.evaluate(element => {
      const rect = element.getBoundingClientRect(); return { x: rect.x + scrollX, y: rect.y + scrollY };
    });
    const triggerBefore = await triggerRect();
    await trigger.click(); await settled(panel);
    check(await page.getByRole('listbox', { name: 'Queue advance' }).isVisible(), label + ' pointer Dropdown opens');
    const panelMotion = await panel.evaluate(element => ({ transform: getComputedStyle(element).transform,
      transition: getComputedStyle(element).transitionProperty, origin: getComputedStyle(element).transformOrigin }));
    check(panelMotion.transition.includes('opacity') && panelMotion.origin.split(' ')[1] === '0px', label + ' Dropdown is anchored and uses opacity');
    await page.screenshot({ path: join(artifacts, mode + '-' + scenario.name + '-dropdown.png') });
    await page.getByRole('option', { name: 'Manual next only', exact: true }).click();
    check(await panel.evaluate(element => element.hidden && element.inert && element.getAttribute('aria-hidden') === 'true'), label + ' closing Dropdown is immediately inert');
    await panel.waitFor({ state: 'hidden' });
    const triggerAfter = await triggerRect();
    check(Math.abs(triggerBefore.x - triggerAfter.x) < 0.6 && Math.abs(triggerBefore.y - triggerAfter.y) < 0.6, label + ' Dropdown does not shift its trigger');
    await trigger.focus(); await page.keyboard.press('ArrowDown');
    check(await panel.evaluate(element => element.getAnimations().length === 0), label + ' keyboard Dropdown does not animate');
    await page.keyboard.press('Escape');
    await focused(trigger);
    check(await trigger.evaluate(element => element === document.activeElement), label + ' Dropdown restores focus');
    check(await panel.evaluate(element => getComputedStyle(element).display === 'none'), label + ' keyboard dismissal is immediate');

    await settings(mode === 'npm' ? 'network' : 'metadata');
    const modalTrigger = page.getByRole('button', { name: 'Clear all metadata', exact: true });
    await modalTrigger.scrollIntoViewIfNeeded();
    await modalTrigger.evaluate(element => element.addEventListener('pointerdown', () => {
      const { x, y } = document.querySelector('.settings-heading h1').getBoundingClientRect();
      window.__beforeModal = { x, y };
    }, { once: true }));
    await page.evaluate(() => { window.__motion = []; });
    await modalTrigger.click();
    const dialog = page.getByRole('alertdialog', { name: 'Clear all metadata?' });
    await dialog.waitFor();
    await settled(page.locator('.virelo-confirm-container'));
    const box = await dialog.boundingBox();
    check(box.x >= 0 && box.y >= 0 && box.x + box.width <= scenario.width && box.y + box.height <= scenario.height, label + ' Modal fits the viewport');
    const afterModal = await page.locator('.settings-heading h1').boundingBox();
    const beforeModal = await page.evaluate(() => window.__beforeModal);
    check(Math.abs(beforeModal.x - afterModal.x) < 0.6 && Math.abs(beforeModal.y - afterModal.y) < 0.6, label + ' Modal scroll lock does not shift the page');
    const modalEvents = await page.evaluate(() => window.__motion.filter(event => event.className.includes('virelo-confirm-container') && event.type === 'transitionrun'));
    const modalDurations = await page.locator('.virelo-confirm-container').evaluate(element => getComputedStyle(element).transitionDuration.split(',').map(value => parseFloat(value) * 1000));
    // Interrupted CSS transitions can have shortened effect timings; the shared duration stays 250ms.
    const timedEntry = modalDurations.every(duration => Math.abs(duration - 250) < 1)
      && modalEvents.some(event => event.animations.some(animation => animation.duration > 0 && animation.duration <= 251));
    const modalTimingValid = scenario.reduce ? modalEvents.length === 0 : timedEntry;
    check(modalTimingValid, label + ' Modal uses the shared 250ms timing or reduced motion'
      + (modalTimingValid ? '' : ': ' + JSON.stringify({ modalDurations, modalEvents })));
    await page.screenshot({ path: join(artifacts, mode + '-' + scenario.name + '-modal.png') });
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await focused(modalTrigger);
    check(await modalTrigger.evaluate(element => element === document.activeElement), label + ' Modal preserves focus restoration');
    await modalTrigger.focus(); await page.keyboard.press('Enter'); await dialog.waitFor();
    check(await page.locator('.virelo-confirm-container').evaluate(element => element.getAnimations().length === 0), label + ' keyboard Modal does not animate');
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'hidden' });

    await modalTrigger.click();
    const cancelBox = await dialog.getByRole('button', { name: 'Cancel', exact: true }).boundingBox();
    await page.mouse.click(cancelBox.x + cancelBox.width / 2, cancelBox.y + cancelBox.height / 2);
    await dialog.waitFor({ state: 'hidden' });
    await focused(modalTrigger);
    check(await modalTrigger.evaluate(element => element === document.activeElement), label + ' Modal can be dismissed during entry without trapping focus');

    await settings('playback');
    const brandBefore = await page.locator('.brand').boundingBox();
    const settingsButtonBefore = scenario.touch ? null : await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
    await page.getByRole('button', { name: 'Search', exact: true }).click();
    const search = page.getByRole('textbox', { name: /Search library/ });
    await search.waitFor(); await settled(page.locator('.header-search-toggle'));
    const brandAfter = await page.locator('.brand').boundingBox();
    check(Math.abs(brandBefore.x - brandAfter.x) < 0.6 && Math.abs(brandBefore.width - brandAfter.width) < 0.6, label + ' search opens without moving the brand');
    if (settingsButtonBefore) {
      const settingsButtonAfter = await page.getByRole('button', { name: 'Settings', exact: true }).boundingBox();
      check(Math.abs(settingsButtonBefore.x - settingsButtonAfter.x) < 0.6, label + ' search does not reflow adjacent controls');
    }
    await focused(search);
    check(await search.evaluate(element => element === document.activeElement), label + ' search remains keyboard accessible');
    await page.screenshot({ path: join(artifacts, mode + '-' + scenario.name + '-search.png') });
    await page.keyboard.press('Escape'); await settled(page.locator('.header-search-toggle'));
    check(await page.getByRole('button', { name: 'Search', exact: true }).getAttribute('aria-expanded') === 'false', label + ' search closes with Escape');
    check(errors.length === 0, label + ' no browser exceptions: ' + JSON.stringify(errors));
    await context.close();
  }
  console.log('Motion audit passed: ' + checks + ' assertions. Artifacts: ' + artifacts);
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: join(artifacts, 'failure.png') }).catch(() => {});
    console.error(await lastPage.locator('body').innerText());
    console.error(JSON.stringify(await lastPage.evaluate(() => window.__motion?.slice(-8)), null, 2));
  }
  console.error('Motion artifacts:', artifacts);
  throw error;
} finally {
  await browser?.close();
  await app.close();
  webServer?.kill();
}
