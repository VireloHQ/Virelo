import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sharedModuleBase } from '../../../scripts/vite-audit-url.mjs';

const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
// Synthetic video with a real soundtrack; never reads or converts user media.
const clip = execFileSync(process.env.VIRELO_TEST_FFMPEG || 'ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=160x90:r=5:d=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:duration=24', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
], { windowsHide: true });
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
      await page.route(base + '/__preview-audit', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><body><div id="fixture" class="app-shell"></div></body></html>' }));
      await page.route('**/__preview-clip.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
      await page.route('**/api/**', route => route.fulfill(route.request().url().endsWith('/stream')
        ? { contentType: 'video/mp4', body: clip } : { json: [] }));
      const setup = async (saved) => {
        await page.goto(base + '/__preview-audit');
        await evaluateWithoutGesture(async ({ shared, edition, saved }) => {
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
            title: `Preview ${index + 1}`, kind: 'video', duration: 24, progress_position: 0,
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
              h(MediaRow, { title: 'First row', items: items.slice(0, 2) }),
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
        }, { shared: sharedModuleBase, edition, saved });
        await waitWithoutGesture(() => Boolean(document.querySelector('.media-card-link')));
      };
      const check = (condition, label) => { assert.ok(condition, `${edition}: ${label}`); console.log('PASS', edition, label); };
      const first = () => page.locator('.media-card').filter({ hasText: 'Preview 1' });
      const second = () => page.locator('.media-card').filter({ hasText: 'Preview 3' });
      const playing = card => card.locator('video').evaluate(video => !video.paused && video.currentTime > 0);
      const waitPlaying = async card => {
        await card.locator('video').waitFor();
        await page.waitForFunction(title => [...document.querySelectorAll('.media-card')].find(card => card.textContent.includes(title))?.querySelector('video')?.currentTime > 0,
          await card.locator('strong').textContent());
      };
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
      const leavingPreview = await first().locator('video').elementHandle();
      await first().getByRole('button').focus();
      await page.mouse.move(1100, 700);
      await first().locator('video').waitFor({ state: 'detached' });
      check(await first().locator('.media-card-link').evaluate(link => link === document.activeElement),
        'pointer leave returns focused speaker control to the card link before teardown');
      check(await leavingPreview.evaluate(video => video.paused && video.muted && !video.hasAttribute('src')),
        'pointer leave pauses, mutes and unloads the focused audible preview');
      await page.waitForTimeout(220);
      check(await first().locator('video').count() === 0 && await leavingPreview.evaluate(video => video.paused && !video.hasAttribute('src')),
        'returned link focus never restarts a preview after pointer leave');
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
