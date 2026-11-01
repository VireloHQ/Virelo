import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const repo = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = createRequire(process.env.VIRELO_TEST_NODE_PACKAGE || import.meta.url)('playwright');
const server = spawn(process.execPath, [join(repo, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '0'],
  { cwd: repo, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
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
  browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM,
    args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route(base + '/__volume-controls', route => route.fulfill({ contentType: 'text/html',
    body: '<!doctype html><body><div id="fixture"></div></body>' }));
  await page.goto(base + '/__volume-controls');
  const checks = await page.evaluate(async () => {
    const Refresh = (await import('/@react-refresh')).default;
    Refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const main = await (await fetch('/src/main.tsx')).text();
    const imports = [...main.matchAll(/from ["']([^"']+)["']/g)].map(match => match[1]);
    const React = (await import(imports.find(url => url.includes('/react.js')))).default;
    const dom = await import(imports.find(url => url.includes('/react-dom_client.js')));
    localStorage.setItem('virelo-volume-leveling:v1', 'true');
    localStorage.setItem('virelo-playback-volume:v1', JSON.stringify({ volume: .03, muted: false }));
    const { useVolumeLeveling } = await import('/src/hooks/useVolumeLeveling.ts');
    const { usePlaybackVolume } = await import('/src/hooks/usePlaybackVolume.ts');
    const { VolumeLeveler } = await import('/src/utils/volume-leveler.ts');
    let leveler, failResume = false, controls, leveling, firstPlayVolume;
    const bind = VolumeLeveler.prototype.bind, resume = VolumeLeveler.prototype.resume;
    VolumeLeveler.prototype.bind = function (elements) { leveler = this; return bind.call(this, elements); };
    VolumeLeveler.prototype.resume = function () { return failResume ? Promise.reject(new Error('test suspension')) : resume.call(this); };
    // WAV fixture and media elements exercise native volumechange events, not a mocked audio graph.
    const bytes = new ArrayBuffer(44 + 48000 * 4), view = new DataView(bytes);
    const text = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)));
    text(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true); view.setUint32(24, 48000, true);
    view.setUint32(28, 192000, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, 192000, true);
    for (let index = 0; index < 48000; index++) for (let channel = 0; channel < 2; channel++)
      view.setInt16(44 + index * 4 + channel * 2, .4 * Math.sin(2 * Math.PI * 440 * index / 48000) * 32767, true);
    const urls = Array.from({ length: 3 }, () => URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })));
    function Fixture({ source = '' }) {
      const video = React.useRef(null), audio = React.useRef(null);
      controls = usePlaybackVolume();
      leveling = useVolumeLeveling(video, audio, source, controls);
      React.useEffect(() => {
        firstPlayVolume ??= leveler.graphs.get(video.current).output.gain.value;
        void (source ? audio.current : video.current).play();
      }, [source]);
      return React.createElement(React.Fragment, null,
        React.createElement('video', { ref: video, src: urls[0], loop: true, onVolumeChange: event => leveling.onVolumeChange(event.currentTarget) }),
        React.createElement('audio', { key: source, ref: audio, src: source || undefined, loop: true, onVolumeChange: event => leveling.onVolumeChange(event.currentTarget) }));
    }
    const root = (dom.createRoot || dom.default.createRoot)(document.getElementById('fixture'));
    const render = source => root.render(React.createElement(React.StrictMode, null, React.createElement(Fixture, { source })));
    const checks = [];
    const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
    const wait = async (predicate, label) => {
      const start = performance.now();
      while (!predicate()) { if (performance.now() - start > 10000) throw new Error(label); await new Promise(done => setTimeout(done, 10)); }
    };
    const settle = () => new Promise(done => setTimeout(done, 100));
    const gain = element => leveler.graphs.get(element).output.gain.value;
    render();
    await wait(() => document.querySelector('video')?.currentTime > .1, 'initial media playback');
    const video = document.querySelector('video');
    check(firstPlayVolume >= 0 && firstPlayVolume <= .030001,
      'first play cannot exceed the saved low volume (observed ' + firstPlayVolume + ')');
    await wait(() => Math.abs(gain(video) - .03) < .000001 && controls.volume === .03, 'saved volume is restored after startup');
    check(true, 'saved low volume is retained after startup');
    for (const volume of [0, .01, .5, 1, .03]) {
      controls.setVolume(volume); await settle();
      check(Math.abs(gain(video) - volume) < .000001 && controls.volume === volume && video.volume === 1,
        'native volumechange does not overwrite the requested UI volume ' + volume);
    }
    controls.setMuted(true); await settle();
    check(gain(video) === 0 && video.muted, 'UI mute reaches the final output');
    controls.setMuted(false); await settle();
    check(Math.abs(gain(video) - .03) < .000001, 'unmuting preserves saved attenuation');
    for (const source of urls.slice(1)) {
      render(source); await settle();
      const audio = document.querySelector('audio');
      await wait(() => !audio.paused && audio.currentTime > .05, 'selected audio playback');
      check(video.muted && gain(video) === 0 && !audio.muted && Math.abs(gain(audio) - .03) < .000001,
        'new/replaced audio elements inherit volume while the video soundtrack stays silent');
      check(leveler.graphs.size === 2, 'replacing an audio element releases the previous graph');
    }
    render(); await settle();
    check(!video.muted && Math.abs(gain(video) - .03) < .000001, 'returning to original audio retains the manual level');
    video.volume = .07; await settle();
    check(controls.volume === .07 && video.volume === 1 && Math.abs(gain(video) - .07) < .000001,
      'native volume controls update the UI and final master exactly once');
    video.muted = true; await settle(); check(controls.muted && gain(video) === 0, 'native mute is reflected by the UI');
    video.muted = false; await settle();
    await leveler.context.suspend(); failResume = true; window.dispatchEvent(new Event('pointerdown'));
    await wait(() => Boolean(leveling.levelingError), 'resume error is exposed');
    check(!leveling.leveling, 'failed resume is never advertised as active leveling');
    failResume = false; window.dispatchEvent(new Event('pointerdown'));
    await wait(() => leveling.leveling && !leveling.levelingError && leveler.context.state === 'running', 'resume retry');
    check(leveler.graphs.get(video).nodes.at(-1).gain.value === 1, 'successful retry restores processing as well as the On state');
    leveling.setLeveling(false); await settle();
    check(!leveling.leveling && Math.abs(gain(video) - .07) < .000001, 'disabling leveling retains final volume');
    video.pause(); document.querySelector('audio').pause(); root.unmount();
    await wait(() => leveler.context.state === 'closed', 'unmount closes the audio context');
    for (const url of urls) URL.revokeObjectURL(url);
    return checks;
  });
  assert.deepEqual(errors, []);
  for (const label of checks) console.log('PASS', label);
} finally { await browser?.close(); server.kill(); }
