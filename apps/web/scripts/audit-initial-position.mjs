import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedModuleBase } from '../../../scripts/vite-audit-url.mjs';
import { openPlaybackSetting } from './helpers/playback-settings.mjs';

// Real WatchViews/Players and media playback, synthetic files and in-memory APIs only.
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const artifacts = await mkdtemp(join(tmpdir(), 'virelo-initial-position-'));
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const encode = args => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
const fixture = join(artifacts, 'clip.mp4');
encode(['-f', 'lavfi', '-i', 'color=c=0x283b55:s=1280x720:r=6:d=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=24',
  '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000:duration=24',
  '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '12',
  '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata:s:a:0', 'handler_name=Original', '-metadata:s:a:1', 'handler_name=Alternate',
  '-metadata:s:a:0', 'language=eng', '-metadata:s:a:1', 'language=jpn',
  '-movflags', '+faststart', fixture]);
encode(['-i', fixture, '-map', '0:v', '-map', '0:a:0', '-vf', 'scale=640:360', '-c:v', 'libx264', '-preset', 'ultrafast',
  '-g', '12', '-c:a', 'copy', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
  '-hls_segment_filename', join(artifacts, 'quality-%03d.ts'), join(artifacts, 'quality.m3u8')]);
encode(['-i', fixture, '-map', '0:a:1', '-c:a', 'copy', '-hls_time', '2', '-hls_list_size', '0', '-hls_playlist_type', 'vod',
  '-hls_segment_filename', join(artifacts, 'audio-%03d.ts'), join(artifacts, 'audio.m3u8')]);
