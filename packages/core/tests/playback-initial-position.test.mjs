import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { loadAppearanceTestModule as loadWeb } from '../../../apps/web/tests/appearance-test-loader.mjs';
import { loadAppearanceTestModule as loadServer } from '../../../apps/server/tests/appearance-test-loader.mjs';

const root = new URL('../../../', import.meta.url);
const source = path => readFile(new URL(path, root), 'utf8');
const pure = text => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(text)).toString('base64'));
const { initialPlaybackPosition } = await pure(await source('packages/core/src/utils/playback-initial-position.ts'));

test('history defaults on, can be disabled, and never supplies invalid timestamps', () => {
  assert.equal(initialPlaybackPosition(125), 125);
  assert.equal(initialPlaybackPosition(125, true), 125);
  assert.equal(initialPlaybackPosition(125, false), 0);
  for (const value of [undefined, null, -5, NaN, Infinity, '125', false]) assert.equal(initialPlaybackPosition(value), 0);
});

// Render the real players with only their external hooks/services mocked. No browser or build output is needed.
async function loadPlayer(edition, load) {
  const code = await source(`apps/${edition}/web/src/components/Player.tsx`);
  const mocks = {};
  for (const [, names, , path] of code.matchAll(/import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2/g)) {
    if (path === '@virelo/core/playback-initial-position') continue;
    mocks[path] = names.split(',').map(name => name.trim()).filter(name => !name.startsWith('type ')).map(name =>
      `export const ${name} = (...args) => globalThis.__initialPositionTest[${JSON.stringify(name)}]?.(...args);`).join('\n');
  }
  mocks['../api'] = 'export const api = new Proxy({}, {get: (_, key) => (...args) => globalThis.__initialPositionTest.api[key](...args)});';
  mocks['hls.js/light'] = 'export default class Hls { static isSupported() { return false; } }';
  return (await load('components/Player.tsx', mocks)).Player;
}
const players = { web: await loadPlayer('web', loadWeb), server: await loadPlayer('server', loadServer) };
const backups = await loadWeb('browser-backup.ts', {
  './local-library': 'export function openDatabase() { throw Error("Unexpected database access"); } export function editLibraries(operation) { return operation(); }'
});
const flush = () => new Promise(setImmediate);

