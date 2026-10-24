import { openPlaybackSetting } from './helpers/playback-settings.mjs';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const repo = fileURLToPath(new URL('../', import.meta.url));
const mode = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8')).name === 'virelo' ? 'npm' : 'web';
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || join(repo, 'package.json'))('playwright');
const clip = execFileSync(process.env.VIRELO_TEST_FFMPEG || 'ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x334455:s=180x320:r=5:d=60',
  '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
  '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'
], { windowsHide: true });
const server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
  { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(output)), 20000);
    server.once('error', reject);
    server.stderr.on('data', chunk => { output += chunk; });
    server.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const context = await browser.newContext({ serviceWorkers: 'block', hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/__favorites-audit', route => route.fulfill({
    contentType: 'text/html', body: '<!doctype html><html><body><div id="fixture"></div></body></html>'
  }));
  await page.route('**/__like-clip.mp4', route => route.fulfill({ contentType: 'video/mp4', body: clip }));
  await page.route('**/api/**', route => route.fulfill(
    route.request().url().endsWith('/stream') ? { contentType: 'video/mp4', body: clip } : { json: [] }));
  await page.goto(base + '/__favorites-audit');
  await page.evaluate(async ({ base, mode }) => {
    const Refresh = (await import('/@react-refresh')).default;
    Refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const main = await (await fetch('/src/main.tsx')).text();
    const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
    const React = (await import(imports.find(url => url.includes('/react.js')))).default;
    const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
    const { QueryClient, QueryClientProvider } = await import(imports.find(url => url.includes('react-query')));
    const { RouterProvider } = await import(imports.find(url => url.includes('react-router')));
    const { api } = await import('/src/api.ts');
    await import('/src/styles.css');
    await import('/src/streaming-ui.css');
    const items = Array.from({ length: 107 }, (_, index) => ({
      id: index + 1, library_id: 1, title: 'Video ' + String(index + 1).padStart(3, '0'), sort_title: String(index),
      filename: 'clip.mp4', path: 'clip.mp4', folder: '', kind: 'series', series_title: 'One series',
      season: 1, episode: index + 1, duration: 60, width: index < 6 ? 180 : 320, height: index < 6 ? 320 : 180,
      liked: index < 6 ? 0 : 1, size: 1, mtime: index, added_at: index, updated_at: index,
      thumbnail_path: null, poster_path: null, backdrop_path: null, year: null, overview: null, genres: null
    }));
    window.__items = items; window.__failLike = false; window.__likeDelay = 0; window.__writes = 0;
    api.shorts = async () => ({ items: items.slice(0, 6).map(item => ({ ...item })), total: 6 });
    api.media = async ({ liked, search = '', offset = 0, limit = 500 } = {}) => items
      .filter(item => (!liked || item.liked) && item.title.toLowerCase().includes(search.toLowerCase()))
      .slice(offset, offset + limit).map(item => ({ ...item }));
    api.mediaById = async id => ({ ...items.find(item => item.id === id) });
    api.setLike = async (id, liked) => {
      window.__writes++;
      await new Promise(resolve => setTimeout(resolve, window.__likeDelay));
      if (window.__failLike) throw new Error('Test save failure');
      items.find(item => item.id === id).liked = Number(liked);
      return { ok: true, liked };
    };
    api.mediaSource = async () => base + '/__like-clip.mp4';
    api.mediaFile = async () => new File([await (await fetch(base + '/__like-clip.mp4')).arrayBuffer()], 'clip.mp4', { type: 'video/mp4' });
    api.progress = async () => {};
    api.thumbnail = async () => null;
    api.settings = async () => ({ queueBehavior: 'auto', externalMetadataEnabled: false });
    api.libraries = async () => [];
    api.folders = async () => [];
    api.playbackInfo = async () => ({ audioTracks: [], subtitleTracks: [], qualityOptions: [], defaultAudioStream: null,
      requiresTranscode: false, requiresAudioTranscode: false, requiresVideoTranscode: false });
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 20000, retry: false, refetchOnWindowFocus: false } } });
    client.setQueryData(['home'], { favorites: [] });
    window.__client = client;
    const { router } = await import('/src/router.tsx');
    window.__router = router;
    await router.navigate({ to: mode === 'web' ? '/app/shorts' : '/shorts', search: { startId: 1 } });
    (dom.createRoot || dom.default.createRoot)(document.getElementById('fixture')).render(
      React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
  }, { base, mode });
  const prefix = mode === 'web' ? '/app' : '';
  const navigate = async path => page.evaluate(path => window.__router.navigate({ to: path }), prefix + path);
  await page.evaluate(() => {
    const nativeAnimate = HTMLElement.prototype.animate;
    window.__heartEffects = [];
    window.__sparkEffects = [];
    HTMLElement.prototype.animate = function (frames, options) {
      const animation = nativeAnimate.call(this, frames, options);
      const effects = this.classList.contains('favorite-icon') ? window.__heartEffects
        : this.classList.contains('favorite-spark') ? window.__sparkEffects : null;
      if (effects) {
        effects.push({ animation, target: this, frames: animation.effect.getKeyframes(),
          timing: animation.effect.getTiming(), easing: options.easing });
      }
      return animation;
    };
  });
  const holdSparks = name => page.evaluate(async name => {
    const effects = window.__sparkEffects.slice(-8);
    window[name] = effects;
    effects.forEach(({ animation }) => animation.pause());
    await Promise.all(effects.map(({ animation }) => animation.ready));
    effects.forEach(({ animation }) => { animation.currentTime = 30; });
  }, name);
  const first = page.locator('.short-slot').first();
  await first.getByRole('button', { name: 'Add to favorites', exact: true }).tap();
  await page.waitForFunction(() => window.__items[0].liked === 1 && window.__client.getQueryData(['home']).favorites.length === 1);
  assert.equal(await first.getByRole('button', { name: 'Remove from favorites' }).getAttribute('aria-pressed'), 'true');
  const pulse = await page.evaluate(() => {
    const effect = window.__heartEffects[0];
    return { duration: effect.timing.duration, easing: effect.easing, tag: effect.target.tagName,
      pop: effect.frames.some(frame => String(frame.transform).includes('1.18')),
      width: parseFloat(getComputedStyle(effect.target.querySelector('svg')).width),
      token: getComputedStyle(effect.target).getPropertyValue('--ease-out').trim() };
  });
  assert.equal(pulse.duration, 160);
  assert.equal(pulse.easing, pulse.token);
  assert.equal(pulse.tag, 'SPAN');
  assert.equal(pulse.pop, true);
  assert.equal(pulse.width, 48);
  assert.equal(await page.evaluate(() => window.__sparkEffects.length), 8, 'touch like emits eight rays');
  assert.equal(await page.evaluate(() => window.__sparkEffects.every(effect =>
    effect.timing.duration === 160 && effect.easing === getComputedStyle(effect.target).getPropertyValue('--ease-out').trim()
    && effect.frames[0].opacity === '1' && effect.frames.at(-1).opacity === '0'
    && effect.frames.every(frame => Object.keys(frame).every(key => ['transform', 'opacity', 'offset', 'computedOffset', 'easing', 'composite'].includes(key)))
    && getComputedStyle(effect.target).pointerEvents === 'none'
    && effect.target.closest('[aria-hidden="true"]'))), true, 'sparks are decorative, compositor-only and use the shared timing');
  assert.equal(await page.evaluate(() => new Set(window.__sparkEffects.map(effect => effect.frames[0].transform)).size), 8);
  await holdSparks('__touchSparks');
  await page.screenshot({ path: join(repo, 'node_modules/.cache/favorite-sparks-shorts-' + mode + '.png') });
  await page.evaluate(async () => {
    const animation = window.__heartEffects[0].animation;
    animation.pause(); await animation.ready; animation.currentTime = 80;
    window.__retargetTransform = getComputedStyle(window.__heartEffects[0].target).transform;
  });
  await first.getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[0].liked === 0);
  assert.equal(await page.evaluate(() => window.__heartEffects[0].animation.playState), 'idle');
  assert.equal(await page.evaluate(() => window.__sparkEffects.length), 8, 'unlike does not emit another burst');
  assert.equal(await page.evaluate(() => window.__sparkEffects.every(effect => effect.animation.playState === 'idle')), true, 'unlike cancels the existing burst');
  assert.deepEqual(await page.evaluate(() => [window.__heartEffects.at(-1).frames[0].transform]), await page.evaluate(() => [window.__retargetTransform]), 'interrupted feedback resumes at its current transform');
  assert.equal(await page.evaluate(() => window.__heartEffects.at(-1).frames.some(frame => String(frame.transform).includes('0.9'))), true);
  await first.getByRole('button', { name: 'Add to favorites' }).click();
  await page.waitForFunction(() => window.__items[0].liked === 1);
  await page.evaluate(() => {
    window.__unmountAnimation = window.__heartEffects.at(-1).animation;
    window.__unmountAnimation.currentTime = 80; window.__unmountAnimation.pause();
    window.__unmountSparks = window.__sparkEffects.slice(-8);
    window.__unmountSparks.forEach(({ animation }) => { animation.currentTime = 30; animation.pause(); });
  });
  console.log(mode + ': heart pulse uses the existing easing, retargets cleanly and preserves Shorts sizing');
  await page.locator('.shorts-scroller').evaluate(element => { element.scrollTop = element.clientHeight * 4; });
  await first.locator('.short-slot-placeholder').waitFor({ state: 'attached' });
  assert.equal(await page.evaluate(() => window.__unmountAnimation.playState), 'idle');
  assert.equal(await page.evaluate(() => window.__unmountSparks.every(effect => effect.animation.playState === 'idle')), true);
  assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('.favorite-spark')).every(spark => getComputedStyle(spark).opacity === '0')), true);
  await page.locator('.shorts-scroller').evaluate(element => { element.scrollTop = 0; });
  await first.getByRole('button', { name: 'Remove from favorites' }).waitFor();
  console.log(mode + ': Shorts remount and Home save state stay synchronized');
  const originalViewport = page.viewportSize();
  for (const viewport of [{ width: 320, height: 812 }, { width: 375, height: 812 }, { width: 812, height: 375 }]) {
    await page.setViewportSize(viewport);
    await first.getByRole('button', { name: 'Remove from favorites' }).click();
    await page.waitForFunction(() => window.__items[0].liked === 0);
    await first.getByRole('button', { name: 'Add to favorites' }).tap();
    await page.waitForFunction(() => window.__items[0].liked === 1);
    await holdSparks('__mobileSparks');
    assert.equal(await first.locator('.favorite-icon svg').isVisible(), true, 'heart remains visible in landscape');
    assert.equal(await page.evaluate(() => window.__mobileSparks.every(({ target }) => {
      const rect = target.getBoundingClientRect();
      return Number(getComputedStyle(target).opacity) > 0.8 && rect.left >= 0 && rect.right <= innerWidth
        && rect.top >= 0 && rect.bottom <= innerHeight;
    })), true, 'mobile burst fits on screen');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (viewport.width === 375) await page.screenshot({ path: join(repo, 'node_modules/.cache/favorite-sparks-mobile-' + mode + '.png') });
  }
  await page.setViewportSize(originalViewport);

  await navigate('/favorites');
  await page.getByRole('heading', { name: 'Favorites', exact: true }).waitFor();
  assert.equal(await page.locator('.favorites-view .media-card').count(), 100);
  await page.getByRole('button', { name: 'Show more' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.favorites-view .media-card').length === 102);
  assert.equal(await page.locator('.favorites-view .media-card').count(), 102);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search favorites' });
  await search.fill('Video 107');
  await page.waitForFunction(() => document.querySelectorAll('.favorites-view .media-card').length === 1);
  assert.ok(page.url().includes('/favorites'));
  await search.fill('');
  console.log(mode + ': paginated collection preserves every saved episode and supports scoped search');

  await navigate('/title/7');
  const save = page.locator('.detail-actions').getByRole('button', { name: 'Remove from favorites' });
  await save.waitFor();
  await page.evaluate(() => { window.__failLike = true; window.__likeDelay = 150; });
  await save.click();
  await page.getByRole('alert').filter({ hasText: 'Could not update favorites' }).waitFor();
  assert.equal(await save.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => window.__items[6].liked), 1);
  await page.evaluate(() => { window.__failLike = false; window.__likeDelay = 200; });
  const before = await page.evaluate(() => window.__writes);
  await page.locator('.detail-actions .favorite-button').evaluate(button => { button.click(); button.click(); });
  await page.waitForFunction(() => window.__items[6].liked === 0);
  assert.equal(await page.evaluate(() => window.__writes), before + 1);
  const keyboardEffects = await page.evaluate(() => window.__heartEffects.length);
  const keyboardSparks = await page.evaluate(() => window.__sparkEffects.length);
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__items[6].liked === 1);
  assert.equal(await page.evaluate(() => window.__heartEffects.length), keyboardEffects);
  assert.equal(await page.evaluate(() => window.__sparkEffects.length), keyboardSparks);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.detail-actions').getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  assert.equal(await page.evaluate(() => {
    const frames = window.__heartEffects.at(-1).frames;
    return frames.some(frame => Number(frame.opacity) === 0.6) && frames.every(frame => !frame.transform);
  }), true);
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 1);
  assert.equal(await page.evaluate(() => window.__sparkEffects.length), keyboardSparks, 'reduced motion never emits moving sparks');
  await page.locator('.detail-actions').getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__items[6].liked === 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const effectsBeforeFallback = await page.evaluate(() => {
    window.__restoreAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = undefined;
    return window.__heartEffects.length;
  });
  await page.locator('.detail-actions').getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  assert.equal(await page.evaluate(() => window.__heartEffects.length), effectsBeforeFallback);
  await page.evaluate(() => { HTMLElement.prototype.animate = () => { throw new Error('Test animation failure'); }; });
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 1);
  assert.equal(await page.evaluate(() => window.__heartEffects.length), effectsBeforeFallback);
  await page.evaluate(() => { HTMLElement.prototype.animate = window.__restoreAnimate; });
  await page.locator('.detail-actions').getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  await page.evaluate(() => { window.__failLike = true; window.__likeDelay = 400; });
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).click();
  await holdSparks('__failedSparks');
  await page.getByRole('alert').filter({ hasText: 'Could not update favorites' }).waitFor();
  assert.equal(await page.evaluate(() => window.__failedSparks.every(effect => effect.animation.playState === 'idle')), true, 'save failure cancels optimistic feedback');
  assert.equal(await page.locator('.detail-actions .favorite-button').getAttribute('aria-pressed'), 'false');
  await page.evaluate(() => { window.__failLike = false; window.__likeDelay = 0; });
  // A partially-created burst must be cleaned up if a later ray fails to animate.
  await page.evaluate(() => {
    const animate = HTMLElement.prototype.animate;
    let rays = 0;
    HTMLElement.prototype.animate = function (...args) {
      if (this.classList.contains('favorite-spark') && ++rays === 3) throw new Error('Test partial burst failure');
      return animate.apply(this, args);
    };
  });
  const partialStart = await page.evaluate(() => window.__sparkEffects.length);
  await page.locator('.detail-actions').getByRole('button', { name: 'Add to favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 1);
  assert.equal(await page.evaluate(start => window.__sparkEffects.slice(start).every(effect => effect.animation.playState === 'idle'), partialStart), true);
  assert.equal(await page.evaluate(() => window.__sparkEffects.length), partialStart + 2);
  await page.evaluate(() => { HTMLElement.prototype.animate = window.__restoreAnimate; });
  console.log(mode + ': reduced motion fades, keyboard is instant and missing animation support cannot block saving');
  console.log(mode + ': landscape save, failure rollback and repeated-click guard pass');

  await navigate('/watch/7');
  const video = page.locator('.player video').first();
  await page.waitForFunction(() => { const video = document.querySelector('.player video'); return video && !video.paused && video.currentTime > 0; });
  await page.evaluate(() => { window.__pauses = 0; document.querySelector('.player video').addEventListener('pause', () => window.__pauses++); });
  await page.locator('.player').hover();
  await page.locator('.player-tools').getByRole('button', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  assert.equal(await video.evaluate(element => element.paused), false);
  assert.equal(await page.evaluate(() => window.__pauses), 0);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.player-tools .favorite-icon')).transform === 'none');
  assert.equal(await page.locator('.player-tools .favorite-icon svg').evaluate(icon => icon.getBoundingClientRect().width), 22);
  assert.equal(await page.locator('.player-tools .favorite-icon').evaluate(icon => getComputedStyle(icon).transform), 'none');
  console.log(mode + ': saving from the player does not interrupt playback or change heart sizing');
  if (process.env.VIRELO_TEST_BUILT_CSS === '1') {
    const dist = join(repo, mode === 'npm' ? 'dist/web' : 'dist');
    const assets = (await readdir(join(dist, 'assets'))).filter(name => /^(index|WatchView)-.*\.css$/.test(name));
    assert.ok(assets.length >= 2, 'build before auditing production player CSS');
    const css = (await Promise.all(assets.map(name => readFile(join(dist, 'assets', name), 'utf8')))).join('\n');
    await page.evaluate(css => {
      window.__displayStyles = Array.from(document.querySelectorAll('style,link[rel="stylesheet"]'));
      window.__displayStyles.forEach(node => node.remove());
      const style = document.createElement('style'); style.id = 'display-production-css'; style.textContent = css;
      document.head.append(style);
    }, css);
  }
  await page.evaluate(() => { window.__likeDelay = 600; });
  const playerHeart = page.locator('.player-tools .favorite-button');
  const heartBox = await playerHeart.boundingBox();
  await playerHeart.click();
  await holdSparks('__playerSparks');
  assert.equal(await playerHeart.getAttribute('aria-busy'), 'true');
  assert.equal(await playerHeart.evaluate(button => getComputedStyle(button).opacity), '1', 'pending save does not dim the spark');
  assert.deepEqual(await playerHeart.boundingBox(), heartBox, 'burst cannot move or resize the button');
  assert.equal(await page.evaluate(() => window.__playerSparks.every(({ target }) => Number(getComputedStyle(target).opacity) > 0.8)), true);
  assert.equal(await video.evaluate(element => element.paused), false);
  assert.equal(await page.evaluate(() => window.__pauses), 0);
  await page.screenshot({ path: join(repo, 'node_modules/.cache/favorite-sparks-player-' + mode + '.png') });
  await page.waitForFunction(() => window.__items[6].liked === 1);
  await playerHeart.click();
  await page.waitForFunction(() => window.__items[6].liked === 0);
  assert.equal(await page.evaluate(() => window.__playerSparks.every(effect => effect.animation.playState === 'idle')), true);
  await page.evaluate(() => { window.__likeDelay = 0; });
  console.log(mode + ': touch/pointer spark burst, cancellation, save fallback, stable layout and uninterrupted playback pass');
  // The full settings/presentation matrix uses real media in audit-shorts-playback.mjs.
  const displayMenu = page.getByRole('dialog', { name: 'Picture', exact: true });
  const openPicture = () => openPlaybackSetting(page, 'Picture');
  const option = name => displayMenu.getByRole('button', { name, exact: true });
  const rotation = () => displayMenu.getByRole('status', { name: 'Rotation', exact: true }).textContent();
  await openPicture();
  await option('Fill').click();
  assert.equal(await video.evaluate(element => getComputedStyle(element).objectFit), 'cover');
  assert.equal(await page.getByRole('button', { name: 'Remove from favorites', exact: true }).count(), 0);
  await option('Reset adjustments').click();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.evaluate(prefix => window.__router.navigate({ to: prefix + '/watch/7', search: { queue: true } }), prefix);
  await openPicture();
  await option('Fill').click();
  await option('Rotate clockwise').click();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Next video', exact: true }).click();
  await openPicture();
  assert.equal(await option('Fit').getAttribute('aria-pressed'), 'true');
  assert.equal(await rotation(), '0°');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Previous video', exact: true }).click();
  await openPicture();
  assert.equal(await option('Reset adjustments').isDisabled(), true);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  console.log(mode + ': settings preserve favorites and reset picture adjustments between queue items');
  if (process.env.VIRELO_TEST_BUILT_CSS === '1') {
    await page.evaluate(() => {
      document.getElementById('display-production-css')?.remove();
      window.__displayStyles.forEach(node => document.head.append(node));
    });
  }

  await navigate('/favorites');
  await page.getByRole('heading', { name: 'Favorites', exact: true }).waitFor();
  assert.equal(await page.locator('.favorites-view .shorts-card .media-card-art').first().evaluate(element => Math.abs(element.clientWidth / element.clientHeight - 16 / 9) < 0.04), true);
  await page.locator('.favorites-view .media-card').first().click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Remove from favorites' }).click();
  await page.waitForFunction(() => window.__items[0].liked === 0 && !document.querySelector('.favorites-view .shorts-card'));
  console.log(mode + ': card context menu removes the same saved item from the collection');

  await page.setViewportSize({ width: 375, height: 812 });
  await page.locator('.mobile-nav').getByRole('link', { name: 'Favorites' }).waitFor({ state: 'visible' });
  assert.equal(await page.locator('.mobile-nav a').count(), 5);
  assert.equal(await page.locator('.mobile-nav').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length), 5);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
  await page.getByRole('button', { name: 'Close search' }).click();
  assert.equal(await page.locator('.favorites-view .media-card-art').first().evaluate(element => Math.abs(element.clientWidth / element.clientHeight - 16 / 9) < 0.04), true);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.header-search-input')).opacity === '0');
  for (const width of [320, 375, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 812 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, 'viewport ' + width);
  }
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: process.env.VIRELO_TEST_SCREENSHOT || join(repo, 'node_modules/.cache/favorites-mobile.png') });
  assert.deepEqual(errors, []);
  console.log(mode + ': mobile layout, navigation and runtime checks pass');
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(async () => {
    const {useUIStore} = await import('/src/store.ts');
    useUIStore.setState({search:''});
    window.__items.forEach(item=>{item.liked=1;});
    await window.__client.invalidateQueries({queryKey:['favorites']});
  });
  await navigate('/favorites');
  await page.getByRole('button',{name:'Play all',exact:true}).click();
  await page.locator('.playback-queue').waitFor();
  const expected = await page.evaluate(()=>window.__items.filter(item=>item.liked).map(item=>item.id));
  assert.ok(expected.length>100);
  assert.equal(await page.locator('.playback-queue-item').count(),expected.length);
  assert.equal(new URL(page.url()).searchParams.get('favorites'),'true');
  assert.equal(await page.locator('.playback-queue-item.active strong').textContent(),await page.evaluate(id=>window.__items.find(item=>item.id===id).title,expected[0]));
  await page.getByRole('button',{name:'Next video',exact:true}).click();
  assert.equal(await page.locator('.playback-queue-item.active strong').textContent(),await page.evaluate(id=>window.__items.find(item=>item.id===id).title,expected[1]));
  await page.getByRole('button',{name:'Previous video',exact:true}).click();
  assert.equal(await page.locator('.playback-queue-item.active strong').textContent(),await page.evaluate(id=>window.__items.find(item=>item.id===id).title,expected[0]));
  assert.deepEqual(errors,[]);
  console.log(mode + ': Favorites Play all includes unloaded pages and supports next/previous');
  await context.close();
} finally {
  if (browser) await browser.close();
  server.kill();
}
