import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedModuleBase } from '../../../scripts/vite-audit-url.mjs';

const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
// Synthetic video with a real soundtrack; never reads or converts user media.
function syntheticClip(seconds) {
  return execFileSync(process.env.VIRELO_TEST_FFMPEG || 'ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=s=160x90:r=10:d=${seconds}`,
    '-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`, '-c:v', 'libx264', '-preset', 'ultrafast',
    '-g', '10', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
  ], { windowsHide: true });
}
const clip = syntheticClip(24), shortClip = syntheticClip(2);
let checks = 0;
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM,
  args: ['--autoplay-policy=document-user-activation-required', '--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies'] });
try {
  for (const edition of ['web', 'server']) {
    const repo = fileURLToPath(new URL(`../../${edition}/`, import.meta.url));
    const server = spawn(process.execPath, [fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json'))), '--host', '127.0.0.1', '--port', '0'],
      { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      const base = await new Promise((resolve, reject) => {
        let log = '';
        const timer = setTimeout(() => reject(new Error(log)), 20000);
        server.once('error', error => { clearTimeout(timer); reject(error); });
        server.stderr.on('data', data => { log += data; });
        server.stdout.on('data', data => {
          log += String(data).replace(/\x1b\[[0-9;]*m/g, '');
          const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
          if (url) { clearTimeout(timer); resolve(url); }
        });
      });
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage(), errors = [];
      const session = await context.newCDPSession(page);
      // Playwright evaluate() grants activation; fixture bootstrapping must not unlock audio.
      const evaluateWithoutGesture = async (fn, args) => {
        const result = await session.send('Runtime.evaluate', {
          expression: `(${fn})(${JSON.stringify(args)})`, userGesture: false, awaitPromise: true, returnByValue: true
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result.value;
      };
      const waitWithoutGesture = async predicate => {
        const deadline = Date.now() + 10000;
        while (!await evaluateWithoutGesture(predicate)) {
          if (Date.now() > deadline) throw new Error('Timed out waiting without user activation: ' + predicate);
          await new Promise(resolve => setTimeout(resolve, 20));
        }
      };
      page.on('pageerror', error => errors.push(error.message));
      let activeClip = clip;
      const serveClip = route => {
        const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range || '');
        const start = range ? Number(range[1]) : 0;
        const end = Math.min(range?.[2] ? Number(range[2]) : activeClip.length - 1, activeClip.length - 1);
        if (start > end) return route.fulfill({ status: 416, headers: { 'Content-Range': `bytes */${activeClip.length}` } });
        // Without range support Chromium reports seekable=[0,0], even when fully buffered.
        return route.fulfill({ status: range ? 206 : 200, contentType: 'video/mp4',
          headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
            ...(range ? { 'Content-Range': `bytes ${start}-${end}/${activeClip.length}` } : {}) },
          body: activeClip.subarray(start, end + 1) });
      };
      await page.route(base + '/__preview-audit', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><body><div id="fixture" class="app-shell"></div></body></html>' }));
      await page.route('**/__preview-clip.mp4', serveClip);
      await page.route('**/api/**', route => route.request().url().endsWith('/stream') ? serveClip(route) : route.fulfill({ json: [] }));
      const setup = async (saved, { position = 0, short = false } = {}) => {
        activeClip = short ? shortClip : clip;
        await page.goto(base + '/__preview-audit');
        await evaluateWithoutGesture(async ({ shared, edition, saved, position, short }) => {
          if (saved !== undefined) localStorage.setItem('virelo-preview-muted:v1', saved);
          const Refresh = (await import('/@react-refresh')).default;
          Refresh.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
          window.__vite_plugin_react_preamble_installed__ = true;
          const main = await (await fetch('/src/main.tsx')).text();
          const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
          const React = (await import(imports.find(url => url.includes('/react.js')))).default;
          const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
          const { QueryClient, QueryClientProvider } = await import(imports.find(url => url.includes('react-query')));
          const { createRootRoute, createRoute, createRouter, RouterProvider } = await import(imports.find(url => url.includes('react-router')));
          const { api } = await import('/src/api.ts');
          api.mediaSource = async () => location.origin + '/__preview-clip.mp4';
          api.thumbnail = async () => null;
          await import('/src/styles.css'); await import('/src/streaming-ui.css');
          const { MediaRow } = await import(shared + 'components/MediaRow.tsx');
          const { MediaCard } = await import('/src/components/MediaCard.tsx');
          const h = React.createElement;
          const items = Array.from({ length: 5 }, (_, index) => ({ id: index + 1, library_id: 1,
            title: `Preview ${index + 1}`, kind: 'video', duration: short ? 2 : 24,
            progress_position: index === 0 ? (position === 'invalid' ? Infinity : position) : 0,
            width: 160, height: 90, season: null, episode: null, year: null, liked: 0,
            thumbnail_path: null, poster_path: null, backdrop_path: null }));
          window.__videos = []; window.__rejections = [];
          const nativePlay = HTMLMediaElement.prototype.play;
          HTMLMediaElement.prototype.play = function () {
            if (!window.__videos.includes(this)) window.__videos.push(this);
            const promise = nativePlay.call(this);
            promise.catch(error => window.__rejections.push(error.name));
            return promise;
          };
          function Fixture() {
            const [show, setShow] = React.useState(true); window.__show = setShow;
            return h('div', null, show && h(React.Fragment, null,
              h('div', { style: { width: 440 } }, h(MediaRow, { title: 'First row', items: items.slice(0, 2) })),
              h(MediaRow, { title: 'Second row', items: items.slice(2, 4) }),
              h('div', { style: { width: 250 } }, h(MediaCard, { item: items[4], playDirect: true,
                resumeSession: { key: 'queue-fixture', label: 'Queue · Test context' } }))),
              h('div', { style: { height: 2000 } }));
          }
          const rootRoute = createRootRoute();
          const fixtureRoute = createRoute({ getParentRoute: () => rootRoute, path: '/__preview-audit', component: Fixture });
          const watchRoute = createRoute({ getParentRoute: () => rootRoute,
            path: edition === 'web' ? '/app/watch/$mediaId' : '/watch/$mediaId',
            validateSearch: search => ({ resumeSession: search.resumeSession }), component: () => h('p', null, 'Navigated to video') });
          const titleRoute = createRoute({ getParentRoute: () => rootRoute,
            path: edition === 'web' ? '/app/title/$mediaId' : '/title/$mediaId', component: () => h('p', null, 'Navigated to details') });
          const router = createRouter({ routeTree: rootRoute.addChildren([fixtureRoute, watchRoute, titleRoute]) });
          const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
          const root = (dom.createRoot || dom.default.createRoot)(document.getElementById('fixture'));
          window.__unmount = () => root.unmount();
          root.render(h(React.StrictMode, null, h(QueryClientProvider, { client }, h(RouterProvider, { router }))));
        }, { shared: sharedModuleBase, edition, saved, position, short });
        await waitWithoutGesture(() => Boolean(document.querySelector('.media-card-link')));
      };
      const check = (condition, label) => { assert.ok(condition, `${edition}: ${label}`); checks++; console.log('PASS', edition, label); };
      const first = () => page.locator('.media-card').filter({ hasText: 'Preview 1' });
      const second = () => page.locator('.media-card').filter({ hasText: 'Preview 3' });
      const playing = card => card.locator('video').evaluate(video => !video.paused && video.currentTime > 0);
      const waitPlaying = async card => {
        await card.locator('video').waitFor();
        await page.waitForFunction(title => [...document.querySelectorAll('.media-card')].find(card => card.textContent.includes(title))?.querySelector('video')?.currentTime > 0,
          await card.locator('strong').textContent());
      };
      const waitPosition = (low, high) => page.waitForFunction(({ low, high }) => {
        const video = document.querySelector('.media-card video');
        return video && !video.paused && !video.seeking && video.currentTime >= low && video.currentTime <= high;
      }, { low, high }, { timeout: 10000 });
      const trackReplay = () => first().locator('video').evaluate(video => {
        window.__replay = { ended: 0, positions: [] };
        video.addEventListener('ended', () => window.__replay.ended++);
        video.addEventListener('timeupdate', () => window.__replay.positions.push(video.currentTime));
      });
      await setup('false');
      // Even locator hover's internal evaluations can activate the document.
      await evaluateWithoutGesture(() => document.querySelector('.media-card').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
      await waitWithoutGesture(() => window.__videos.some(video => !video.paused && video.currentTime > 0));
      check(await evaluateWithoutGesture(() => window.__rejections.includes('NotAllowedError') && !navigator.userActivation.hasBeenActive),
        'fresh context exercises native sound-autoplay rejection without user activation');
      check(await first().locator('video').evaluate(video => video.muted) && await first().getByRole('button', { name: 'Unmute preview', exact: true }).count() === 1,
        'blocked sound falls back to an accurately labeled muted preview');
      check(await page.evaluate(() => localStorage.getItem('virelo-preview-muted:v1')) === 'false', 'autoplay fallback preserves saved unmuted preference');
      await first().getByRole('button').click();
      await first().getByRole('button', { name: 'Mute preview', exact: true }).waitFor();
      check(await first().locator('video').evaluate(video => !video.muted), 'gesture retries audio after autoplay fallback');
      await setup('true');
      await first().hover(); await waitPlaying(first());
      check(await first().locator('video').evaluate(video => video.muted), 'first preview starts muted');
      const button = first().getByRole('button', { name: 'Unmute preview', exact: true });
      const artBox = await first().locator('.media-card-art').boundingBox(), buttonBox = await button.boundingBox();
      check(buttonBox.x > artBox.x + artBox.width / 2 && buttonBox.y < artBox.y + artBox.height / 2, 'speaker is in the thumbnail top right');
      check(await button.evaluate(element => !element.closest('a')), 'speaker is not nested inside a link');
      await button.click();
      await first().getByRole('button', { name: 'Mute preview', exact: true }).waitFor();
      check(await playing(first()) && await first().locator('video').evaluate(video => !video.muted), 'trusted speaker click enables real media audio');
      check(page.url() === base + '/__preview-audit', 'speaker click does not navigate');
      await first().getByRole('button').press('Space');
      await first().getByRole('button', { name: 'Unmute preview', exact: true }).waitFor();
      check(await first().getByRole('button').evaluate(element => element === document.activeElement), 'Space toggles mute and keeps button focus');
      await first().getByRole('button').press('Enter');
      await first().getByRole('button', { name: 'Mute preview', exact: true }).waitFor();
      check(page.url() === base + '/__preview-audit', 'Enter toggles audio without navigating');
      check(await first().getByRole('button').evaluate(element => {
        const style = getComputedStyle(element);
        return style.backgroundColor === 'rgba(0, 0, 0, 0)' && style.backgroundImage === 'none'
          && ['Top', 'Right', 'Bottom', 'Left'].every(side => style[`border${side}Width`] === '0px')
          && style.borderRadius === '0px' && style.boxShadow === 'none'
          && element.textContent.trim() === '' && Boolean(element.querySelector('svg'));
      }), 'speaker is icon-only with transparent background, zero border and no circle');
      const seek = first().getByRole('slider', { name: 'Seek preview', exact: true });
      await page.waitForFunction(() => Number(document.querySelector('.preview-seek')?.max) > 23.5);
      check(await seek.evaluate(element => element.matches('input[type=range].preview-seek') && !element.disabled && !element.closest('a')),
        'seek control is an enabled accessible native range outside the link');
      check(await first().locator('video').evaluate(video => video.duration > 23.5 && video.duration < 24.5
        && video.seekable.length > 0 && video.seekable.end(video.seekable.length - 1) > 23.5),
        'synthetic source really exposes its full 24-second seekable timeline');
      const row = first().locator('..');
      check(await row.evaluate(element => element.scrollWidth > element.clientWidth), 'seek isolation uses a genuinely scrollable row');
      const rowScroll = await row.evaluate(element => element.scrollLeft);
      const assertNoNavigationOrScroll = async label => check(page.url() === base + '/__preview-audit'
        && await row.evaluate((element, left) => element.scrollLeft === left, rowScroll), label);
      const seekBox = await seek.boundingBox();
      await seek.click({ position: { x: seekBox.width * .78, y: seekBox.height / 2 } });
      await waitPosition(17, 21);
      await page.waitForTimeout(350);
      check(await first().locator('video').evaluate(video => !video.paused && video.currentTime > 17), 'range click seeks beyond 15 seconds without the old preview loop');
      await assertNoNavigationOrScroll('range click neither navigates nor scrolls the row');
      await seek.press('Home');
      await waitPosition(0, 1);
      check(await seek.evaluate(element => Number(element.value) < 1 && element === document.activeElement), 'Home seeks to the beginning and retains range focus');
      // Observe native input values before playback time or React rendering can advance them.
      await seek.evaluate(element => {
        window.__seekInputs = [];
        let key, before;
        element.addEventListener('keydown', event => { key = event.key; before = Number(element.value); });
        element.addEventListener('input', () => window.__seekInputs.push({ key, before, value: Number(element.value) }));
      });
      await seek.press('ArrowRight');
      await seek.press('ArrowLeft');
      check(await page.evaluate(() => window.__seekInputs.length === 2
        && window.__seekInputs[0].key === 'ArrowRight' && window.__seekInputs[1].key === 'ArrowLeft'
        && Math.abs(window.__seekInputs[0].value - window.__seekInputs[0].before - .1) < .001
        && Math.abs(window.__seekInputs[1].before - window.__seekInputs[1].value - .1) < .001), 'left/right arrows use the native 0.1-second seek step');
      await trackReplay();
      await seek.press('End');
      await page.waitForFunction(() => window.__replay.ended === 1);
      await waitPosition(0, 1);
      check(await page.evaluate(() => window.__seekInputs.at(-1).value > 23.5), 'End reaches the full-duration endpoint, not a 15-second window');
      check(await seek.evaluate(element => element === document.activeElement), 'end replay retains keyboard range focus');
      await assertNoNavigationOrScroll('Home/End/arrows neither navigate nor scroll the row');
      await seek.press('Home');
      const dragBox = await seek.boundingBox();
      await page.mouse.move(dragBox.x + 5, dragBox.y + dragBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(dragBox.x + dragBox.width * .8, dragBox.y + dragBox.height / 2, { steps: 12 });
      await page.mouse.up();
      await waitPosition(18, 21);
      check(await seek.evaluate(element => element === document.activeElement), 'drag seeks beyond 15 seconds and retains range focus');
      await assertNoNavigationOrScroll('range drag neither follows the stretched link nor scrolls the row');
      const screenshotPath = join(tmpdir(), `virelo-preview-audit-${edition}-${Date.now()}.png`);
      await first().screenshot({ path: screenshotPath });
      console.log('SCREENSHOT', edition, screenshotPath);
      await seek.press('Home');
      await first().locator('video').evaluate(video => { video.currentTime = 14.5; });
      await waitPosition(16, 18);
      check(true, 'real playback crosses 15 seconds without wrapping');
      await page.evaluate(() => document.fonts.ready.then(() => {}));
      const leavingPreview = await first().locator('video').elementHandle();
      await first().getByRole('button').focus();
      await first().getByRole('button').hover();
      check(await first().evaluate(card => card.matches(':hover')), 'pointer-leave regression starts with the pointer inside the card');
      await page.mouse.move(1100, 700);
      await first().locator('video').waitFor({ state: 'detached' });
      check(await first().locator('.media-card-link').evaluate(link => link === document.activeElement),
        'pointer leave returns focused speaker control to the card link before teardown');
      check(await leavingPreview.evaluate(video => video.paused && video.muted && !video.hasAttribute('src')),
        'pointer leave pauses, mutes and unloads the focused audible preview');
      await page.waitForTimeout(220);
      check(await first().locator('video').count() === 0 && await leavingPreview.evaluate(video => video.paused && !video.hasAttribute('src')),
        'returned link focus never restarts a preview after pointer leave');
      await first().hover(); await waitPlaying(first());
      const leavingSeekPreview = await first().locator('video').elementHandle();
      await seek.focus(); await seek.hover();
      check(await first().evaluate(card => card.matches(':hover')), 'range teardown starts with pointer inside the card');
      await page.mouse.move(1100, 700);
      await first().locator('video').waitFor({ state: 'detached' });
      check(await first().locator('.media-card-link').evaluate(link => link === document.activeElement), 'pointer leave returns range focus to the card link');
      check(await leavingSeekPreview.evaluate(video => video.paused && video.muted && !video.hasAttribute('src')), 'focused range teardown pauses, mutes and unloads real media');
      await page.waitForTimeout(220);
      check(await first().locator('video').count() === 0, 'range focus return cannot resurrect the unloaded preview');
      await first().hover(); await waitPlaying(first());
      const capturedSeek = await seek.elementHandle();
      const capturedVideo = await first().locator('video').elementHandle();
      await seek.evaluate(element => {
        window.__capture = { got: 0, lost: 0, pointerId: null };
        element.addEventListener('gotpointercapture', event => { window.__capture.got++; window.__capture.pointerId = event.pointerId; });
        element.addEventListener('lostpointercapture', () => window.__capture.lost++);
      });
      const escapeBox = await seek.boundingBox();
      await page.mouse.move(escapeBox.x + 5, escapeBox.y + escapeBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(1100, 700, { steps: 12 });
      check(await page.evaluate(() => window.__capture.got === 1), 'held range drag captures the pointer beyond the card bounds');
      await page.mouse.up();
      await first().locator('video').waitFor({ state: 'detached' });
      check(await capturedSeek.evaluate(element => !element.hasPointerCapture(window.__capture.pointerId))
        && await page.evaluate(() => window.__capture.lost === 1), 'release outside the card loses pointer capture without getting stuck');
      check(await first().locator('.media-card-link').evaluate(link => link === document.activeElement)
        && await capturedVideo.evaluate(video => video.paused && video.muted && !video.hasAttribute('src')),
        'outside drag release restores link focus and pauses, mutes and unloads media');
      await assertNoNavigationOrScroll('outside drag release neither navigates nor scrolls the row');
      await second().hover(); await waitPlaying(second());
      check(await page.evaluate(() => window.__videos.filter(video => !video.paused && !video.muted).length) === 1, 'only one card across rows can play audio');
      check(await page.evaluate(() => window.__videos.filter(video => video.paused).every(video => video.muted && !video.hasAttribute('src'))), 'superseded previews pause, mute and unload');
      check(await second().locator('video').evaluate(video => !video.muted), 'next row inherits explicit sound preference');
      await page.evaluate(() => { window.scrollTo(0, 1700); });
      await page.waitForFunction(() => window.__videos.every(video => video.paused));
      check(true, 'scrolling cards out of view stops playback');
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      await page.mouse.move(1100, 700); await first().hover(); await waitPlaying(first());
      // Native document lifecycle is browser-controlled; inject only the visibility transition.
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForFunction(() => window.__videos.every(video => video.paused));
      check(await page.evaluate(() => window.__videos.every(video => video.muted && !video.hasAttribute('src'))), 'hidden tab releases every preview source');
      await page.evaluate(() => { delete document.hidden; window.__show(false); });
      await page.waitForFunction(() => !document.querySelector('.media-card'));
      await page.mouse.move(1100, 700);
      await page.evaluate(() => window.__show(true));
      await first().hover(); await waitPlaying(first());
      await page.evaluate(() => window.__show(false));
      await page.waitForFunction(() => window.__videos.every(video => video.paused));
      check(await page.evaluate(() => window.__videos.every(video => !video.hasAttribute('src'))), 'unmount stops and unloads media');
      for (const position of [23.9, 30, 'invalid']) {
        await setup('true', { position });
        await first().hover(); await waitPlaying(first());
        check(await first().locator('video').evaluate(video => video.currentTime < 1), `initial ${position} history starts at zero instead of the final frames`);
      }
      await setup('true', { position: 8 });
      await first().hover(); await waitPlaying(first());
      await waitPosition(8, 10);
      check(true, 'valid initial history starts at its saved position');
      await trackReplay();
      await first().locator('video').evaluate(video => { video.currentTime = video.duration - .4; });
      await page.waitForFunction(() => window.__replay.ended === 1);
      await waitPosition(0, 1);
      check(true, 'natural end replays from zero, not the initial saved position');
      await setup('true', { position: 99, short: true });
      await first().hover(); await waitPlaying(first());
      check(await first().locator('video').evaluate(video => video.duration >= 2 && video.duration < 2.5 && video.currentTime < 1), 'short synthetic clip ignores stale history and starts at zero');
      await trackReplay();
      await page.waitForFunction(() => window.__replay.ended === 1);
      await waitPosition(0, 1);
      check(await page.evaluate(() => window.__replay.positions.some(position => position > 1.5)), 'short clip plays its full duration before the first natural replay');
      await waitPosition(1.3, 1.9);
      check(await page.evaluate(() => window.__replay.ended === 1), 'short clip replays the full timeline rather than a final-frame loop');
      await setup('false');
      await first().hover(); await waitPlaying(first());
      check(await page.evaluate(() => localStorage.getItem('virelo-preview-muted:v1')) === 'false', 'sound preference survives document reload');
      const sessionCard = page.locator('.media-card').filter({ hasText: 'Preview 5' });
      check((await sessionCard.locator('.media-card-link').getAttribute('href')).includes('resumeSession=queue-fixture'), 'direct playback includes resume-session search');
      check((await sessionCard.textContent()).includes('Queue · Test context'), 'resume context is visible');
      const box = await first().locator('.media-card-art').boundingBox();
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.getByText('Navigated to details', { exact: true }).waitFor();
      check(page.url().includes('/title/1'), 'thumbnail still navigates to card destination');
      assert.deepEqual(errors, []);
      await context.close();
    } finally { server.kill(); }
  }
} finally { await browser.close(); }
console.log(`PASS ${checks} preview browser checks across both editions`);
