// Isolated browser storage and generated media; never opens the user's library.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const require = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url);
const { chromium } = require('playwright');
const projects = fileURLToPath(new URL('../../', import.meta.url));
const folder = await mkdtemp(join(tmpdir(), 'virelo-tracks-audit-'));
const servers = [];
let browser, checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS', label); };
function deliverMedia(route, body, contentType) {
  const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
  if (!range) return route.fulfill({ body, contentType, headers: { 'Accept-Ranges': 'bytes' } });
  const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
  return route.fulfill({ status: 206, body: body.subarray(start, end + 1), contentType, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${body.length}` } });
}
async function serve(repo) {
  const child = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'], { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  servers.push(child);
  return await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error('Vite startup timed out: ' + output)), 20000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Vite exited: ' + code + ' ' + output)); });
    child.stderr.on('data', chunk => { output += chunk; });
    child.stdout.on('data', chunk => {
      output += String(chunk).replace(/\x1b\[[0-9;]*m/g, '');
      const url = output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      if (url) { clearTimeout(timeout); resolve(url); }
    });
  });
}
async function mount(page, mode, base) {
  await page.evaluate(async ({ mode, base }) => {
    const main = await (await fetch('/src/main.tsx')).text();
    const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
    const React = (await import(imports.find(url => url.includes('/react.js')))).default;
    const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
    const { QueryClient, QueryClientProvider } = await import(imports.find(url => url.includes('react-query')));
    const { api } = await import('/src/api.ts');
    const { Player } = await import('/src/components/Player.tsx');
    const node = document.createElement('div'); node.className = 'app-shell';
    document.getElementById('root').style.display = 'none'; document.body.append(node);
    const root = (dom.createRoot || dom.default.createRoot)(node);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    window.__calls = [];
    const track = (index, language, title, codec = 'aac') => ({ index, typeIndex: index, language, title, codec, channels: codec === 'aac' ? 2 : null, channelLayout: codec === 'aac' ? 'stereo' : null, default: false, forced: false, supported: true });
    window.__info = id => {
      const shifted = id === 2;
      const audioTracks = id === 3 || id === 5 ? [track(1, 'eng', 'English')] : [track(shifted ? 6 : 1, 'eng', 'English'), track(shifted ? 8 : 2, 'jpn', 'Japanese')];
      const subtitleTracks = id === 3 || id === 6 ? [track(3, 'fra', 'French', 'subrip')] : [track(shifted ? 10 : 3, 'eng', 'English', 'subrip'), track(shifted ? 12 : 4, 'jpn', 'Japanese', 'subrip')];
      return { audioTracks, subtitleTracks, defaultAudioStream: audioTracks[0].index, requiresTranscode: false, requiresAudioTranscode: false, requiresVideoTranscode: false, qualityOptions: [{ height: 180, label: '180p', bitrate: 500000 },{height:90,label:'90p',bitrate:100000}] };
    };
    api.progress = async () => {};
    api.playbackInfo = async id => window.__info(id);
    api.mediaFile = async id => new File([await (await fetch(base + '/__tracks/clip.mp4')).blob()], 'track-' + id + '.mp4');
    api.mediaSource = async id => base + '/__tracks/clip.mp4?id=' + id;
    api.startAudioTranscode = async (id, stream) => {
      window.__calls.push({ kind: 'audio', id, stream });
      return { status: 'ready', url: base + '/__tracks/audio.m4a?id=' + id + '&stream=' + stream };
    };
    api.subtitleUrl = (id, stream) => base + '/__tracks/caption.vtt?id=' + id + '&stream=' + stream;
    function Demo() {
      const [state, setState] = React.useState({ id: 1, autoPlay: true });
      window.__show = (id, autoPlay = true) => setState({ id, autoPlay });
      return React.createElement(Player, { item: { id: state.id, title: 'Track audit ' + state.id, filename: 'track-' + state.id + '.mp4', duration: 120, width: 320, height: 180, progress_position: 12 }, autoPlay: state.autoPlay });
    }
    root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Demo)));
  }, { mode, base });
  await page.locator('.player video').waitFor();
}
async function selected(page, kind, name) {
  await page.getByRole('button', { name: kind, exact: true }).click();
  const value = await page.getByRole('menu', { name: kind, exact: true }).getByRole('menuitemradio', { name: new RegExp('^' + name) }).getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  return value === 'true';
}
try {
  const ffmpeg = args => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', ...args], { windowsHide: true });
  ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x354356:s=320x180:r=10:d=120', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=120', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', join(folder, 'clip.mp4')]);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=880:duration=120', '-c:a', 'aac', '-movflags', '+faststart', join(folder, 'audio.m4a')]);
  const clip = await readFile(join(folder, 'clip.mp4')), audio = await readFile(join(folder, 'audio.m4a'));
  browser = await chromium.launch({ headless: true, ...(process.env.VIRELO_TEST_CHROMIUM ? { executablePath: process.env.VIRELO_TEST_CHROMIUM } : {}), args: ['--autoplay-policy=no-user-gesture-required'] });
  for (const mode of ['npm', 'web']) {
    const base = await serve(join(projects, mode === 'web' ? 'virelo-web' : 'virelo'));
    const context = await browser.newContext({ serviceWorkers: 'block', reducedMotion: 'reduce' });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(15000); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const path = new URL(route.request().url()).pathname;
      return path.endsWith('/stream') ? deliverMedia(route, clip, 'video/mp4') : route.fulfill({ json: path === '/api/settings' ? { queueBehavior: 'auto' } : path === '/api/libraries' ? [] : {} });
    });
    await page.route('**/__tracks/**', route => {
      const url = new URL(route.request().url());
      return url.pathname.endsWith('.vtt') ? route.fulfill({ body: 'WEBVTT\n\n00:00:00.000 --> 00:02:00.000\nJapanese caption\n', contentType: 'text/vtt' }) : deliverMedia(route, url.pathname.endsWith('.m4a') ? audio : clip, url.pathname.endsWith('.m4a') ? 'audio/mp4' : 'video/mp4');
    });
    if (mode === 'web') await page.route(url => url.pathname === '/src/browser-transcode.ts', route => route.fulfill({ contentType: 'text/javascript', body: `
      export async function probeBrowserPlayback(file) { return window.__info(Number(file.name.match(/\\d+/)[0])); }
      export async function prepareBrowserAudio(file, stream) { const id=Number(file.name.match(/\\d+/)[0]); window.__calls.push({kind:'audio',id,stream}); return '/__tracks/audio.m4a?id='+id+'&stream='+stream; }
      export async function prepareBrowserSubtitle(file,stream) { const id=Number(file.name.match(/\\d+/)[0]); window.__calls.push({kind:'subtitle',id,stream}); return '/__tracks/caption.vtt?id='+id+'&stream='+stream; }
      export async function prepareBrowserQuality(file,height,stream) { const id=Number(file.name.match(/\\d+/)[0]); window.__calls.push({kind:'quality',id,height,stream}); return URL.createObjectURL(file); }
    ` }));
    const open = async () => { await page.goto(base + (mode === 'web' ? '/app/settings' : '/settings')); await page.locator('.settings-heading').waitFor(); await mount(page, mode, base); };
    const playing = async () => {
      try { await page.waitForFunction(() => { const video = document.querySelector('.player video'); return video && !video.paused && video.currentTime >= 12; }); }
      catch (error) {
        console.error(mode, await page.evaluate(() => ({calls:window.__calls,media:[...document.querySelectorAll('.player video,.player audio')].map(m=>({src:m.currentSrc,time:m.currentTime,paused:m.paused,ready:m.readyState,error:m.error?.message})),text:document.querySelector('.player')?.textContent})), errors);
        throw error;
      }
    };
    const choose = async (kind, name) => { await page.getByRole('button', { name: kind, exact: true }).click(); await page.getByRole('menu', { name: kind, exact: true }).getByRole('menuitemradio', { name: new RegExp('^' + name) }).click(); };
    const show = async (id, autoPlay = true) => { await page.evaluate(({ id, autoPlay }) => window.__show(id, autoPlay), { id, autoPlay }); await page.waitForFunction(id => document.querySelector('.player')?.getAttribute('aria-label') === 'Track audit ' + id + ' player', id); await page.waitForTimeout(250); };
    await open(); await playing();
    check(await selected(page, 'Audio', 'English') && await selected(page, 'Subtitles', 'Off'), mode + ' initial defaults retained');
    await choose('Audio', 'Japanese'); await choose('Subtitles', 'Japanese'); await playing();
    await page.waitForFunction(() => document.querySelector('.player video track')?.track.activeCues?.[0]?.text === 'Japanese caption');
    check(await selected(page, 'Audio', 'Japanese') && await selected(page, 'Subtitles', 'Japanese'), mode + ' manual choices applied');
    await show(2); await playing();
    check(await selected(page, 'Audio', 'Japanese') && await selected(page, 'Subtitles', 'Japanese'), mode + ' both choices restored despite shifted stream IDs');
    check(await page.evaluate(() => window.__calls.some(call => call.kind === 'audio' && call.id === 2 && call.stream === 8)), mode + ' actual audio preparation uses the restored stream');
    await page.waitForFunction(() => { const video = document.querySelector('.player video'), audio = document.querySelector('.player audio'); return audio?.readyState >= 2 && !audio.paused && Math.abs(audio.currentTime - video.currentTime) < 0.5; });
    check(true, mode + ' restored audio is audible and synchronized at saved position');
    const saved = await page.evaluate(() => [localStorage.getItem('virelo-playback-audio:v1'), localStorage.getItem('virelo-playback-subtitles:v1')]);
    await show(3); await playing();
    check(await page.getByRole('button', { name: 'Audio', exact: true }).count() === 0 && await selected(page, 'Subtitles', 'Off'), mode + ' changed layouts fall back to defaults');
    check(JSON.stringify(await page.evaluate(() => [localStorage.getItem('virelo-playback-audio:v1'), localStorage.getItem('virelo-playback-subtitles:v1')])) === JSON.stringify(saved), mode + ' fallback does not overwrite saved choices');
    await show(5); await playing(); check(await selected(page, 'Subtitles', 'Japanese'), mode + ' subtitles restore independently of an audio mismatch');
    await show(6); await playing(); check(await selected(page, 'Audio', 'Japanese') && await selected(page, 'Subtitles', 'Off'), mode + ' audio restores independently of a subtitle mismatch');
    await show(2); await playing(); check(await selected(page, 'Subtitles', 'Japanese'), mode + ' compatible video restores choices after mismatched videos');
    await choose('Subtitles', 'Off'); await show(1); await playing(); check(await selected(page, 'Subtitles', 'Off') && await page.locator('.player video track').count() === 0, mode + ' subtitle Off persists');
    await choose('Audio', 'English'); await show(2); await playing(); check(await selected(page, 'Audio', 'English'), mode + ' an explicit default-language click replaces the saved choice');
    await choose('Audio', 'Japanese'); await choose('Subtitles', 'Japanese'); await playing();
    await page.reload(); await page.locator('.settings-heading').waitFor(); await mount(page, mode, base); await playing();
    check(await selected(page, 'Audio', 'Japanese') && await selected(page, 'Subtitles', 'Japanese'), mode + ' both choices survive reload');
    if(mode==='web'){
      await choose('Quality','90p');await playing();
      check(await page.evaluate(()=>window.__calls.some(call=>call.kind==='quality'&&call.id===1&&call.stream===2)),mode+' lower-quality conversion uses selected audio');
    }
    await page.locator('.player video').evaluate(video=>{video.currentTime=40;});
    await page.waitForFunction(()=>document.querySelector('.player video').currentTime>=40);
    await choose('Quality','Original Quality');await playing();
    await page.waitForFunction(()=>{const video=document.querySelector('.player video'),audio=document.querySelector('.player audio');return !video.paused&&!audio.paused&&audio.readyState>=2&&Math.abs(audio.currentTime-video.currentTime)<0.5;});
    check(await page.locator('.player video').evaluate(video=>video.currentTime>=40),mode+' restoring original quality with saved audio does not jump back to initial progress');
    await show(2, false); await page.waitForFunction(() => document.querySelector('.player audio')?.readyState >= 2);
    check(await page.locator('.player video').evaluate(video => video.paused) && await page.locator('.player audio').evaluate(audio => audio.paused), mode + ' restored tracks respect paused playback');
    check(errors.length === 0, mode + ' no runtime errors: ' + errors.join('|'));
    await context.close();
  }
  console.log(JSON.stringify({ checks }));
} finally {
  await browser?.close();
  for (const child of servers) child.kill();
  assert.ok(folder.startsWith(join(tmpdir(), 'virelo-tracks-audit-')));
  await rm(folder, { recursive: true, force: true });
}
