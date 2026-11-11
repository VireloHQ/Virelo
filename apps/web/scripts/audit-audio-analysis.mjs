import { sharedModuleBase } from '../../../scripts/vite-audit-url.mjs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(repo, '.audio-analysis-audit-'));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const coreWasm = createRequire(import.meta.url).resolve('@ffmpeg/core/wasm');
const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const native = args => execFileSync(ffmpeg, ['-hide_banner', '-nostats', ...args], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const subtitle = join(root, 'track.srt');
await writeFile(subtitle, '1\n00:00:00,000 --> 00:00:01,000\nSynthetic track\n');
const common = ['-f', 'lavfi', '-i', 'testsrc2=s=96x64:r=5:d=1.5',
  '-f', 'lavfi', '-i', 'aevalsrc=0.6*sin(2*PI*12000*t+PI/4):s=48000:d=1.5',
  '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=1.5',
  '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono:d=1.5'];
const fixtures = [];
for (const name of ['multi.mp4', 'multi.mkv', 'multi.avi']) {
  const path = join(root, name), mkv = name.endsWith('.mkv'), avi = name.endsWith('.avi');
  native(['-v', 'error', ...common, ...(mkv ? ['-i', subtitle, '-map', '4:s'] : []), '-map', '1:a', '-map', '0:v', '-map', '2:a', '-map', '3:a',
    '-c:v', avi ? 'mpeg4' : 'libx264', ...(avi ? [] : ['-preset', 'ultrafast']), '-c:a', avi || mkv ? 'pcm_s16le' : 'aac',
    '-disposition:a:0', '0', '-disposition:a:1', 'default', '-disposition:a:2', '0', ...(mkv ? ['-c:s', 'srt'] : []), path]);
  const bytes = await readFile(path), reference = [];
  fixtures.push({ name, path, bytes, reference, hash: createHash('sha256').update(bytes).digest('hex') });
}
// Keep stderr explicitly: loudnorm JSON is emitted there, not to the null output.
for (const fixture of fixtures) for (let track = 0; track < 3; track++) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-nostats', '-i', fixture.path, '-map', '0:a:' + track, '-vn', '-af', 'loudnorm=I=-18:TP=-3:LRA=11:print_format=json', '-f', 'null', '-'], { windowsHide: true, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  fixture.reference.push(JSON.parse(result.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/)[0]));
}
const child = spawn(process.execPath, [fileURLToPath(new URL('bin/vite.js',import.meta.resolve('vite/package.json'))), '--host', '127.0.0.1', '--port', '0'], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser, releaseDownload, gate, waiting, downloaded;
const holdDownload = () => {
  gate = new Promise(resolveGate => { releaseDownload = resolveGate; });
  downloaded = new Promise(resolveWaiting => { waiting = resolveWaiting; });
};
let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; console.log('PASS', label); };
try {
  const base = await new Promise((resolveBase, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error(log)), 20000);
    child.once('error', reject);
    child.stderr.on('data', chunk => { log += chunk; });
    child.stdout.on('data', chunk => { log += String(chunk).replace(/\x1b\[[0-9;]*m/g, ''); const url = log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0]; if (url) { clearTimeout(timer); resolveBase(url); } });
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM });
  const context = await browser.newContext({ serviceWorkers: 'block', locale: 'en-US', reducedMotion: 'reduce' });
  const page = await context.newPage(), errors = [], codecs = [], workers = [], external = [], uploads = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('worker', worker => workers.push(worker.url()));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname.includes('/ffmpeg-0.12.10/')) codecs.push(url.pathname);
    if (['http:', 'https:'].includes(url.protocol) && url.origin !== base) external.push(url.href);
    if (request.method() !== 'GET') uploads.push(request.url());
  });
  await page.route('**/ffmpeg-core.wasm.gz', async route => {
    const held = gate;
    if (held) { gate = null; waiting(); await held; }
    await route.fulfill({ body: await readFile(coreWasm), contentType: 'application/wasm' }).catch(() => {});
  });
  await page.route('**/__audio/*', route => {
    const item = fixtures.find(item => item.name === new URL(route.request().url()).pathname.split('/').at(-1));
    return route.fulfill({ body: item.bytes, contentType: 'application/octet-stream' });
  });
  const initialize = async () => {
    // Warm the existing playback probe too: Vite may reload once when its codecs are first optimized.
    for (let attempt = 0; ; attempt++) {
      try {
        await page.goto(base + '/app/settings'); await page.locator('.settings-heading').waitFor();
        await page.locator('.splash-screen').waitFor({ state: 'hidden' });
        await page.evaluate(async () => {
          window.library = await import('/src/local-library.ts');
          window.playback = await import('/src/browser-transcode.ts');
        });
        break;
      } catch (error) { if (attempt >= 2 || !/context was destroyed|navigation/i.test(error.message)) throw error; }
    }
  };
  const scan = async () => {
    const previous = await page.evaluate(() => window.library.getLocalScanStatus().startedAt);
    assert.equal(await page.evaluate(() => window.library.startLocalScan()), true);
    await page.waitForFunction(previous => { const status = window.library.getLocalScanStatus(); return status.startedAt !== previous && !status.running; }, previous);
  };
  const waitDownload = async () => {
    let timer;
    try { await Promise.race([downloaded, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Analyzer never requested its download.')), 15000); })]); }
    catch (error) { console.error(await page.evaluate(async () => ({ status: window.library.getLocalScanStatus(), settings: await window.library.readSettings(), media: await window.library.listStoredMedia() }))); throw error; }
    finally { clearTimeout(timer); }
  };
  await initialize();
  check(!(await page.evaluate(() => window.library.readSettings())).audioAnalysisEnabled, 'audio analysis defaults off');
  const control = page.getByRole('switch', { name: 'Analyze audio during scans', exact: true });
  await control.waitFor(); check(!await control.isChecked(), 'Libraries exposes the default-off switch');
  await page.evaluate(async items => {
    const root = await navigator.storage.getDirectory();
    const folder = await root.getDirectoryHandle('synthetic-only', { create: true });
    // Only ordinary MP4 participates in scanning initially: its thumbnail never needs FFmpeg.
    for (const name of items) {
      const handle = await folder.getFileHandle(name, { create: true }), writer = await handle.createWritable();
      await writer.write(await (await fetch('/__audio/' + name)).blob()); await writer.close();
    }
    window.audioFolder = folder;
    window.showDirectoryPicker = async () => folder;
    window.addedLibrary = await window.library.addLocalLibrary();
  }, ['multi.mp4']);
  await page.waitForFunction(() => !window.library.getLocalScanStatus().running);
  check(codecs.length === 0 && workers.length === 0, 'default-off scan never starts an analyzer or downloads codecs');
  await control.press('Space');
  await page.waitForFunction(async () => (await window.library.readSettings()).audioAnalysisEnabled);
  console.log('INFO opt-in saved; reconnecting synthetic folder');
  holdDownload();
  // Reconnection must return while the analysis support download is held indefinitely.
  const reconnected = await page.evaluate(() => Promise.race([
    window.library.reconnectLocalLibrary(window.addedLibrary.id),
    new Promise(resolve => setTimeout(async () => resolve({ timedOut: true, status: window.library.getLocalScanStatus(), locks: await navigator.locks.query() }), 15000))
  ]));
  assert.ok(!reconnected.timedOut, JSON.stringify(reconnected));
  await waitDownload();
  const baseline = await page.evaluate(async () => ({ items: await window.library.listStoredMedia(), status: window.library.getLocalScanStatus() }));
  check(baseline.items.length === 1 && baseline.items[0].duration > 1 && baseline.items[0].thumbnail_path, 'baseline metadata and thumbnails exist before analysis');
  check(baseline.status.running && baseline.status.audioTotal === 1 && baseline.status.audioAnalyzed === 0 && baseline.status.message === 'Analyzing audio · multi.mp4', 'reconnect returns promptly with a distinct background audio stage');
  check(await page.evaluate(() => window.library.startLocalScan()) === false, 'duplicate scans are rejected during analysis');
  const id = baseline.items[0].id;
  await page.evaluate(async id => {
    await window.library.updateStoredMedia(id, item => { item.liked = 1; item.progress_position = .75; item.title = 'Renamed during analysis'; item.sort_title = 'renamed during analysis'; });
  }, id);
  releaseDownload();
  await page.waitForFunction(() => !window.library.getLocalScanStatus().running);
  const measured = await page.evaluate(id => window.library.getStoredMedia(id), id);
  check(measured.liked === 1 && measured.progress_position === .75 && measured.title === 'Renamed during analysis', 'analysis merges latest favorites, progress, and title');
  check(!!measured.audio_loudness, 'actual scanner worker persists measured JSON');
  const compare = async (file, value) => {
    const result = await page.evaluate(async ({ name, value, shared }) => {
      const { audioMeasurement, readAudioAnalysis } = await import(shared+'utils/volume-leveling.ts');
      const file = await (await window.audioFolder.getFileHandle(name)).getFile();
      const info = await window.playback.probeBrowserPlayback(file), analysis = readAudioAnalysis(JSON.stringify(value), file.size, file.lastModified);
      return { indexes: info.audioTracks.map(track => track.index), defaultAudioStream: info.defaultAudioStream, analysis,
        selected: info.audioTracks.map(track => audioMeasurement(JSON.stringify(value), file.size, file.lastModified, track.index)),
        primary: audioMeasurement(JSON.stringify(value), file.size, file.lastModified) };
    }, { name: file.name, value, shared: sharedModuleBase });
    assert.ok(result.analysis, 'contract accepts browser measurement');
    assert.deepEqual(value.tracks.map(track => track.index), result.indexes, file.name + ' exact playback stream indexes');
    assert.equal(value.defaultAudioStream, result.defaultAudioStream);
    assert.deepEqual(result.primary, result.selected[result.indexes.indexOf(result.defaultAudioStream)]);
    for (let ordinal = 0; ordinal < 3; ordinal++) {
      const actual = result.selected[ordinal], reference = file.reference[ordinal];
      if (reference.input_i === '-inf') assert.equal(actual, null);
      else {
        assert.ok(Math.abs(actual.integratedLufs - Number(reference.input_i)) < .15, file.name + ' native LUFS agreement');
        assert.ok(Math.abs(actual.truePeakDb - Number(reference.input_tp)) < .15, file.name + ' native true peak agreement');
      }
    }
    check(true, file.name + ' all tracks, default/selected metadata, silence and native LUFS/true-peak agreement');
    return value;
  };
  await compare(fixtures[0], JSON.parse(measured.audio_loudness));
  // Cache reuse survives document reload and creates no new worker/download, even with the setting on.
  await initialize();
  const beforeReuse = { codecs: codecs.length, workers: workers.length };
  await scan();
  check((await page.evaluate(() => window.library.readSettings())).audioAnalysisEnabled, 'opt-in persists after reload');
  check(codecs.length === beforeReuse.codecs && workers.length === beforeReuse.workers, 'matching cache skips all analyzer loading and worker creation');
  await page.evaluate(async () => { window.audioFolder = await (await navigator.storage.getDirectory()).getDirectoryHandle('synthetic-only'); });
  // Exercise subtitle-interleaved MKV and actual-index AVI with the dedicated worker directly.
  for (const fixture of fixtures.slice(1)) {
    const value = await page.evaluate(async name => {
      const handle = await window.audioFolder.getFileHandle(name, { create: true }), writer = await handle.createWritable();
      await writer.write(await (await fetch('/__audio/' + name)).blob()); await writer.close();
      const { BrowserAudioAnalyzer } = await import('/src/browser-audio-analysis.ts');
      const analyzer = new BrowserAudioAnalyzer();
      try { return await analyzer.analyze(await handle.getFile(), new AbortController().signal); } finally { analyzer.dispose(); }
    }, fixture.name);
    await compare(fixture, value);
    if (fixture.name.endsWith('.mkv')) check(value.tracks[0].loudness.truePeakDb > -6, 'true peak detects intersample overs above the -7.45 dBFS PCM sample peak');
    // Remove only synthetic OPFS fixtures from the scanning folder, never user directories.
    await page.evaluate(name => window.audioFolder.removeEntry(name), fixture.name);
  }
  const beforeLarge = { codecs: codecs.length, workers: workers.length };
  const large = await page.evaluate(async () => {
    const { BrowserAudioAnalyzer } = await import('/src/browser-audio-analysis.ts');
    const analyzer = new BrowserAudioAnalyzer();
    const file = new File(['tiny boundary-test backing blob'], 'large.mp4');
    Object.defineProperty(file, 'size', { value: 2_000_000_000 });
    try { await analyzer.analyze(file, new AbortController().signal); return null; }
    catch (error) { return error.message; } finally { analyzer.dispose(); }
  });
  check(large === 'Browser audio analysis supports files smaller than 2 GB.' && codecs.length === beforeLarge.codecs && workers.length === beforeLarge.workers,
    '2 GB boundary rejects before any worker or codec download (tiny test backing blob)');
  // Register through the real scanner so the media ID matches its normal path identity.
  await page.evaluate(async () => {
    const handle = await window.audioFolder.getFileHandle('broken.mp4', { create: true }), writer = await handle.createWritable();
    await writer.write('synthetic corrupt media'); await writer.close();
  });
  await scan();
  const failed = await page.evaluate(async () => ({ item: (await window.library.listStoredMedia()).find(item=>item.filename==='broken.mp4'), status: window.library.getLocalScanStatus() }));
  check(!failed.item.audio_loudness && failed.status.errors === 1 && failed.status.audioAnalyzed === 1 && failed.status.message === 'Scan complete · 1 unavailable',
    'unsupported/corrupt source produces an honest unavailable count and no bogus measurement');
  await page.evaluate(() => window.audioFolder.removeEntry('broken.mp4'));
  await scan();
  // Invalid contract version must cause measurement, not reuse.
  await page.evaluate(async id => { await window.library.updateStoredMedia(id, item => { item.audio_loudness = JSON.stringify({ ...JSON.parse(item.audio_loudness), version: 0 }); }); }, id);
  const beforeInvalid = codecs.length;
  await scan();
  check(codecs.length > beforeInvalid && JSON.parse((await page.evaluate(id => window.library.getStoredMedia(id), id)).audio_loudness).version === 1, 'invalid cache version is remeasured');
  holdDownload();
  await page.evaluate(async id => { await window.library.updateStoredMedia(id, item => { item.audio_loudness = null; }); await window.library.startLocalScan(); }, id);
  await waitDownload();
  await page.evaluate(async id => { await window.library.updateStoredMedia(id, item => { item.size++; item.mtime++; }); }, id);
  releaseDownload();
  await page.waitForFunction(() => !window.library.getLocalScanStatus().running);
  check(!(await page.evaluate(id => window.library.getStoredMedia(id), id)).audio_loudness, 'changed size/mtime while analyzing blocks stale writeback');
  // Disable while loading: abort both download and worker lifetime, with no later writeback.
  holdDownload();
  await page.evaluate(() => window.library.startLocalScan()); await waitDownload();
  await page.evaluate(() => window.library.writeSettings({ audioAnalysisEnabled: false }));
  releaseDownload();
  await page.waitForFunction(() => !window.library.getLocalScanStatus().running);
  check(!(await page.evaluate(id => window.library.getStoredMedia(id), id)).audio_loudness, 'disabling cancels pending analysis without caching');
  await page.evaluate(() => window.library.writeSettings({ audioAnalysisEnabled: true }));
  holdDownload();
  await page.evaluate(() => window.library.startLocalScan()); await waitDownload();
  await page.evaluate(() => window.library.removeLocalLibrary(window.addedLibrary?.id ?? 1));
  releaseDownload();
  await page.waitForFunction(() => !window.library.getLocalScanStatus().running);
  check((await page.evaluate(() => window.library.listStoredMedia())).length === 0, 'removing a library cancels analysis and cannot resurrect media');
  const intact = await page.evaluate(async () => {
    const file = await (await window.audioFolder.getFileHandle('multi.mp4')).getFile();
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
  check(intact === fixtures[0].hash, 'source bytes remain unchanged');
  check(external.length === 0 && uploads.length === 0, 'analysis performs no uploads or third-party requests');
  check(errors.length === 0, 'no browser exceptions: ' + errors.join(', '));
  console.log(JSON.stringify({ checks, result: 'passed' }));
} finally {
  releaseDownload?.();
  await browser?.close(); child.kill();
  const target = relative(resolve(repo), resolve(root));
  assert.ok(target.startsWith('.audio-analysis-audit-') && !target.includes('..'));
  await rm(root, { recursive: true, force: true });
}
