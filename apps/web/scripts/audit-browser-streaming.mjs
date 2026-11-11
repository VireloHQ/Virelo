import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const repo = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const root = await mkdtemp(join(tmpdir(), 'virelo-browser-stream-')), fixture = join(root, 'clip.mkv');
execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=24',
  '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-f', 'lavfi', '-i', 'sine=frequency=660:sample_rate=48000',
  '-t', '60', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '48', '-c:a', 'aac', fixture], { windowsHide: true });
const bytes = await readFile(fixture);
const server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
  { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const base = await new Promise((resolve, reject) => {
    let log = ''; const timer = setTimeout(() => reject(new Error(log)), 20000); server.once('error', reject);
    server.stdout.on('data', data => { log += String(data).replace(/\x1b\[[0-9;]*m/g, ''); const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolve(url); } });
    server.stderr.on('data', data => { log += data; });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/__stream-audit', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.route(base + '/__clip.mkv', route => route.fulfill({ body: bytes, contentType: 'video/x-matroska' }));
  await page.goto(base + '/__stream-audit');
  const result = await page.evaluate(async () => {
    const mod = await import('/src/browser-transcode.ts');
    const file = new File([await (await fetch('/__clip.mkv')).blob()], 'clip.mkv', { lastModified: 1 });
    const qualityAvailable = (await mod.probeBrowserPlayback(file)).qualityOptions.length > 1;
    const results = [], checks = [];
    const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const wait = async (condition, label) => {
      const start = performance.now();
      while (!condition()) { if (performance.now() - start > 20000) throw new Error(label); await new Promise(resolve => setTimeout(resolve, 20)); }
    };
    for (const kind of ['audio', 'quality']) {
      if (kind === 'quality' && !qualityAvailable) {
        let rejected = false;
        try { await mod.prepareBrowserQuality(file, 360, 2); } catch (error) { rejected = /cannot create a lower-resolution/.test(error.message); }
        check(rejected, 'browsers without AVC encoding advertise no lower qualities and reject conversion explicitly');
        continue;
      }
      const media = document.createElement(kind === 'audio' ? 'audio' : 'video'); document.body.append(media);
      let controller, request = 0, failure, seekCount = 0;
      const attach = async (position, stream = 2) => {
        const token = ++request; controller?.abort(); controller = new AbortController(); failure = null;
        const options = { position, duration: 60, signal: controller.signal, getElement: () => media,
          onError: error => { failure = error.message; },
          onSeek: target => { seekCount++; void attach(target, stream).catch(error => { failure = error.message; }); } };
        const start = performance.now();
        const url = kind === 'audio' ? await mod.prepareBrowserAudio(file, stream, undefined, options) : await mod.prepareBrowserQuality(file, 360, stream, undefined, options);
        if (token !== request) return;
        media.onloadedmetadata = () => { media.currentTime = position; };
        media.src = url;
        await wait(() => failure || (media.readyState >= 2 && !media.seeking && Math.abs(media.currentTime - position) < .3), kind + ' first frame timeout');
        if (failure) throw new Error(failure);
        results.push({ kind, position, firstFrameMs: Math.round(performance.now() - start), bufferedUntil: media.buffered.end(media.buffered.length - 1) });
      };
      await attach(10);
      check(Math.abs(media.duration - 60) < .2, kind + ' retains the complete source timeline');
      check(media.buffered.end(media.buffered.length - 1) < 30, kind + ' starts before whole-file conversion completes');
      check(media.paused, kind + ' prepares without forcing playback');
      media.currentTime = 45; await wait(() => media.readyState >= 2 && !media.seeking && Math.abs(media.currentTime - 45) < .3 && results.some(result => result.kind === kind && result.position === 45), kind + ' forward seek timeout');
      check(seekCount === 1 && !failure, kind + ' seeks forward without processing intervening footage');
      media.currentTime = 3; await wait(() => media.readyState >= 2 && !media.seeking && Math.abs(media.currentTime - 3) < .3 && results.some(result => result.kind === kind && result.position === 3), kind + ' backward seek timeout');
      check(seekCount === 2 && !failure, kind + ' seeks backward after the previous stream is released');
      await media.play(); await wait(() => media.currentTime > 3.15, kind + ' playback timeout');
      const context = new AudioContext(), source = context.createMediaStreamSource(media.captureStream()), analyser = context.createAnalyser();
      analyser.fftSize = 4096; source.connect(analyser); await context.resume();
      await new Promise(resolve => setTimeout(resolve, 180));
      const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
      let peak = 0;
      for (let i = Math.floor(200 * analyser.fftSize / context.sampleRate); i < Math.ceil(1000 * analyser.fftSize / context.sampleRate); i++) if (bins[i] > (bins[peak] ?? -Infinity)) peak = i;
      const hz = peak * context.sampleRate / analyser.fftSize;
      check(Math.abs(hz - 660) < 35, kind + ' decodes the selected 660Hz track rather than the default 440Hz track (' + Math.round(hz) + 'Hz)');
      await context.close(); media.pause(); await new Promise(resolve => setTimeout(resolve, 250));
      check(media.buffered.end(media.buffered.length - 1) - media.currentTime < 19, kind + ' limits paused conversion and memory to a short window');
      await attach(59);
      await media.play(); await wait(() => media.ended || failure, kind + ' end of stream timeout');
      check(media.ended && !failure, kind + ' plays the final converted fragment to completion');
      const seeksBeforeLoop = seekCount;
      media.currentTime = 0;
      await wait(() => media.readyState >= 2 && !media.seeking && media.currentTime < .2, kind + ' loop seek timeout');
      await media.play(); await wait(() => media.currentTime > .1, kind + ' loop playback timeout'); media.pause();
      check(seekCount === seeksBeforeLoop + 1 && !failure, kind + ' can restart from zero after reaching the end');
      controller.abort(); media.removeAttribute('src'); media.load(); media.remove();
    }
    const cancelled = new AbortController(); cancelled.abort();
    let aborted = false;
    try { await mod.prepareBrowserQuality(file, 360, 2, undefined, { position: 0, duration: 60, signal: cancelled.signal, getElement: () => null, onError() {}, onSeek() {} }); }
    catch (error) { aborted = error.name === 'AbortError'; }
    check(aborted, 'cancelled selections never create a new playback source');
    const interrupted = new AbortController();
    const pending = mod.prepareBrowserAudio(file, 2, undefined, { position: 0, duration: 60, signal: interrupted.signal, getElement: () => null, onError() {}, onSeek() {} });
    interrupted.abort(); aborted = false;
    try { await pending; } catch (error) { aborted = error.name === 'AbortError'; }
    check(aborted, 'changing selection during preparation cancels the stale conversion');
    return { results, checks };
  });
  assert.equal(errors.length, 0, errors.join('; '));
  for (const check of result.checks) console.log('PASS', check);
  console.log(JSON.stringify({ measurements: result.results, checks: result.checks.length, errors, root }));
} finally { await browser?.close(); server.kill(); }
