import { openPlaybackSetting } from './helpers/playback-settings.mjs';
import { auditPlayerSettings } from './helpers/player-settings-audit.mjs';
import { auditPlayerTransport } from './helpers/player-transport-audit.mjs';
import { auditPlayerSwitching } from './helpers/player-switching-audit.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createVireloServer } from '../dist/server.js';

const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const root = await mkdtemp(join(tmpdir(), 'virelo-shorts-playback-'));
const media = join(root, 'media');
await mkdir(media);
const subtitles = join(root, 'captions.srt');
await writeFile(subtitles, '1\n00:00:00,000 --> 00:00:36,000\nShorts subtitle check\n');
const fixture = join(media, 'portrait.mkv');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
  '-f', 'lavfi', '-i', 'testsrc2=size=540x960:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000', '-i', subtitles,
  '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-t', '36', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-g', '48',
  '-c:a', 'aac', '-c:s', 'srt', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=English', fixture],
  { windowsHide: true });
await copyFile(fixture, join(media, 'portrait-next.mkv'));
process.env.VIRELO_LOG_LEVEL = 'silent';
const { app, db } = await createVireloServer({ dataDir: join(root, 'data'), mediaPaths: [], host: '127.0.0.1', port: 0 });
db.updateSettings({ libraryWatchEnabled: false, externalMetadataEnabled: false });
const library = db.addLibrary(media, 'Test clips');
const items = [];
for (const filename of ['portrait.mkv', 'portrait-next.mkv']) {
  const path = join(media, filename), file = await stat(path);
  const item = { library_id: library.id, path, filename, title: filename, sort_title: filename,
    kind: 'movie', series_title: null, season: null, episode: null, year: null, duration: 36, width: 540, height: 960,
    video_codec: 'h264', audio_codec: 'aac', container: 'mkv', folder: '', size: file.size, mtime: file.mtimeMs,
    thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null };
  items.push({ ...item, ...db.upsertMedia(item), liked: 0, progress_position: 0, progress_completed: 0, added_at: 0, updated_at: 0 });
}
await app.listen({ host: '127.0.0.1', port: 0 });
const npmBase = 'http://127.0.0.1:' + app.server.address().port;
const children = [];
let browser, lastPage, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS', label); };
async function serveWeb() {
  const webRepo = resolve(process.env.VIRELO_TEST_WEB_REPO);
  const child = spawn(process.execPath, [join(webRepo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
    { cwd: webRepo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Vite startup timed out: ' + output)), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}),
    args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });
  const modes = [['npm', npmBase]];
  if (process.env.VIRELO_TEST_WEB_REPO) modes.push(['web', await serveWeb()]);
  for (const [mode, base] of modes) {
    for (const size of [{ name: 'desktop', width: 1440, height: 900, mobile: false },
      { name: 'mobile', width: 390, height: 844, mobile: true }, { name: 'small', width: 320, height: 780, mobile: true },
      { name: 'landscape', width: 844, height: 390, mobile: true }, { name: 'wide-landscape', width: 932, height: 430, mobile: true }].filter(size=>!process.env.VIRELO_TEST_PLAYBACK_SCENARIO||size.name===process.env.VIRELO_TEST_PLAYBACK_SCENARIO)) {
      const { mobile } = size;
      const label = mode + ' ' + size.name;
      const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce',
        viewport: { width: size.width, height: size.height }, isMobile: mobile, hasTouch: mobile });
      const page = await context.newPage(), errors = [];
      await page.addInitScript(()=>{window.__switchRequests=[];const original=fetch;window.fetch=(url,options)=>{if(typeof url==='string'&&(url.includes('/audio/start')||url.includes('/quality/start')))window.__switchRequests.push({url,body:options?.body});return original(url,options);};});
      lastPage = page;
      page.setDefaultTimeout(30000);
      page.on('pageerror', error => errors.push(error.message));
      if (mode === 'npm') {
        const { setupRequired } = await (await page.request.get(base + '/api/auth/status')).json();
        const response = await page.request.post(base + (setupRequired ? '/api/auth/setup' : '/api/auth/login'),
          { headers: { 'X-Virelo-Request': '1' }, data: { username: 'audit', displayName: 'Audit', password: '1' } });
        assert.equal(response.status(), 200, await response.text());
      } else {
        const bytes = await readFile(fixture);
        await page.route('**/__shorts-audit.mkv', route => route.fulfill({ body: bytes, contentType: 'video/x-matroska' }));
        await page.route(url => url.pathname === '/src/api.ts' && !url.search, async route => {
          const response = await route.fetch();
          await route.fulfill({ response, body: await response.text() + `
const auditFiles = new Map();
api.mediaFile = async id => {
  if (!auditFiles.has(id)) auditFiles.set(id, fetch('/__shorts-audit.mkv').then(r => r.blob()).then(b => new File([b], 'portrait-' + id + '.mkv', {type:'video/x-matroska',lastModified:1})));
  return auditFiles.get(id);
};
const auditUrls = new Map();
api.mediaSource = async id => {
  if (!auditUrls.has(id)) auditUrls.set(id, URL.createObjectURL(await api.mediaFile(id)));
  return auditUrls.get(id);
};
` });
        });
        await page.goto(base + '/app/settings');
        await page.locator('.settings-heading').waitFor();
        await page.evaluate(async items => {
          const { saveStoredMedia } = await import('/src/local-library.ts');
          for (const item of items) await saveStoredMedia(item);
        }, items);
      }
      const prefix = mode === 'web' ? '/app' : '';
      if(size.name!=='wide-landscape') {
      await page.goto(base + prefix + '/shorts?startId=' + items[0].id);
      await page.locator('.splash-screen').waitFor({ state: 'hidden' });
      const active = page.locator('.short-player video');
      await page.waitForFunction(() => { const v = document.querySelector('.short-player video'); return v && !v.paused && v.currentTime > 0.1; });
      await page.getByRole('button', { name: 'Quality', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Subtitles', exact: true }).waitFor();
      check(await page.getByRole('button', { name: 'Audio', exact: true }).innerText() === 'Audio', label + ' Shorts audio has a visible label');
      check(await active.count() === 1, label + ' only the active clip owns a playback controller');
      check(await page.locator('.shorts-back').count() === 0, label + ' no overlay back button');
      check(await page.locator('.short-player .player-toolbar').count() === 0, label + ' no wide-video toolbar over the Short');
      const buttonStyles = await page.locator('.short-actions button').evaluateAll(buttons => buttons.map(button => {
        const style = getComputedStyle(button), icon = button.querySelector('svg'), svg = getComputedStyle(icon);
        return { label: button.getAttribute('aria-label'), background: style.backgroundColor, svgBackground: svg.backgroundColor, border: svg.borderWidth, padding: svg.padding, width: button.getBoundingClientRect().width };
      }));
      const bareIcons = buttonStyles.length >= 5 && buttonStyles.every(s => s.background === 'rgba(0, 0, 0, 0)' && s.svgBackground === 'rgba(0, 0, 0, 0)' && s.border === '0px' && s.padding === '0px' && s.width >= 44);
      if (!bareIcons) console.error(buttonStyles);
      check(bareIcons, label + ' bare icons retain usable touch targets');
      const bounds = await page.locator('.short-actions button').evaluateAll(buttons => buttons.map(button => { const r = button.getBoundingClientRect(); return { top: r.top, left: r.left, right: r.right, bottom: r.bottom }; }));
      check(bounds.every(r => r.top >= 0 && r.left >= 0 && r.right <= size.width && r.bottom <= size.height), label + ' all controls fit the viewport');
      const quality = page.getByRole('button', { name: 'Quality', exact: true });
      const captions = page.getByRole('button', { name: 'Subtitles', exact: true });
      await quality.click();
      check(await page.getByRole('menuitemradio', { name: /^Original Quality/ }).getAttribute('aria-checked') === 'true', label + ' Original quality is the default');
      const menu = await page.getByRole('menu', { name: 'Quality', exact: true }).boundingBox();
      check(menu.x >= 0 && menu.y >= 0 && menu.x + menu.width <= page.viewportSize().width && menu.y + menu.height <= page.viewportSize().height, label + ' settings bubble fits the viewport');
      await page.keyboard.press('Escape');
      await captions.click();
      await page.getByRole('menuitemradio', { name: /^English/ }).click();
      await page.getByText('Shorts subtitle check', { exact: true }).waitFor();
      check(await page.locator('.short-player .player-caption').count() === 1, label + ' embedded subtitle is decoded and displayed');
      await quality.click();
      await page.getByRole('menuitemradio', { name: /^480p/ }).click();
      await page.waitForFunction(mode => { const v = document.querySelector('.short-player video'); return v && !v.paused && (mode === 'npm' ? v.videoWidth : v.videoHeight) === 480 && v.currentTime > 0.1; }, mode, { timeout: 90000 });
      check(true, label + ' selecting 480p changes actual decoded resolution and resumes playback');
      check(await page.locator('.short-player .player-caption').textContent() === 'Shorts subtitle check', label + ' subtitles survive a quality change');
      await active.click();
      await page.waitForFunction(() => document.querySelector('.short-player video')?.paused);
      await quality.click();
      await page.getByRole('menuitemradio', { name: /^360p/ }).click();
      await page.waitForFunction(() => document.querySelector('.short-actions .playback-quality-label')?.textContent === '360p');
      check(await active.evaluate(v => v.paused), label + ' changing quality preserves a manual pause');
      await active.click();
      await page.waitForFunction(mode => { const v = document.querySelector('.short-player video'); return v && !v.paused && (mode === 'npm' ? v.videoWidth : v.videoHeight) === 360; }, mode, { timeout: 90000 });
      await active.click();
      await page.waitForFunction(() => document.querySelector('.short-player video')?.paused);
      await quality.click();
      await page.getByRole('menuitemradio', { name: /^Original Quality/ }).click();
      await page.waitForFunction(() => { const v = document.querySelector('.short-player video'); return v?.videoHeight === 960 && v.readyState >= 2; });
      check(await active.evaluate(v => v.paused), label + ' returning to Original preserves pause');
      await captions.click();
      await page.getByRole('menuitemradio', { name: 'Off', exact: true }).click();
      await page.locator('.short-player .player-caption').waitFor({ state: 'hidden' });
      check(await page.locator('.short-player .player-caption').count() === 0, label + ' subtitles can be turned off');
      const seek = page.getByRole('slider', { name: 'Seek video', exact: true });
      await seek.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => Math.abs(document.querySelector('.short-player video').currentTime - 5) < 0.7);
      check(true, label + ' keyboard seek keeps five-second steps');
      await active.click({ button: 'right' });
      await page.getByRole('menuitem', { name: /Resume playback|Play now/ }).click();
      await page.waitForFunction(() => !document.querySelector('.short-player video').paused);
      check(true, label + ' context Play stays in the Shorts player');
      await active.evaluate(v => { window.__loopShort = v; v.currentTime = v.duration - 0.15; });
      await page.waitForFunction(() => { const v = document.querySelector('.short-player video'); return v === window.__loopShort && !v.paused && v.currentTime < 1; });
      const completed = mode === 'npm' ? (await (await page.request.get(base + '/api/media/' + items[0].id)).json()).progress_completed
        : await page.evaluate(async id => (await (await import('/src/api.ts')).api.mediaById(id)).progress_completed, items[0].id);
      check(completed === 1, label + ' loop restarts the same clip and records completion');
      const favorite = page.locator('.short-favorite');
      const wasFavorite = await favorite.getAttribute('aria-pressed') === 'true';
      await favorite.click();
      await page.getByRole('button', { name: wasFavorite ? 'Add to favorites' : 'Remove from favorites', exact: true }).waitFor();
      check(true, label + ' favorites still work');
      await page.screenshot({ path: join(root, mode + '-' + size.name + '.png') });
      await active.evaluate(v => { window.__previousShort = v; });
      const title = await page.locator('.short-info h2').textContent();
      await page.getByRole('button', { name: 'Next short', exact: true }).click();
      await page.waitForFunction(title => document.querySelector('.short-info h2')?.textContent !== title, title);
      await page.waitForFunction(() => { const v = document.querySelector('.short-player video'); return v && !v.paused && v.currentTime > 0.1; });
      check(await page.evaluate(() => window.__previousShort.paused && !window.__previousShort.isConnected), label + ' swiping stops and releases the previous player');
      check(await page.getByRole('menu', { name: 'Quality', exact: true }).count() === 0, label + ' switching clips leaves no detached settings menu');
      }
      await page.goto(base + prefix + '/watch/' + items[0].id + '?queue=false');
      await page.locator('.player:not(.short-player) .player-toolbar').waitFor();
      check(await page.locator('.player:not(.short-player)').evaluate(element=>{
        const rect=element.getBoundingClientRect(),dock=document.querySelector('.mobile-nav')?.getBoundingClientRect();
        return rect.top>=0&&rect.bottom<=Math.min(innerHeight,dock?.height?dock.top:innerHeight);
      }),label+' initial normal player fits before any scrolling or menu interaction');
      await auditPlayerSettings(page, label, check, root);
      await auditPlayerTransport(page, label, check, root);
      if (size.name === 'desktop' || size.name === 'mobile') await auditPlayerSwitching(page, label, check);
      check(errors.length === 0, label + ' no browser exceptions: ' + JSON.stringify(errors));
      await context.close();
    }
  }
  console.log('Shorts playback audit passed: ' + checks + ' assertions. Screenshots: ' + root);
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage.screenshot({ path: join(root, 'failure.png') }).catch(() => {});
    console.error(await lastPage.locator('body').innerText());
    console.error(await lastPage.locator('.player video').first().evaluate(v => ({ time: v.currentTime, paused: v.paused,
      width: v.videoWidth, height: v.videoHeight, ready: v.readyState, source: v.currentSrc, error: v.error?.message })).catch(() => null));
  }
  console.error('Audit artifacts:', root);
  throw error;
} finally {
  await browser?.close();
  await app.close();
  for (const child of children) child.kill();
}
