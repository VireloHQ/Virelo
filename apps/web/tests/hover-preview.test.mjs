import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../../../packages/web-ui/src/utils/hover-preview.ts', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let serial = 0;
const fresh = () => import(moduleUrl + '#' + ++serial);
const settle = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
function storage(saved) {
  const entries = new Map(saved === undefined ? [] : [['virelo-preview-muted:v1', saved]]);
  globalThis.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } };
  return entries;
}
class Video extends EventTarget {
  muted = false; paused = true; currentTime = 0; duration = 120; readyState = 1;
  plays = []; behavior = []; loads = 0; src = 'test.webm';
  play() {
    this.plays.push(this.muted);
    const result = this.behavior.shift();
    if (result instanceof Error) return Promise.reject(result);
    if (result) return result;
    this.paused = false;
    return Promise.resolve();
  }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  removeAttribute(name) { if (name === 'src') this.src = ''; }
  load() { this.loads++; }
}
function create(module, video = new Video(), start = 5) {
  const state = { stopped: 0, updates: [] };
  const controller = module.createHoverPreview(video, start, {
    onState: value => state.updates.push(value), onStop: () => state.stopped++
  });
  return { controller, video, state };
}

test('default muted; explicit toggle is shared with next card and survives reload', async () => {
  const entries = storage(), module = await fresh();
  const first = create(module); await settle();
  assert.deepEqual(first.video.plays, [true]);
  first.controller.toggleMuted(); await settle();
  assert.equal(entries.get('virelo-preview-muted:v1'), 'false');
  const next = create(module); await settle();
  assert.deepEqual(next.video.plays, [false]);
  assert.equal(first.state.stopped, 1);
  assert.equal(first.video.muted, true); assert.equal(first.video.paused, true);
  assert.equal(first.video.src, ''); assert.equal(first.video.loads, 1);
  next.controller.dispose();
  assert.equal((await fresh()).readPreviewMuted(), false);
});

test('sound autoplay rejection falls back to muted without overwriting saved choice', async () => {
  const entries = storage('false'), module = await fresh(), video = new Video();
  video.behavior.push(new DOMException('Blocked', 'NotAllowedError'));
  const preview = create(module, video); await settle();
  assert.deepEqual(video.plays, [false, true]);
  assert.deepEqual(preview.state.updates.at(-1), { muted: true, playing: true, progress: 0 });
  assert.equal(entries.get('virelo-preview-muted:v1'), 'false');
  assert.equal(module.readPreviewMuted(), false);
  preview.controller.toggleMuted(); await settle();
  assert.equal(video.muted, false); assert.equal(preview.state.updates.at(-1).muted, false);
  preview.controller.dispose();
});

test('a failed muted fallback never reports playing or writes a mute preference', async () => {
  const entries = storage('false'), module = await fresh(), video = new Video();
  video.behavior.push(new DOMException('Blocked', 'NotAllowedError'), new DOMException('Still blocked', 'NotAllowedError'));
  const preview = create(module, video); await settle();
  assert.equal(preview.state.updates.at(-1).playing, false);
  assert.equal(preview.state.updates.at(-1).muted, true);
  assert.equal(entries.get('virelo-preview-muted:v1'), 'false');
  preview.controller.dispose();
});

test('non-policy playback errors do not retry as if muting could fix them', async () => {
  storage('false'); const module = await fresh(), video = new Video();
  video.behavior.push(new DOMException('Bad codec', 'NotSupportedError'));
  const preview = create(module, video); await settle();
  assert.deepEqual(video.plays, [false]); assert.equal(video.paused, true);
  assert.equal(preview.state.updates.at(-1).playing, false);
  preview.controller.dispose();
});

test('late play rejection after disposal cannot restart a preview or notify state', async () => {
  storage('false'); const module = await fresh(), video = new Video();
  let reject; video.behavior.push(new Promise((_, fail) => { reject = fail; }));
  const preview = create(module, video);
  preview.controller.dispose();
  reject(new DOMException('Late block', 'NotAllowedError')); await settle();
  assert.deepEqual(video.plays, [false]); assert.equal(video.paused, true); assert.equal(video.muted, true);
  assert.equal(preview.state.updates.length, 0);
});

test('superseded play rejection cannot mute a successful explicit user retry', async () => {
  storage('false'); const module = await fresh(), video = new Video();
  let reject; video.behavior.push(new Promise((_, fail) => { reject = fail; }));
  const preview = create(module, video);
  preview.controller.toggleMuted(); await settle();
  reject(new DOMException('Old attempt', 'NotAllowedError')); await settle();
  assert.equal(video.muted, false); assert.equal(video.paused, false);
  assert.deepEqual(video.plays, [false, false]); preview.controller.dispose();
});

test('only one card owns playback even across multiple rows and pending metadata', async () => {
  storage('false'); const module = await fresh(), firstVideo = new Video();
  firstVideo.readyState = 0;
  const first = create(module, firstVideo), next = create(module); await settle();
  firstVideo.dispatchEvent(new Event('loadedmetadata'));
  assert.deepEqual(firstVideo.plays, []); assert.equal(first.state.stopped, 1);
  first.controller.dispose();
  const third = create(module); await settle();
  assert.equal(next.state.stopped, 1); third.controller.dispose();
});

test('loop bounds, short clips and stale resume positions remain playable', async () => {
  storage(); const module = await fresh(), preview = create(module); await settle();
  preview.video.currentTime = 21; preview.video.dispatchEvent(new Event('timeupdate'));
  assert.equal(preview.video.currentTime, 5);
  preview.video.dispatchEvent(new Event('ended')); await settle();
  assert.equal(preview.video.currentTime, 5); assert.equal(preview.video.plays.length, 2);
  preview.controller.dispose();
  const short = new Video(); short.duration = 2;
  const second = create(module, short, 200); await settle();
  assert.equal(short.currentTime, 1.5); second.controller.dispose();
});

test('stop/error unloads the media exactly once and detaches every event handler', async () => {
  storage(); const module = await fresh(), preview = create(module); await settle();
  preview.video.dispatchEvent(new Event('error'));
  const count = preview.state.updates.length;
  preview.controller.stop(); preview.controller.dispose(); preview.controller.toggleMuted();
  for (const name of ['loadedmetadata', 'ended', 'timeupdate', 'volumechange', 'pause', 'error']) preview.video.dispatchEvent(new Event(name));
  assert.equal(preview.video.loads, 1); assert.equal(preview.state.stopped, 1);
  assert.equal(preview.state.updates.length, count); assert.equal(preview.video.paused, true);
});

test('blocked/invalid storage stays safely muted while explicit session choices work', async () => {
  for (const saved of ['true', 'null', 'invalid', '0']) {
    storage(saved); assert.equal((await fresh()).readPreviewMuted(), true);
  }
  globalThis.window = { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } } };
  const module = await fresh(), preview = create(module); await settle();
  assert.equal(preview.video.muted, true);
  preview.controller.toggleMuted(); await settle();
  assert.equal(module.readPreviewMuted(), false); assert.equal(preview.video.muted, false);
  preview.controller.toggleMuted(); await settle();
  assert.equal(module.readPreviewMuted(), true); preview.controller.dispose();
});
