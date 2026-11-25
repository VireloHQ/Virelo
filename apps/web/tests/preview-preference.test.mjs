import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

const source = await readFile(new URL('../../../packages/web-ui/src/utils/preview-preference.ts', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const key = 'virelo-preview-enabled:v1';
let serial = 0;
async function environment(t, saved) {
  const records = new Map(saved === undefined ? [] : [[key, saved]]), window = new EventTarget();
  let reads = 0, writes = 0, listeners = 0;
  const storage = { getItem: name => { reads++; return records.get(name) ?? null; }, setItem: (name, value) => { writes++; records.set(name, value); } };
  const add = window.addEventListener.bind(window), remove = window.removeEventListener.bind(window);
  window.addEventListener = (...args) => { if (args[0] === 'storage') listeners++; add(...args); };
  window.removeEventListener = (...args) => { if (args[0] === 'storage') listeners--; remove(...args); };
  for (const [name, value] of Object.entries({ window, localStorage: storage })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name]);
  }
  const preference = await import(moduleUrl + '#' + ++serial);
  return { preference, records, storage, window, counts: () => ({ reads, writes, listeners }),
    event: (name, value, storageArea = storage) => window.dispatchEvent(Object.assign(new Event('storage'), { key: name, newValue: value, storageArea })) };
}

test('default ON and only raw false disables; reads are cached and explicit choice persists', async t => {
  for (const value of [undefined, 'true', 'invalid', '0', 'False', 'null']) {
    const env = await environment(t, value), p = env.preference;
    assert.equal(p.readPreviewEnabled(), true); assert.equal(p.readPreviewEnabled(), true);
    assert.equal(env.counts().reads, 1);
  }
  const env = await environment(t, 'false'), p = env.preference;
  assert.equal(p.readPreviewEnabled(), false);
  p.savePreviewEnabled(true); assert.equal(env.records.get(key), 'true');
  const reloaded = await import(moduleUrl + '#' + ++serial); assert.equal(reloaded.readPreviewEnabled(), true);
});

test('one shared listener updates every subscriber, with no duplicate unchanged notifications', async t => {
  const env = await environment(t), p = env.preference;
  let first = 0, second = 0;
  const a = p.subscribePreviewEnabled(() => first++), b = p.subscribePreviewEnabled(() => second++);
  assert.equal(env.counts().listeners, 1); assert.equal(p.readPreviewEnabled(), true);
  p.savePreviewEnabled(false); p.savePreviewEnabled(false);
  assert.equal(p.readPreviewEnabled(), false); assert.equal(first, 1); assert.equal(second, 1);
  env.event('unrelated', 'true'); env.event(key, 'true', {});
  assert.equal(p.readPreviewEnabled(), false);
  env.records.set(key, 'true'); env.event(key, 'true'); assert.equal(p.readPreviewEnabled(), true);
  env.records.set(key, 'false'); env.event(key, 'false'); assert.equal(p.readPreviewEnabled(), false);
  env.records.clear(); env.event(null, null); assert.equal(p.readPreviewEnabled(), true);
  a(); assert.equal(env.counts().listeners, 1); b(); assert.equal(env.counts().listeners, 0);
});

test('external changes between subscriptions are read fresh on the next mount', async t => {
  const env = await environment(t), p = env.preference;
  const unsubscribe = p.subscribePreviewEnabled(() => {});
  assert.equal(p.readPreviewEnabled(), true); unsubscribe();
  env.records.set(key, 'false');
  assert.equal(p.readPreviewEnabled(), false);
  const next = p.subscribePreviewEnabled(() => {}); assert.equal(p.readPreviewEnabled(), false); next();
});

test('blocked storage keeps this session choice through unmount and remount', async t => {
  const env = await environment(t), p = env.preference;
  env.storage.getItem = () => { throw Error('blocked'); }; env.storage.setItem = () => { throw Error('blocked'); };
  const unsubscribe = p.subscribePreviewEnabled(() => {});
  assert.equal(p.readPreviewEnabled(), true); assert.doesNotThrow(() => p.savePreviewEnabled(false));
  unsubscribe(); assert.equal(p.readPreviewEnabled(), false);
  const next = p.subscribePreviewEnabled(() => {}); assert.equal(p.readPreviewEnabled(), false);
  p.savePreviewEnabled(true); assert.equal(p.readPreviewEnabled(), true); next();
});