function environment(t, edition, { preference = 'source', alternateAudio = false, transcode = false } = {}) {
  const previous = new Map(['window', 'HTMLMediaElement', '__initialPositionTest'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of previous) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  globalThis.window = { location: { href: 'http://localhost/watch/1', hostname: 'localhost' }, clearTimeout() {}, setTimeout() { return 1; } };
  globalThis.HTMLMediaElement = { HAVE_METADATA: 1 };
  const calls = [], cells = [];
  let cursor = 0, effects = [], tree;
  const video = { currentTime: 0, duration: 1000, readyState: 4, paused: true, src: '', currentSrc: '',
    listeners: new Map(), addEventListener(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(listener); },
    removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }, canPlayType: () => 'maybe', removeAttribute() { this.src = ''; },
    pause() { this.paused = true; }, play() { this.paused = false; return Promise.resolve(); }, load() { this.currentTime = 0; } };
  const audio = { ...video, currentSrc: 'blob:audio', listeners: new Map() };
  const info = { audioTracks: [{ index: 0, codec: 'aac', supported: true }, { index: 1, codec: 'ac3' }], subtitleTracks: [],
    defaultAudioStream: 0, qualityOptions: [{ height: 1080 }, { height: 720 }], duration: 1000,
    requiresTranscode: transcode, requiresVideoTranscode: transcode, requiresAudioTranscode: alternateAudio };
  const start = kind => async (...args) => { calls.push([kind, ...args]); return true; };
  const adaptive = { state: 'idle', qualityOptions: info.qualityOptions, playbackBlocked: { current: false },
    start: start('quality'), setQuality() {}, release() {}, needsSeek: () => false };
  const fallback = { fallback: 'idle', startFallback: start('fallback'), release() {}, needsSeek: () => false };
  globalThis.__initialPositionTest = {
    useRef(value) { const index = cursor++; return cells[index] ??= { current: value }; },
    useState(value) { const index = cursor++; const cell = cells[index] ??= { value: typeof value === 'function' ? value() : value };
      return [cell.value, next => { cell.value = typeof next === 'function' ? next(cell.value) : next; }]; },
    useEffect(setup, deps) { const index = cursor++, cell = cells[index];
      if (!cell || deps.some((value, i) => value !== cell.deps[i])) effects.push({ setup, cleanup: cell?.cleanup, index });
      cells[index] = { ...cell, deps }; },
    usePlaybackVolume: () => ({ volume: 1, muted: false }), usePlaybackSpeed: () => ({ speed: 1 }),
    useVideoPresentation: () => ({ style: {} }), useVolumeLeveling: () => ({}),
    useBackgroundPlayback: () => ({ audioIsClock: () => false, handlePause: () => false, suspended: { current: false } }),
    useLocalMediaUrl: id => ({ url: `blob:source-${id}` }), useAdaptiveQuality: () => adaptive, useHlsFallback: () => fallback,
    readQualityPreference: () => preference, resolvePreferredQuality: (_, value) => typeof value === 'number' ? value : 1080,
    resolvePlaybackTrackSelection: type => type === 'audio' ? alternateAudio ? 1 : 0 : null,
    savePlaybackTrackSelection: () => true, t: text => text,
    probeBrowserPlayback: async () => info,
    prepareBrowserAudio: async (...args) => { calls.push(['audio', ...args]); return 'blob:audio'; },
    prepareBrowserQuality: async (...args) => { calls.push(['quality', ...args]); return 'blob:quality'; },
    api: { mediaFile: async () => ({}), playbackInfo: async () => info, progress: (...args) => calls.push(['progress', ...args]),
      startAudioTranscode: async (...args) => { calls.push(['audio', ...args]); return { status: 'ready', url: 'blob:audio' }; } }
  };
  function elements(node) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(elements);
    return [node, ...elements(node.props?.children), ...elements(node.props?.settings)];
  }
  function render(props) {
    cursor = 0; effects = []; tree = players[edition](props);
    for (const element of elements(tree)) {
      if (element.type === 'video') {
        element.props.ref.current = video;
        if (element.props.src !== video.src) { video.src = element.props.src; video.currentSrc = video.src; video.currentTime = 0; }
      }
      if (element.type === 'audio') element.props.ref.current = audio;
    }
    // Skip unrelated UI observer/PiP effects; exercise item reset and video/audio source setup.
    const playbackEffects = effects.filter(effect => /lastProgress\.current\s*=\s*0|api\.(mediaFile|playbackInfo)\(|audio\.addEventListener\(["']loadedmetadata["']/.test(String(effect.setup)));
    for (const effect of playbackEffects) effect.cleanup?.();
    for (const effect of playbackEffects) cells[effect.index].cleanup = effect.setup();
  }
  const props = { item: { id: 1, filename: 'video.mp4', title: 'Video', duration: 1000, progress_position: 125 } };
  return { calls, video, audio, props, async open(changes = {}) { Object.assign(props, changes); render(props); await flush(); render(props); await flush(); },
    metadata() { elements(tree).find(node => node.type === 'video').props.onLoadedMetadata({ currentTarget: video }); },
    seek(value) { elements(tree).find(node => node.props?.onToggle && node.props?.onSeek).props.onSeek(value); },
    async audioTrack(value) { elements(tree).find(node => node.props?.onSelectAudio).props.onSelectAudio(value); await flush(); render(props); await flush(); },
    audioMetadata() { for (const listener of audio.listeners.get('loadedmetadata') ?? []) listener(); },
    quality(value) { return elements(tree).find(node => node.props?.onSelectQuality).props.onSelectQuality(value); } };
}

for (const edition of ['web', 'server']) {
  test(`${edition}: native/direct starts default to history, disabled history starts at zero, and each item resets`, async t => {
    const env = environment(t, edition);
    await env.open(); env.metadata(); assert.equal(env.video.currentTime, 125);
    await env.open({ item: { ...env.props.item, id: 2 }, resumeFromHistory: false });
    env.metadata(); assert.equal(env.video.currentTime, 0);
    env.seek(37); env.metadata(); assert.equal(env.video.currentTime, 37, 'metadata cannot undo a manual seek');
    await env.open({ item: { ...env.props.item, id: 3 }, resumeFromHistory: true });
    env.metadata(); assert.equal(env.video.currentTime, 125);
    assert.equal(env.calls.filter(call => call[0] === 'progress').length, 0, 'item reset must not persist a stale old-item position');
  });

  test(`${edition}: initial lower-quality conversion ignores history only when disabled`, async t => {
    const env = environment(t, edition, { preference: 720 });
    await env.open({ resumeFromHistory: false });
    const first = env.calls.find(call => call[0] === 'quality');
    assert.equal(edition === 'web' ? first[5].position : first[2], 0);
    await env.open({ item: { ...env.props.item, id: 2 }, resumeFromHistory: true });
    const second = env.calls.filter(call => call[0] === 'quality').at(-1);
    assert.equal(edition === 'web' ? second[5].position : second[2], 125);
  });

  test(`${edition}: alternate audio starts at zero without history and manual quality switches retain live time`, async t => {
    const env = environment(t, edition, { alternateAudio: true });
    await env.open({ resumeFromHistory: false });
    const audio = env.calls.find(call => call[0] === 'audio');
    if (edition === 'web') assert.equal(audio[4].position, 0);
    else assert.equal(env.audio.currentTime, 0);
    env.seek(37); await env.quality(720); await flush();
    const quality = env.calls.filter(call => call[0] === 'quality').at(-1);
    assert.equal(edition === 'web' ? quality[5].position : quality[2], 37);
  });

  test(`${edition}: a subsequent audio switch retains live time when history resume is disabled`, async t => {
    const env = environment(t, edition);
    await env.open({ resumeFromHistory: false }); env.metadata(); env.seek(53);
    await env.audioTrack(1);
    if (edition === 'web') assert.equal(env.calls.find(call => call[0] === 'audio')[4].position, 53);
    else { env.audioMetadata(); assert.equal(env.audio.currentTime, 53); }
    assert.equal(env.video.currentTime, 53);
  });
}

test('server: compatible HLS conversion gates initial history', async t => {
  const env = environment(t, 'server', { transcode: true });
  await env.open({ resumeFromHistory: false });
  assert.equal(env.calls.find(call => call[0] === 'fallback')[2], 0);
  await env.open({ item: { ...env.props.item, id: 2 }, resumeFromHistory: true });
  assert.equal(env.calls.filter(call => call[0] === 'fallback').at(-1)[2], 125);
});

test('server settings default on and reject non-boolean patches', async () => {
  const code = (await source('apps/server/src/settings.ts')).replace("import { AccountError } from './accounts.js';", 'class AccountError extends Error {}');
  const { DEFAULT_SETTINGS, isSettingValue, validateSettingsPatch } = await pure(code);
  assert.equal(DEFAULT_SETTINGS.queueResumePosition, true);
  for (const value of [true, false]) {
    assert.equal(isSettingValue('queueResumePosition', value), true);
    assert.doesNotThrow(() => validateSettingsPatch({ queueResumePosition: value }));
  }
  for (const value of [undefined, null, 'false', 0, 1, [], {}]) {
    assert.equal(isSettingValue('queueResumePosition', value), false);
    assert.throws(() => validateSettingsPatch({ queueResumePosition: value }), /Invalid settings/);
  }
});

test('browser settings migrate missing/corrupt values, preserve false and reject invalid writes before storage', async t => {
  const key = '__resumeSettingsTest', previous = Object.getOwnPropertyDescriptor(globalThis, key);
  t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  const env = globalThis[key] = { stored: undefined, writes: 0 };
  const code = await source('apps/web/web/src/local-library.ts');
  const defaults = code.match(/const DEFAULT_SETTINGS: Settings = \{[\s\S]*?\n\};/)[0];
  const functions = code.slice(code.indexOf('export async function readSettings()'), code.indexOf('export function browserCapabilities()'));
  const { readSettings, writeSettings } = await pure(defaults + functions + `
    async function readStore() { return globalThis.${key}.stored; }
    async function writeStore(_name, value) { globalThis.${key}.writes++; globalThis.${key}.stored = value; }
    function cancelAudioAnalysis() {}
  `);
  for (const value of [undefined, null, 'false', 0, 1, [], {}]) {
    env.stored = value === undefined ? undefined : { queueResumePosition: value };
    assert.equal((await readSettings()).queueResumePosition, true);
  }
  assert.equal((await writeSettings({ queueResumePosition: false })).queueResumePosition, false);
  assert.equal((await readSettings()).queueResumePosition, false);
  assert.equal((await writeSettings({ queueBehavior: 'loop' })).queueResumePosition, false);
  const before = env.writes;
  for (const value of [undefined, null, 'false', 0, 1, [], {}]) await assert.rejects(writeSettings({ queueResumePosition: value }), /Invalid settings/);
  assert.equal(env.writes, before);
});

test('browser backup validation defaults legacy settings to true, preserves false and rejects malformed booleans', async () => {
  const value = { format: 'virelo-browser-backup', version: 1, kind: 'settings', createdAt: 1,
    settings: { audioAnalysisEnabled: false, shortsIncludeLandscapes: false, queueBehavior: 'auto' },
    preferences: {}, libraries: [], media: [], playlists: [] };
  const read = () => backups.readBrowserBackup(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  assert.equal((await read()).settings.queueResumePosition, true);
  for (const boolean of [false, true]) {
    value.settings.queueResumePosition = boolean;
    assert.equal((await read()).settings.queueResumePosition, boolean);
  }
  for (const invalid of [null, 'false', 0, 1, [], {}]) {
    value.settings.queueResumePosition = invalid;
    await assert.rejects(read(), /invalid or unsafe data/);
  }
});

test('every history read in both players passes through the policy', async () => {
  for (const edition of ['web', 'server']) {
    const code = await source(`apps/${edition}/web/src/components/Player.tsx`);
    assert.equal((code.match(/item\.progress_position/g) || []).length, 1);
    assert.match(code, /initialPlaybackPosition\(item\.progress_position, resumeFromHistory\)/);
    assert.match(code, /resumeFromHistory=true/);
  }
});