const clip = await readFile(fixture);
const fulfillClip = route => {
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return route.fulfill({ contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes' }, body: clip });
  const start = Number(range[1]), end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
  return route.fulfill({ status: 206, contentType: 'video/mp4', headers: { 'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${clip.length}` }, body: clip.subarray(start, end + 1) });
};
const children = [], gaps = [];
let browser, lastPage, checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; console.log('PASS', message); };
async function serve(edition) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('bin/vite.js', import.meta.resolve('vite/package.json'))),
    '--host', '127.0.0.1', '--port', '0'], { cwd: fileURLToPath(new URL(`../../${edition}/`, import.meta.url)),
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);
  return new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(log || 'Vite startup timed out')), 20000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.stderr.on('data', chunk => { log += chunk; });
    child.stdout.on('data', chunk => {
      log += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timer); resolve(url); }
    });
  });
}
async function waitPosition(page, id, position, path = 'direct', paused = false) {
  await page.waitForFunction(({ id, position, path, paused }) => {
    const video = document.querySelector('.player video'), audio = document.querySelector('.player audio');
    if (document.querySelector('.watch-copy h1')?.textContent !== `Video ${id}` || !video || video.readyState < 2 || video.seeking) return false;
    const sourceReady = path === 'quality' ? video.videoHeight === 360 && video.currentSrc.startsWith('blob:') :
      path === 'audio' ? audio?.readyState >= 2 && Boolean(audio.currentSrc) : video.videoHeight === 720;
    return sourceReady && video.paused === paused && Math.abs(video.currentTime - position) < (paused ? .4 : 1.2);
  }, { id, position, path, paused }, { timeout: 30000 });
}
async function seekPaused(page, position) {
  await page.locator('.player video').evaluate((video, position) => { video.pause(); video.currentTime = position; }, position);
  await page.waitForFunction(position => { const video = document.querySelector('.player video');
    return video.paused && !video.seeking && Math.abs(video.currentTime - position) < .2; }, position);
}
async function selectQuality(page, original) {
  await page.locator('.player').hover(); await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menu', { name: 'Quality', exact: true }).getByRole('menuitemradio',
    { name: original ? /^Original Quality/ : /^360p/ }).click();
}
async function selectAudio(page, index) {
  await page.locator('.player').hover(); await openPlaybackSetting(page, 'Audio');
  await page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio').nth(index).click();
}
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM,
    args: ['--autoplay-policy=no-user-gesture-required', '--no-proxy-server'] });
  for (const edition of ['web', 'server'].filter(value => !process.env.VIRELO_TEST_INITIAL_EDITION || process.env.VIRELO_TEST_INITIAL_EDITION === value)) {
    const base = await serve(edition), prefix = edition === 'web' ? '/app' : '';
    for (const path of ['direct', 'quality', 'audio'].filter(value => !process.env.VIRELO_TEST_INITIAL_PATH || process.env.VIRELO_TEST_INITIAL_PATH === value)) for (const resume of path === 'direct' ? [undefined, false, true] : [false, true]) {
      const label = `${edition} ${path} resume=${resume}`;
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'en-US', serviceWorkers: 'block' });
      const page = lastPage = await context.newPage(), errors = [], external = [];
      page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        if (new URL(route.request().url()).origin !== base) { external.push(route.request().url()); return route.abort(); }
        return route.continue();
      });
      await page.route(base + '/__initial-position-audit', route => route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><html><body><div id="fixture"></div></body></html>' }));
      await page.route('**/api/**', route => route.request().url().includes('/stream') ? fulfillClip(route) : route.fulfill({ json: [] }));
      await page.route(base + '/__initial/**', async route => {
        const name = basename(new URL(route.request().url()).pathname);
        if (/^clip-\d+\.mp4$/.test(name)) return fulfillClip(route);
        if (name === 'master.m3u8') return route.fulfill({ contentType: 'application/vnd.apple.mpegurl',
          body: '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360\nquality.m3u8\n' });
        if (!/^(quality|audio)(?:-\d{3}\.ts|\.m3u8)$/.test(name)) return route.abort();
        return route.fulfill({ contentType: name.endsWith('.ts') ? 'video/mp2t' : 'application/vnd.apple.mpegurl', body: await readFile(join(artifacts, name)) });
      });
      try {
        await page.goto(base + '/__initial-position-audit');
        const available = await page.evaluate(async ({ edition, prefix, base, shared, resume, path }) => {
          const Refresh = (await import('/@react-refresh')).default; Refresh.injectIntoGlobalHook(window);
          window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
          localStorage.setItem('virelo.language.v1', 'en');
          localStorage.setItem('virelo-playback-quality:v1', path === 'quality' ? '360' : 'source');
          const main = await (await fetch('/src/main.tsx')).text();
          const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
          const React = (await import(imports.find(url => url.includes('/react.js')))).default;
          const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
          const { QueryClient, QueryClientProvider } = await import(imports.find(url => url.includes('react-query')));
          const { RouterProvider } = await import(imports.find(url => url.includes('react-router')));
          const { api } = await import('/src/api.ts');
          await import('/src/styles.css'); await import('/src/streaming-ui.css');
          const blob = await (await fetch(base + '/__initial/clip-1.mp4')).blob();
          const files = Array.from({ length: 3 }, (_, index) => new File([blob], `clip-${index + 1}.mp4`, { type: 'video/mp4', lastModified: 1 }));
          let info = { audioTracks: [{ index: 1, typeIndex: 0, title: 'Original', language: null, codec: 'aac', channels: 1, supported: true },
            { index: 2, typeIndex: 1, title: 'Alternate', language: null, codec: 'aac', channels: 1, supported: true }],
            subtitleTracks: [], defaultAudioStream: 1, qualityOptions: [{ height: 720, label: '720p', bitrate: 2800000 },
              { height: 360, label: '360p', bitrate: 800000 }], requiresTranscode: false, requiresVideoTranscode: false };
          if (edition === 'web') info = await (await import('/src/browser-transcode.ts')).probeBrowserPlayback(files[0]);
          if (path === 'quality' && info.qualityOptions.length < 2) return false;
          if (path === 'audio') {
            const tracks = await import(shared + 'utils/playback-tracks.ts');
            tracks.savePlaybackTrackSelection('audio', info.audioTracks, info.audioTracks[1].index);
            if (tracks.resolvePlaybackTrackSelection('audio', info.audioTracks, info.defaultAudioStream) !== info.audioTracks[1].index)
              throw new Error('Synthetic audio tracks must have distinct names or languages to restore a saved selection.');
          }
          window.__info = info; window.__progress = []; window.__starts = []; window.__sessions = []; window.__ended = [];
          const items = window.__items = [6, 10, 12].map((position, index) => ({ id: index + 1, library_id: 1,
            title: `Video ${index + 1}`, sort_title: String(index), filename: `clip-${index + 1}.mp4`, path: `clip-${index + 1}.mp4`, folder: '',
            kind: 'movie', duration: 24, width: 1280, height: 720, progress_position: position, progress_duration: 24,
            progress_completed: 0, liked: 0, size: blob.size, mtime: 1, added_at: 0, updated_at: 0,
            thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null }));
          api.media = async ({ offset = 0, limit = 500 } = {}) => items.slice(offset, offset + limit).map(item => ({ ...item }));
          api.mediaById = async id => ({ ...items.find(item => item.id === id) });
          api.mediaFile = async id => files[id - 1]; api.mediaSource = async id => base + `/__initial/clip-${id}.mp4`;
          api.playbackInfo = async () => info; api.progress = async (...args) => { window.__progress.push(args); };
          api.settings = async () => ({ queueBehavior: 'auto', ...(resume === undefined ? {} : { queueResumePosition: resume }), audioAnalysisEnabled: false,
            shortsIncludeLandscapes: false, externalMetadataEnabled: false, externalImagesEnabled: false });
          api.appearance = async () => ({ controllerStyle: 'classic', accentColor: '#c3a6ff' });
          api.saveQueueSession = async session => { window.__sessions.push(session); return { ...session, items }; };
          api.deleteQueueSession = async () => {}; api.queueSessions = async () => [];
          for (const key of ['related', 'libraries', 'folders', 'playlists']) api[key] = async () => [];
          api.scanStatus = async () => ({ running: false }); api.thumbnail = async () => null;
          api.startQualityTranscode = async (id, stream, position) => {
            window.__starts.push({ kind: 'quality', id, stream, position });
            return { status: 'ready', complete: true, startTime: 0, bufferedUntil: 24, playlist: base + '/__initial/master.m3u8',
              variants: [{ height: 360, label: '360p', bitrate: 800000, url: base + '/__initial/quality.m3u8' }] };
          };
          api.startAudioTranscode = async (id, stream) => {
            window.__starts.push({ kind: 'audio', id, stream });
            return { status: 'ready', url: base + '/__initial/audio.m3u8' };
          };
          const client = new QueryClient({ defaultOptions: { queries: { staleTime: 20000, retry: false, refetchOnWindowFocus: false } } });
          const { router } = await import('/src/router.tsx'); window.__router = router;
          await router.navigate({ to: prefix + '/watch/1', search: { queue: true } });
          (dom.createRoot || dom.default.createRoot)(document.getElementById('fixture')).render(
            React.createElement(QueryClientProvider, { client }, React.createElement(RouterProvider, { router })));
          return true;
        }, { edition, prefix, base, shared: sharedModuleBase, resume, path });
        if (!available) { gaps.push(`${label}: Chromium has no AVC encoder, quality conversion unavailable`); continue; }
        await waitPosition(page, 1, 6, path);
        check(true, `${label}: initial queue selection restores history`);
        await page.locator('.player video').evaluate(async video => {
          video.addEventListener('ended', event => window.__ended.push({ trusted: event.isTrusted, position: video.currentTime }), { once: true });
          video.currentTime = video.duration - .4;
          // Incremental conversion may replace its source on this seek; readiness below verifies the eventual playback.
          await video.play().catch(() => {});
        });
        await waitPosition(page, 2, resume ? 10 : 0, path);
        check(await page.evaluate(() => window.__ended.length === 1 && window.__ended[0].trusted), `${label}: real ended event advances the queue`);
        check(true, `${label}: automatic next uses ${resume ? 'saved position' : 'the beginning'}`);
        if (path === 'direct' && resume === false) {
          await seekPaused(page, 7); await selectQuality(page, false); await waitPosition(page, 2, 7, 'quality', true);
          check(true, `${label}: quality conversion preserves live position and paused intent`);
          await selectQuality(page, true); await waitPosition(page, 2, 7, 'direct', true);
          check(true, `${label}: original-quality source restore preserves live position`);
          await selectAudio(page, 1);
          await page.waitForFunction(() => { const audio = document.querySelector('.player audio'), video = document.querySelector('.player video');
            return audio.readyState >= 2 && Boolean(audio.currentSrc) && Math.abs(audio.currentTime - 7) < .4 && Math.abs(video.currentTime - 7) < .4 && video.paused;
          });
          check(true, `${label}: alternate audio preserves live video/audio position and paused intent`);
          await selectAudio(page, 0);
          await page.waitForFunction(() => !document.querySelector('.player audio').getAttribute('src'));
          await waitPosition(page, 2, 7, 'direct', true);
          check(true, `${label}: original-audio restore preserves live position`);
          await page.locator('.player-play-button').click();
          await page.waitForFunction(() => { const video = document.querySelector('.player video'); return !video.paused && video.currentTime > 7.1; });
          const beforeAudio = await page.locator('.player video').evaluate(video => video.currentTime);
          await selectAudio(page, 1);
          await page.waitForFunction(position => { const video = document.querySelector('.player video'), audio = document.querySelector('.player audio');
            return !video.paused && !audio.paused && audio.readyState >= 2 && video.currentTime >= position - .3 && video.currentTime < position + 2
              && Math.abs(audio.currentTime - video.currentTime) < .4;
          }, beforeAudio);
          check(true, `${label}: playing audio switch preserves live position and play intent`);
          const beforeQuality = await page.locator('.player video').evaluate(video => video.currentTime);
          await selectQuality(page, false);
          await page.waitForFunction(position => { const video = document.querySelector('.player video');
            return video.videoHeight === 360 && !video.paused && video.readyState >= 2 && video.currentTime >= position - .3 && video.currentTime < position + 2;
          }, beforeQuality);
          check(true, `${label}: playing quality switch preserves live position and play intent`);
          await selectQuality(page, true);
          await page.waitForFunction(() => { const video = document.querySelector('.player video'); return video.videoHeight === 720 && !video.paused && video.readyState >= 2; });
        }
        await page.locator('.player').hover(); await page.getByRole('button', { name: 'Next video', exact: true }).click();
        await waitPosition(page, 3, 12, path);
        check(true, `${label}: manual Next restores history regardless of autoplay preference`);
        await page.locator('[data-queue-id="1"] .playback-queue-item').click();
        await waitPosition(page, 1, 6, path);
        check(true, `${label}: manually selecting a queue item restores history`);
        if (path === 'direct' && !resume) {
          await page.evaluate(prefix => window.__router.navigate({ to: prefix + '/watch/1', search: {} }), prefix);
          await waitPosition(page, 1, 6);
          check(true, `${label}: standalone direct/Continue Watching-style entry restores history`);
        }
        check(await page.evaluate(() => window.__items.every((item, index) => item.progress_position === [6, 10, 12][index])), `${label}: fixtures are not changed by progress writes`);
        check(errors.length === 0, `${label}: no uncaught browser errors: ${errors.join('; ')}`);
        check(external.length === 0, `${label}: no external network or personal server access`);
      } catch (error) {
        console.error(label, await page.evaluate(() => ({ body: document.body.innerText, progress: window.__progress, starts: window.__starts,
          videos: [...document.querySelectorAll('.player video,.player audio')].map(media => ({ src: media.currentSrc, time: media.currentTime,
            duration: media.duration, ready: media.readyState, paused: media.paused, height: media.videoHeight, error: media.error?.message })) })).catch(() => ({})));
        await page.screenshot({ path: join(artifacts, `${edition}-${path}-${resume}-failure.png`), fullPage: true }).catch(() => {});
        throw error;
      } finally { await context.close(); lastPage = null; }
    }
  }
  assert.ok(checks > 0, 'No playback scenarios matched the audit filters.');
  console.log(JSON.stringify({ result: 'passed', checks, gaps, artifacts }));
} catch (error) {
  if (lastPage) {
    console.error(await lastPage.evaluate(() => ({ body: document.body.innerText, progress: window.__progress, starts: window.__starts,
      videos: [...document.querySelectorAll('.player video,.player audio')].map(media => ({ src: media.currentSrc, time: media.currentTime,
        duration: media.duration, ready: media.readyState, paused: media.paused, height: media.videoHeight, error: media.error?.message })) })).catch(() => ({})));
    await lastPage.screenshot({ path: join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  }
  console.error('Artifacts:', artifacts); throw error;
} finally {
  await browser?.close(); for (const child of children) child.kill();
}