test('successful same-tab backup write refreshes the active snapshot without a storage event', async t => {
  const env = await environment(t), p = env.preference;
  let changes = 0;
  const unsubscribe = p.subscribePreviewEnabled(() => changes++);
  assert.equal(p.readPreviewEnabled(), true);
  env.records.set(key, 'false'); p.refreshPreviewEnabled();
  assert.equal(p.readPreviewEnabled(), false); assert.equal(changes, 1); unsubscribe();
});

test('shared setting exposes a browser-local switch and changes the actual preference', async t => {
  const env = await environment(t), p = env.preference;
  globalThis.__previewSettingTest = p; t.after(() => delete globalThis.__previewSettingTest);
  const { PreviewSetting } = await load('components/PreviewSetting.tsx', {
    '@edition/i18n': 'export const t=value=>value,useLocale=()=>{};',
    '@heroui/react': 'export function Switch(){} Switch.Content="content";Switch.Control="control";Switch.Thumb="thumb";',
    '../hooks/usePreviewEnabled': 'export const usePreviewEnabled=()=>globalThis.__previewSettingTest.readPreviewEnabled();',
    '../utils/preview-preference': 'export const savePreviewEnabled=value=>globalThis.__previewSettingTest.savePreviewEnabled(value);'
  });
  const before = PreviewSetting().props.children[1];
  assert.equal(before.props['aria-label'], 'Video previews'); assert.equal(before.props.isSelected, true);
  before.props.onChange(false); assert.equal(p.readPreviewEnabled(), false);
  assert.equal(PreviewSetting().props.children[1].props.isSelected, false);
});

test('MediaRow disables mounting/hover timers and never revives an old active preview', async t => {
  const savedClear = globalThis.clearTimeout, savedWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const timers = new Map(); let timerId = 1000, enabled = true, miniplayer = false, cursor = 0;
  const slots = [], effects = [], pending = [];
  const harness = { enabled: () => enabled, miniplayer: () => miniplayer, hooks: {
    useRef(value) { const index = cursor++; return slots[index] ??= { current: value }; },
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useEffect(setup, deps) { const index = cursor++, old = effects[index]; if (!old || deps.some((value, i) => old.deps[i] !== value)) pending.push(() => { old?.cleanup?.(); effects[index] = { deps, cleanup: setup() }; }); }
  } };
  globalThis.__previewRowTest = harness;
  const { MediaRow } = await load('components/MediaRow.tsx', {
    react: 'export const {useRef,useState,useEffect}=globalThis.__previewRowTest.hooks;',
    '@edition/i18n': 'export const t=value=>value,useLocale=()=>{};',
    '@phosphor-icons/react': 'export const CaretLeft="left",CaretRight="right";',
    '@edition/components/MediaCard': 'export const MediaCard=()=>null;',
    '../hooks/useRowWheel': 'export const useRowWheel=()=>()=>{};',
    '../hooks/usePreviewEnabled': 'export const usePreviewEnabled=()=>globalThis.__previewRowTest.enabled();',
    './PlaybackDock': 'export const useMiniplayerOpen=()=>globalThis.__previewRowTest.miniplayer();'
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; } } });
  globalThis.clearTimeout = id => { if (!timers.delete(id)) savedClear(id); };
  t.after(() => { globalThis.clearTimeout = savedClear; if (savedWindow === undefined) delete globalThis.window; else Object.defineProperty(globalThis, 'window', savedWindow); delete globalThis.__previewRowTest; });
  const render = () => { cursor = 0; const tree = MediaRow({ title: 'Videos', items: [{ id: 1 }] }); pending.splice(0).forEach(run => run()); return tree.props.children[1].props.children[0]; };
  render().props.onHoverChange(true); assert.equal(timers.size, 1);
  enabled = false; assert.equal(render().props.preview, false); assert.equal(timers.size, 0);
  enabled = true; assert.equal(render().props.preview, false);
  render().props.onHoverChange(true); for (const callback of timers.values()) callback(); timers.clear();
  assert.equal(render().props.preview, true);
  enabled = false; assert.equal(render().props.onHoverChange, undefined);
  enabled = true; assert.equal(render().props.preview, false);
  render().props.onHoverChange(true);
  miniplayer = true; assert.equal(render().props.onHoverChange, undefined); assert.equal(timers.size, 0);
  miniplayer = false; assert.equal(render().props.preview, false);
});
