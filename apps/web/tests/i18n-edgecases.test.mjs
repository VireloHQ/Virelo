import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

function fresh(failures = []) {
  const mocks = Object.fromEntries(['en', 'ja', 'zh-CN', 'ko', 'ru'].map(locale => [
    './messages/' + locale + '.json', failures.includes(locale) ? "throw new Error('offline'); export default {};" : 'export default {Ready:' + JSON.stringify(locale) + '};'
  ]));
  return load('i18n/runtime.ts', mocks);
}
function browser(t, entries = [], preferred = ['en-US']) {
  const records = new Map(entries);
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const window = Object.assign(new EventTarget(), { localStorage });
  for (const [key, value] of Object.entries({ window, localStorage, document: { documentElement: { lang: 'en' } }, navigator: { languages: preferred, language: preferred[0] } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  return { records, storage: (key, storageArea = localStorage) => window.dispatchEvent(Object.assign(new Event('storage'), { key, storageArea })) };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test('locale initialization is safe before browser globals exist and still works on browser startup', async t => {
  const runtime = await fresh();
  assert.doesNotThrow(() => runtime.initializeLocale());
  await runtime.setLocale('ru', false);
  assert.equal(runtime.getLocale(), 'ru');
  browser(t, [], ['ja-JP']);
  runtime.initializeLocale();
  await settle();
  assert.equal(runtime.getLocale(), 'ja');
});


test('corrupted current preferences fall back to a valid legacy device preference', async t => {
  browser(t, [['virelo.language.v1', 'bogus'], ['virelo-public-locale:v1', 'ja']], ['ko-KR']);
  const runtime = await fresh();
  assert.equal(runtime.deviceLocale(), 'ja');
});

test('initialization is idempotent and storage changes include legacy preferences but not session storage', async t => {
  const env = browser(t, [['virelo-public-locale:v1', 'ja']]);
  const runtime = await fresh();
  let events = 0;
  runtime.subscribeLocale(() => events++);
  runtime.initializeLocale();
  await settle();
  assert.equal(runtime.getLocale(), 'ja');
  runtime.initializeLocale();
  await settle();
  assert.equal(events, 1);
  env.records.set('virelo-public-locale:v1', 'ru');
  env.storage('virelo-public-locale:v1');
  await settle();
  assert.equal(runtime.getLocale(), 'ru');
  env.records.set('virelo.language.v1', 'ko');
  env.storage('virelo.language.v1', {});
  await settle();
  assert.equal(runtime.getLocale(), 'ru', 'sessionStorage events must not apply localStorage preferences');
  env.storage('virelo.language.v1');
  await settle();
  assert.equal(runtime.getLocale(), 'ko');
  env.records.clear();
  env.storage(null);
  await settle();
  assert.equal(runtime.getLocale(), 'en');
});

test('initialization handles unavailable browser storage and a failed preferred catalog', async t => {
  browser(t, [], ['ko-KR']);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw Error('denied'); } });
  const runtime = await fresh(['ko']);
  runtime.initializeLocale();
  await settle();
  assert.equal(runtime.getLocale(), 'en');
  await runtime.setLocale('ja');
  assert.equal(runtime.getLocale(), 'ja', 'blocked persistence must not block the tab choice');
});

test('invalid locale loads reject with validation without disrupting a supported pending choice', async () => {
  const runtime = await fresh();
  const choice = runtime.setLocale('ja', false);
  await assert.rejects(runtime.loadLocale('__proto__'), /supported language/);
  await choice;
  assert.equal(runtime.getLocale(), 'ja');
});

test('duration formatting never emits negative or non-finite units in any locale', async () => {
  for (const locale of ['en', 'ja', 'zh-CN', 'ko', 'ru']) {
    const { formatDuration } = await load('i18n/format.ts', { './runtime': 'export const getLocale = () => ' + JSON.stringify(locale) + ';' });
    const zero = new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(0);
    for (const seconds of [-1, -3601, NaN, Infinity, -Infinity]) assert.equal(formatDuration(seconds), zero);
    assert.equal(formatDuration(59.9), new Intl.NumberFormat(locale, { style: 'unit', unit: 'second', unitDisplay: 'narrow' }).format(59));
    assert.equal(formatDuration(3601), new Intl.NumberFormat(locale, { style: 'unit', unit: 'hour', unitDisplay: 'narrow' }).format(1) + ' ' + new Intl.NumberFormat(locale, { style: 'unit', unit: 'minute', unitDisplay: 'narrow' }).format(0));
  }
});

