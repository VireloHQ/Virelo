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
  // Check the real Player: presentation changes must not reload or pause its source.
  const displayButton = page.getByRole('button', { name: 'Video settings', exact: true });
  const displayMenu = page.getByRole('dialog', { name: 'Video settings', exact: true });
  const beforeDisplay = await video.evaluate(element => {
    window.__loads = 0; element.addEventListener('loadstart', () => window.__loads++);
    return { src: element.currentSrc, time: element.currentTime };
  });
  await displayButton.click();
  await displayMenu.waitFor();
  const option = name => displayMenu.getByRole('button', { name, exact: true });
  const rotation = () => displayMenu.getByRole('status', { name: 'Rotation', exact: true }).textContent();
  assert.equal(await option('Fit').getAttribute('aria-pressed'), 'true');
  assert.equal(await option('Reset adjustments').isDisabled(), true);
  await option('Fill').click();
  assert.equal(await video.evaluate(element => getComputedStyle(element).objectFit), 'cover');
  for (const angle of [90, 180, 270, 0]) {
    await option('Rotate clockwise').click();
    assert.equal(await rotation(), angle + '°');
    assert.equal(await video.evaluate(element => {
      const box = element.getBoundingClientRect(), player = element.closest('.player').getBoundingClientRect();
      return ['x', 'y', 'width', 'height'].every(key => Math.abs(box[key] - player[key]) < 1);
    }), true, 'rotation preserves player geometry');
  }
  await option('Rotate counterclockwise').click();
  assert.equal(await rotation(), '270°');
  for (const [label, value] of [['Brightness', 120], ['Contrast', 90], ['Saturation', 75]]) {
    await displayMenu.getByRole('slider', { name: label, exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  assert.equal(await video.evaluate(element => getComputedStyle(element).filter), 'brightness(1.2) contrast(0.9) saturate(0.75)');
  assert.equal(await page.locator('.player-controls').evaluate(element => getComputedStyle(element).filter), 'none');
  await displayMenu.getByRole('slider', { name: 'Brightness', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await displayMenu.getByRole('slider', { name: 'Brightness', exact: true }).inputValue(), '119');
  await displayMenu.getByRole('heading', { name: 'Video settings' }).dblclick();
  assert.equal(await page.evaluate(() => Boolean(document.fullscreenElement)), false);
  await page.waitForTimeout(2600); // Exercise the controls auto-hide timer while settings are open.
  assert.equal(await page.locator('.player').evaluate(element => element.classList.contains('controls-visible')), true);
  assert.equal(await video.evaluate(element => element.paused), false);
  assert.equal(await video.evaluate(element => element.currentSrc), beforeDisplay.src);
  assert.ok(await video.evaluate(element => element.currentTime) >= beforeDisplay.time);
  assert.equal(await page.evaluate(() => window.__loads), 0);
  assert.equal(await page.evaluate(() => window.__pauses), 0);
  await page.keyboard.press('Escape');
  await displayMenu.waitFor({ state: 'hidden' });
  assert.equal(await displayMenu.count(), 0);
  assert.equal(await displayButton.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('ArrowDown');
  await displayMenu.waitFor();
  assert.equal(await displayMenu.getAttribute('data-animate'), 'false');
  await option('Reset adjustments').click();
  assert.equal(await video.evaluate(element => getComputedStyle(element).filter), 'none');
  assert.equal(await video.evaluate(element => getComputedStyle(element).objectFit), 'contain');
  assert.equal(await rotation(), '0°');
  await page.keyboard.press('Escape');
  await video.click({ button: 'right' });
  const contextRow = page.getByRole('menuitem', { name: 'Video settings', exact: true });
  await contextRow.click();
  await displayMenu.waitFor();
  assert.equal(await page.getByRole('menu', { name: 'Video actions' }).count(), 1, 'parent menu stays open');
  await displayMenu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  const rowBox = await contextRow.boundingBox(), childBox = await displayMenu.boundingBox();
  assert.equal(await displayMenu.getAttribute('data-side'), 'right');
  assert.ok(Math.abs(childBox.x - rowBox.x - rowBox.width - 14) < 1, 'settings attach to their own menu row');
  await page.screenshot({ path: join(repo, 'node_modules/.cache/context-video-' + mode + '.png') });
  await option('Fill').click();
  assert.equal(await page.getByRole('menu', { name: 'Video actions' }).count(), 1, 'settings interaction keeps parent open');
  await option('Fit').click();
  await option('Close video settings').click();
  await page.keyboard.press('ArrowRight');
  await displayMenu.waitFor();
  assert.equal(await displayMenu.getAttribute('data-animate'), 'false');
  await page.keyboard.press('ArrowLeft');
  await displayMenu.waitFor({ state: 'hidden' });
  assert.equal(await contextRow.evaluate(element => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await page.getByRole('menu', { name: 'Video actions' }).waitFor({ state: 'hidden' });
  const playerBox = await page.locator('.player').boundingBox();
  await page.locator('.player').click({ button: 'right', position: { x: playerBox.width - 80, y: 60 } });
  await contextRow.click();
  await displayMenu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
  assert.equal(await displayMenu.getAttribute('data-side'), 'left', 'submenu flips left at the right edge');
  const leftRow = await contextRow.boundingBox(), leftChild = await displayMenu.boundingBox();
  assert.ok(Math.abs(leftChild.x + leftChild.width + 14 - leftRow.x) < 1);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await displayButton.focus();
  await page.keyboard.press('Enter');
  await option('Fill').focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'Rotate clockwise');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fullscreen', exact: true }).click();
  await page.waitForFunction(() => Boolean(document.fullscreenElement));
  await displayButton.click();
  await displayMenu.waitFor();
  assert.equal(await displayMenu.evaluate(element => document.fullscreenElement.contains(element)), true);
  await option('Rotate clockwise').click();
  assert.equal(await video.evaluate(element => {
    const box = element.getBoundingClientRect(), player = element.closest('.player').getBoundingClientRect();
    return Math.abs(box.width - player.width) < 1 && Math.abs(box.height - player.height) < 1;
  }), true);
  await page.evaluate(() => document.exitFullscreen());
  await displayMenu.waitFor({ state: 'hidden' });
  for (const viewport of [{ width: 320, height: 780 }, { width: 844, height: 390 }, { width: 320, height: 240 }]) {
    await page.setViewportSize(viewport);
    await displayButton.click();
    await displayMenu.waitFor();
    await page.waitForTimeout(220); // Measure after the existing 180ms entry transition.
    const bounds = await displayMenu.boundingBox();
    assert.ok(bounds.x >= 7 && bounds.y >= 7 && bounds.x + bounds.width <= viewport.width - 7
      && bounds.y + bounds.height <= viewport.height - 7, JSON.stringify({ viewport, bounds }));
    assert.equal(await displayMenu.evaluate(element => getComputedStyle(element).backdropFilter.includes('blur')), true);
    assert.equal(await displayMenu.locator('.video-settings-content').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    await option('Close video settings').click();
    await page.locator('.player').click({ button: 'right', position: { x: 50, y: 20 } });
    await page.getByRole('menu', { name: 'Video actions' }).waitFor();
    await page.evaluate(() => document.dispatchEvent(new Event('scroll')));
    assert.equal(await page.getByRole('menu', { name: 'Video actions' }).count(), 1, 'queued no-op scrolling does not dismiss a fresh menu');
    await contextRow.click();
    await displayMenu.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)));
    const nestedBounds = await displayMenu.boundingBox();
    assert.ok(nestedBounds.x >= 15 && nestedBounds.y >= 15 && nestedBounds.x + nestedBounds.width <= viewport.width - 15
      && nestedBounds.y + nestedBounds.height <= viewport.height - 15);
    await displayMenu.locator('.video-settings-content').evaluate(element => { element.scrollTop = element.scrollHeight; });
    await page.waitForFunction(() => document.querySelector('.video-settings-menu'));
    assert.equal(await page.getByRole('menu', { name: 'Video actions' }).count(), 1, 'scrolling the child does not close its parent');
    await page.keyboard.press('Escape');
    await displayMenu.waitFor({ state: 'hidden' });
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await displayButton.click();
  assert.equal(await displayMenu.evaluate(element => getComputedStyle(element).transitionProperty), 'opacity');
  await page.screenshot({ path: join(repo, 'node_modules/.cache/video-settings-' + mode + '.png') });
  assert.equal(await displayMenu.locator('.video-settings-content').evaluate(element => element.scrollHeight <= element.clientHeight + 1), true, 'desktop popup fits without scrolling');
  await page.keyboard.press('Escape');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  // Queue changes reuse Player: even revisiting an adjusted item must start with default presentation.
  await page.evaluate(prefix => window.__router.navigate({ to: prefix + '/watch/7', search: { queue: true } }), prefix);
  await displayButton.click();
  await option('Fill').click();
  await option('Rotate clockwise').click();
  await option('Close video settings').click();
  await page.getByRole('button', { name: 'Next video', exact: true }).click();
  await displayButton.click();
  assert.equal(await option('Fit').getAttribute('aria-pressed'), 'true');
  assert.equal(await rotation(), '0°');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Previous video', exact: true }).click();
  await displayButton.click();
  assert.equal(await option('Reset adjustments').isDisabled(), true);
  await page.keyboard.press('Escape');
  console.log(mode + ': video fit, rotation, colors, reset, queue isolation, keyboard, fullscreen and mobile pass');
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
