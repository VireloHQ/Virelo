import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const artifacts = await mkdtemp(join(tmpdir(), 'virelo-queue-'));
const fixture = join(artifacts, 'clip.mp4');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i',
  'color=c=0x283b55:s=320x180:r=10:d=90', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart', fixture], { windowsHide: true });
const clip = await readFile(fixture);
const fulfillClip = route => {
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: clip });
  const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
  return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + start + '-' + end + '/' + clip.length }, body: clip.subarray(start, end + 1) });
};
const children = [];
let browser, lastPage, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label); };
async function serve(path) {
  const child = spawn(process.execPath, [join(path, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
    { cwd: path, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output)), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
}
const scenarios = [
  { name: 'desktop', width: 1440, height: 1000, touch: false, reduced: false },
  { name: 'mobile', width: 390, height: 844, touch: true, reduced: false },
  { name: 'small', width: 320, height: 780, touch: true, reduced: false },
  { name: 'reduced', width: 1440, height: 1000, touch: false, reduced: true }
].filter(scenario => !process.env.VIRELO_TEST_QUEUE_SCENARIO || scenario.name === process.env.VIRELO_TEST_QUEUE_SCENARIO);
async function drag(page, from, to, touch, preview=false) {
  const aligned=async point=>{
    const grip=page.locator('.queue-drag-preview>svg');await grip.waitFor();
    await settle(page);
    const rect=await grip.boundingBox();
    const error={x:rect.x+rect.width/2-point.x,y:rect.y+rect.height/2-point.y};
    const layout=await page.locator('.playback-queue').getAttribute('data-layout'),valid=Math.abs(error.x)<3&&Math.abs(error.y)<3;
    check(valid,'drag preview grip stays under the pointer in '+layout+(valid?'':' '+JSON.stringify({error,point,rect,preview:await page.locator('.queue-drag-preview').getAttribute('style')})));
    await page.screenshot({path:join(artifacts,(new URL(page.url()).pathname.startsWith('/app')?'web':'npm')+'-'+page.viewportSize().width+'-'+layout+'-drag.png')});
  };
  if (!touch) {
    await page.mouse.move(from.x, from.y); await page.mouse.down();
    await page.mouse.move(from.x + 8, from.y, { steps: 3 });
    if(preview){
      await page.locator('.queue-drag-preview').waitFor();await settle(page);
      await page.mouse.move(from.x+12,from.y);await aligned({x:from.x+12,y:from.y});
    }
    await page.mouse.move(to.x, to.y, { steps: 16 });
    if(preview)await aligned(to);
    await page.mouse.up();
  } else {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= 16; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: from.x + (to.x - from.x) * i / 16, y: from.y + (to.y - from.y) * i / 16 }] });
      await page.waitForTimeout(12);
    }
    if(preview)await aligned(to);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); await cdp.detach();
  }
  // dnd-kit's pointer sensor suppresses the synthetic click following release for 50ms.
  await page.waitForTimeout(70);
}
async function settle(page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });
  const mode = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).name === 'virelo' ? 'npm' : 'web';
  const modes = [[mode, await serve(repo)]];
  if (process.env.VIRELO_TEST_WEB_REPO && mode === 'npm') modes.push(['web', await serve(resolve(process.env.VIRELO_TEST_WEB_REPO))]);
  for (const [mode, base] of modes) for (const scenario of scenarios) {
    const label = mode + ' ' + scenario.name, prefix = mode === 'web' ? '/app' : '';
    const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height },
      hasTouch: scenario.touch, isMobile: scenario.touch, reducedMotion: scenario.reduced ? 'reduce' : 'no-preference', serviceWorkers: 'block' });
    const page = lastPage = await context.newPage(), errors = [], writes = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.route(base + '/__queue-audit', route => route.fulfill({ contentType: 'text/html',
      body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="fixture"></div></body></html>' }));
    await page.route('**/__queue-clip.mp4', fulfillClip);
    await page.route('**/api/**', route => {
      const request = route.request();
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.url());
      if (request.url().endsWith('/stream')) return fulfillClip(route);
      if (/\/artwork\//.test(request.url())) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#29465b"/><circle cx="235" cy="50" r="60" fill="#615683"/></svg>' });
      return route.fulfill({ json: {} });
    });
    await page.goto(base + '/__queue-audit');
    await page.evaluate(async ({ mode, base, prefix }) => {
      const Refresh = (await import('/@react-refresh')).default; Refresh.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
      const main = await (await fetch('/src/main.tsx')).text();
      const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
      const React = (await import(imports.find(url => url.includes('/react.js')))).default;
      const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
      const { QueryClient, QueryClientProvider } = await import(imports.find(url => url.includes('react-query')));
      const { RouterProvider } = await import(imports.find(url => url.includes('react-router')));
      const { api } = await import('/src/api.ts');
      await import('/src/styles.css'); await import('/src/streaming-ui.css'); await import('/src/ui-motion.css');
      const svg = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#29465b"/><circle cx="235" cy="50" r="60" fill="#615683"/></svg>');
      const items = Array.from({ length: 24 }, (_, index) => ({
        id: index + 1, library_id: 1, title: 'Video ' + String(index + 1).padStart(2, '0'), sort_title: String(index),
        filename: 'clip-' + index + '.mp4', path: 'clip-' + index + '.mp4', folder: '', kind: 'movie',
        duration: 90, width: 320, height: 180, liked: 0, size: 1, mtime: 0, added_at: 0, updated_at: 0,
        thumbnail_path: mode === 'web' ? svg : 'thumbnail-' + index + '.jpg', poster_path: null, backdrop_path: null, overview: null
      }));
      window.__items = items; window.__sourceLoads = 0; window.__loadsByMediaId = {}; window.__requests = []; window.__mutations = [];
      api.media = async (params = {}) => { if (window.__failRefetch) throw new Error('Test refresh failure'); window.__requests.push(params); const { offset = 0, limit = 500 } = params; return items.slice(offset, offset + limit).map(item => ({ ...item })); };
      api.mediaById = async id => ({ ...items.find(item => item.id === id) });
      api.mediaSource = async id => { window.__sourceLoads++; window.__loadsByMediaId[id]=(window.__loadsByMediaId[id]??0)+1; return base + '/__queue-clip.mp4'; };
      api.mediaFile = async () => new File([await (await fetch(base + '/__queue-clip.mp4')).arrayBuffer()], 'clip.mp4', { type: 'video/mp4' });
      api.playbackInfo = async id => { window.__sourceLoads++; window.__loadsByMediaId[id]=(window.__loadsByMediaId[id]??0)+1; return { audioTracks: [], subtitleTracks: [], qualityOptions: [], defaultAudioStream: null, requiresTranscode: false }; };
      api.progress = async () => {}; api.thumbnail = async () => null;
      api.settings = async () => ({ queueBehavior: 'auto', externalMetadataEnabled: false });
      api.libraries = async () => []; api.folders = async () => [];
      for (const key of ['saveSettings', 'removeLibrary', 'deleteAccount', 'setLike']) api[key] = async () => { window.__mutations.push(key); throw new Error('Queue must not mutate library or settings'); };
      const client = window.__client = new QueryClient({ defaultOptions: { queries: { staleTime: 20000, retry: false, refetchOnWindowFocus: false } } });
      const { router } = await import('/src/router.tsx'); window.__router = router;
      await router.navigate({ to: prefix + '/watch/1', search: { queue: true } });
      (dom.createRoot || dom.default.createRoot)(document.getElementById('fixture')).render(React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
    }, { mode, base, prefix });
    const queue = page.locator('.playback-queue'), list = page.locator('.playback-queue-list');
    const ids = () => page.locator('.playback-queue-tile').evaluateAll(nodes => nodes.map(node => Number(node.dataset.queueId)));
    const action = async (id, name) => {
      await page.locator('[data-queue-id="' + id + '"] .queue-item-menu').click();
      await page.getByRole('menuitem', { name, exact: true }).click();
      await settle(page);
    };
    const reset = async () => { await queue.getByRole('button', { name: 'Queue options', exact: true }).click(); await page.getByRole('menuitem', { name: 'Reset queue', exact: true }).click(); await settle(page); };
    await queue.waitFor(); await page.waitForFunction(() => { const video=document.querySelector('.player video'); return video&&video.readyState>=2&&!video.paused&&video.currentTime>.1; });
    await page.locator('.player').hover();await page.locator('.player-play-button').click();
    await page.waitForFunction(()=>document.querySelector('.player video').paused);
    check(await page.locator('.playback-queue-tile').count() === 24, label + ' loads all queue entries');
    check(await list.evaluate(node => getComputedStyle(node).scrollSnapType === 'none'), label + ' no snapping fights wheel or touch');
    await page.evaluate(() => { const video = document.querySelector('.player video'); window.__originalVideo = video; video.currentTime = 10; video.pause(); window.__baselineLoads = window.__loadsByMediaId[1]; window.__originalSource = video.currentSrc; window.__videoLoads = 0; video.addEventListener('loadstart',()=>window.__videoLoads++); });
    await page.waitForFunction(() => document.querySelector('.player video').currentTime >= 9 && !document.querySelector('.player video').seeking);
    await list.scrollIntoViewIfNeeded(); await list.evaluate(node => node.scrollTo({ left: 0, behavior: 'instant' }));
    if (!scenario.touch) {
      await list.hover(); await page.mouse.wheel(0, 80);
      await page.waitForFunction(() => document.querySelector('.playback-queue-list').scrollLeft > 30);
      const start = await list.evaluate(node => node.scrollLeft);
      await page.mouse.wheel(0, 400); await page.waitForFunction(start => document.querySelector('.playback-queue-list').scrollLeft > start + 150, start);
      check(true, label + ' small and large wheel input makes measurable progress');
      await page.mouse.wheel(0, -160); await page.waitForTimeout(200);
      check(await list.evaluate(node => node.scrollLeft) > 0, label + ' reverse wheel remains usable');
    } else {
      const rect = await list.boundingBox();
      await drag(page, { x: rect.x + 220, y: rect.y + 55 }, { x: rect.x + 35, y: rect.y + 55 }, true);
      await page.waitForFunction(() => document.querySelector('.playback-queue-list').scrollLeft > 30);
      check(true, label + ' native touch swipe scrolls horizontal list');
    }
    await page.getByRole('button', { name: 'Scroll queue right', exact: true }).click();
    await page.waitForTimeout(scenario.reduced ? 30 : 350);
    check(await list.evaluate(node => node.scrollLeft) > 100, label + ' browse arrows scroll the rail');
    await list.focus(); await page.keyboard.press('Home');
    await page.waitForFunction(() => document.querySelector('.playback-queue-list').scrollLeft < 2);
    check(true, label + ' keyboard Home returns to queue start');
    const firstHandle = page.getByRole('button', { name: 'Reorder Video 01', exact: true });
    const secondHandle = page.getByRole('button', { name: 'Reorder Video 02', exact: true });
    const a = await firstHandle.boundingBox(), b = await secondHandle.boundingBox();
    await drag(page, { x: a.x + a.width / 2, y: a.y + a.height / 2 }, { x: b.x + b.width / 2 + 8, y: b.y + b.height / 2 }, scenario.touch,true);
    await page.waitForFunction(() => document.querySelector('.playback-queue-tile')?.dataset.queueId === '2');
    check((await ids())[1] === 1, label + ' horizontal pointer drag reorders');
    check(await page.locator('.watch-copy h1').textContent() === 'Video 01', label + ' moving current video preserves selection');
    await reset();
    await firstHandle.focus(); await page.keyboard.press('Space'); await settle(page); await page.keyboard.press('ArrowRight'); await settle(page); await page.keyboard.press('Space'); await settle(page);
    await page.waitForFunction(() => document.querySelector('.playback-queue-tile')?.dataset.queueId === '2');
    check(true, label + ' horizontal keyboard drag reorders');
    await reset();
    const originalOrder = await ids();
    await queue.getByRole('button', { name: 'Shuffle queue', exact: true }).click();
    check(await queue.getByRole('button', { name: 'Shuffle queue', exact: true }).getAttribute('aria-pressed') === 'true', label + ' shuffle is enabled');
    const compact=await page.evaluate(()=>matchMedia('(max-width:650px), (max-width:1000px) and (max-height:500px)').matches);
    const transportShuffle=page.locator('.player-transport').locator('button[aria-label="Shuffle queue"]');
    check(await transportShuffle.getAttribute('aria-pressed')==='true',label+' player shuffle mirrors the queue');
    check((await ids())[0] === 1 && new Set(await ids()).size === 24, label + ' shuffle preserves playing item and membership');
    if(compact){
      check(!await transportShuffle.isVisible(),label+' mobile player does not duplicate the Queue shuffle button');
      const transport=page.locator('.player-transport');
      check(JSON.stringify(await transport.getByRole('button').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label'))))===JSON.stringify(['Previous video','Rewind 10 seconds','Play','Fast-forward 30 seconds','Next video']),label+' mobile queued playback keeps all five core controls');
      check(await transport.getByRole('button').evaluateAll(buttons=>buttons.every(button=>{const box=button.getBoundingClientRect();return box.width>=44&&box.height>=44;})),label+' mobile queue transport retains 44px touch targets');
      await page.locator('.player').getByRole('button',{name:'Fullscreen',exact:true}).click();
      await page.waitForFunction(()=>Boolean(document.fullscreenElement));
      await page.waitForTimeout(350);
      check(await transportShuffle.isVisible(),label+' fullscreen keeps shuffle accessible when the Queue is outside the player');
      await transportShuffle.click();
      await page.evaluate(()=>document.exitFullscreen());
      await page.waitForTimeout(350);
    }else await transportShuffle.click();
    check(JSON.stringify(await ids()) === JSON.stringify(originalOrder)&&await queue.getByRole('button',{name:'Shuffle queue',exact:true}).getAttribute('aria-pressed')==='false', label + ' player shuffle off restores custom order and syncs the queue');
    await queue.getByRole('button', { name: 'Repeat queue', exact: true }).click();
    check(await queue.getByRole('button', { name: 'Repeat queue', exact: true }).getAttribute('aria-pressed') === 'true', label + ' repeat enables');
    check(await page.locator('.player-transport').locator('button[aria-label="Repeat"]').getAttribute('aria-pressed')==='true',label+' player repeat mirrors the queue');
    await queue.getByRole('button', { name: 'Repeat queue', exact: true }).click();
    check(await queue.getByRole('button', { name: 'Repeat queue', exact: true }).getAttribute('aria-pressed') === 'false', label + ' repeat disables');
    await action(4, 'Play next'); check((await ids())[1] === 4, label + ' play next changes order');
    await action(4, 'Remove from queue'); check(!(await ids()).includes(4), label + ' removal only excludes selected queue entry');
    await page.evaluate(() => window.__client.invalidateQueries({ queryKey: ['watch-queue'] }));
    check(!(await ids()).includes(4), label + ' metadata refetch does not revert exclusion');
    await page.evaluate(() => { window.__failRefetch = true; return window.__client.invalidateQueries({ queryKey: ['watch-queue'] }); });
    await page.getByRole('alert').filter({ hasText: 'Could not refresh the queue' }).waitFor();
    check(!(await ids()).includes(4) && await page.locator('.watch-copy h1').textContent() === 'Video 01', label + ' failed background refresh keeps edited queue and playback');
    await page.evaluate(() => { window.__failRefetch = false; });
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await page.waitForFunction(() => !document.querySelector('.watch-copy [role="alert"]'));
    await page.getByRole('button', { name: 'Undo queue change', exact: true }).click(); check((await ids())[1] === 4, label + ' undo restores exclusion');
    await reset();
    const continuity = await page.evaluate(() => ({ sameNode: document.querySelector('.player video') === window.__originalVideo, loads: window.__loadsByMediaId[1], sourceUnchanged: document.querySelector('.player video').currentSrc===window.__originalSource, reloads: window.__videoLoads, paused: document.querySelector('.player video').paused, baseline: window.__baselineLoads, time: document.querySelector('.player video').currentTime }));
    check(continuity.sameNode && continuity.sourceUnchanged && continuity.reloads === 0 && continuity.paused && continuity.loads === continuity.baseline && Math.abs(continuity.time-10)<.1, label + ' edits never reload or restart current video: ' + JSON.stringify(continuity));
    await queue.getByRole('button', { name: 'Use vertical queue', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.playback-queue')?.dataset.layout === 'vertical');
    const geometry = await page.evaluate(() => { const p = document.querySelector('.player').getBoundingClientRect(), q = document.querySelector('.playback-queue').getBoundingClientRect(); return { side: q.left >= p.right, below: q.top >= p.bottom, width: document.documentElement.scrollWidth, viewport: innerWidth }; });
    check(scenario.width >= 1200 ? geometry.side : geometry.below, label + ' vertical layout adapts beside or below the video');
    check(geometry.width <= geometry.viewport + 1, label + ' no page horizontal overflow');
    await list.scrollIntoViewIfNeeded(); await list.evaluate(node => node.scrollTop = 0);
    if (scenario.touch) {
      const rect = await list.boundingBox();
      const y = Math.min(rect.y + 180, scenario.height - 40);
      await drag(page, { x: rect.x + 100, y }, { x: rect.x + 100, y: y - 130 }, true);
      await page.waitForFunction(() => document.querySelector('.playback-queue-list').scrollTop > 20);
    } else {
      await list.hover(); await page.mouse.wheel(0, 350); await page.waitForFunction(() => document.querySelector('.playback-queue-list').scrollTop > 30);
    }
    check(true, label + ' vertical list scrolls natively');
    await list.focus(); await page.keyboard.press('Home'); await settle(page);
    const va = await firstHandle.boundingBox(), vb = await secondHandle.boundingBox();
    await drag(page, { x: va.x + va.width / 2, y: va.y + va.height / 2 }, { x: vb.x + vb.width / 2, y: vb.y + vb.height / 2 + 8 }, scenario.touch,true);
    await page.waitForFunction(() => document.querySelector('.playback-queue-tile')?.dataset.queueId === '2');
    check(true, label + ' vertical pointer drag reorders');
    await reset(); await firstHandle.focus(); await page.keyboard.press('Space'); await settle(page); await page.keyboard.press('ArrowDown'); await settle(page); await page.keyboard.press('Space'); await settle(page);
    await page.waitForFunction(() => document.querySelector('.playback-queue-tile')?.dataset.queueId === '2');
    check(true, label + ' vertical keyboard drag reorders');
    await reset();
    await page.locator('[data-queue-id="2"] .playback-queue-item').click({ button: 'right' });
    check(await page.getByRole('menu', { name: 'Video 02 queue actions', exact: true }).evaluate(node => node.classList.contains('context-popover')), label + ' right click uses player speech bubble');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Options for Video 02', exact: true }).focus(); await page.keyboard.press('Shift+F10');
    check(await page.getByRole('menu', { name: 'Video 02 queue actions', exact: true }).isVisible(), label + ' context menu supports keyboard');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Queue options', exact: true }).click(); await page.getByRole('menuitem', { name: 'Clear upcoming', exact: true }).click();
    check(await page.locator('.playback-queue-tile').count() === 1, label + ' clear upcoming retains playing video');
    await page.getByRole('button', { name: 'Undo queue change', exact: true }).click(); check(await page.locator('.playback-queue-tile').count() === 24, label + ' clear upcoming is reversible');
    await page.screenshot({ path: join(artifacts, mode + '-' + scenario.name + '-vertical.png'), fullPage: true });
    await action(1, 'Remove and play next');
    await page.waitForFunction(() => document.querySelector('.watch-copy h1')?.textContent === 'Video 02');
    check(!(await ids()).includes(1), label + ' removing playing video advances to next');
    await page.locator('.player video').evaluate(video => video.dispatchEvent(new Event('ended')));
    await page.waitForFunction(() => document.querySelector('.watch-copy h1')?.textContent === 'Video 03');
    check(true, label + ' automatic playback follows edited queue');
    await page.evaluate(prefix => window.__router.navigate({ to: prefix + '/settings', hash: 'playback' }), prefix);
    if (mode === 'web') await page.locator('#settings-nav-playback').click();
    await page.getByRole('button', { name: 'Queue layout', exact: true }).waitFor();
    check(await page.getByRole('button', { name: 'Queue layout', exact: true }).textContent().then(value => value.includes('Vertical')), label + ' settings reflect queue preference');
    await page.getByRole('button', { name: 'Queue layout', exact: true }).click();
    const layoutOption = page.getByRole('option', { name: 'Horizontal', exact: true });
    await layoutOption.evaluate(async option => {
      await Promise.all(option.parentElement.getAnimations().map(animation => animation.finished.catch(() => {})));
    });
    check(await layoutOption.evaluate(option => Array.from(option.parentElement.querySelectorAll('[role="option"]')).every(element => {
      const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    })), label + ' layout menu stays above the next settings picker');
    await layoutOption.click();
    check(await page.evaluate(() => localStorage.getItem('virelo.queue-layout')) === 'horizontal', label + ' layout preference persists without saving server settings');
    await page.evaluate(prefix => window.__router.navigate({ to: prefix + '/watch/1', search: { queue: true, sort: 'random' } }), prefix);
    await queue.waitFor();
    check(await queue.getByRole('button', { name: 'Shuffle queue', exact: true }).getAttribute('aria-pressed') === 'true', label + ' random queue starts in shuffle mode');
    check(await page.evaluate(() => window.__requests.filter(params => params.sort).every(params => params.sort === 'title')), label + ' random pagination uses stable source order');
    check(await page.evaluate(() => window.__mutations.length === 0 && window.__items.length === 24) && writes.length === 0, label + ' no library or source mutations');
    check(errors.length === 0, label + ' no uncaught browser errors: ' + errors.join('; '));
    await context.close(); lastPage = null;
  }
  console.log(JSON.stringify({ checks, artifacts, result: 'passed' }));
} catch (error) {
  if (lastPage) { console.error(await lastPage.locator('body').innerText().catch(() => '')); await lastPage.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); }
  console.error('Artifacts:', artifacts); throw error;
} finally {
  await browser?.close();
  for (const child of children) child.kill();
}
