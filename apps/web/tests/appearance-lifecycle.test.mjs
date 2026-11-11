import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

const server = existsSync(new URL('../src/languages.ts', import.meta.url));
const settle = () => new Promise(resolve => setImmediate(resolve));
function environment(t) {
  const records = new Map([['virelo.language.v1', 'ja']]), listeners = new Map(), effects = [], cleanups = [], updates = [], calls = [];
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const window = {
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); }
  };
  const properties = new Map(), style = {
    getPropertyValue: key => properties.get(key) ?? '', getPropertyPriority: () => '',
    setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key)
  };
  const harness = {
    react: {
      createContext: () => ({ Provider: 'appearance-provider' }), useContext: context => context,
      useEffect: setup => effects.push(setup), useLayoutEffect: setup => effects.push(setup),
      useRef: value => ({ current: value }), useState: value => [value, update => updates.push(update)]
    },
    query: {
      useQuery: () => ({ data: { locale: 'ko' }, isPending: false, error: null }),
      useMutation: () => ({ isPending: false, error: null, mutateAsync: async value => value }),
      useQueryClient: () => ({
        cancelQueries: async () => { calls.push('cancel'); },
        invalidateQueries: async () => { calls.push('invalidate'); }
      })
    },
    api: {}
  };
  const restores = [];
  for (const [key, value] of Object.entries({ window, localStorage, navigator: { languages: ['en-US'], language: 'en-US' }, document: { documentElement: { lang: 'en', style } }, __appearanceLifecycle: harness })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restores.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const unmount = () => cleanups.splice(0).reverse().forEach(cleanup => cleanup());
  t.after(() => { unmount(); restores.reverse().forEach(restore => restore()); });
  return { harness, records, updates, calls, unmount,
    commit: () => effects.splice(0).forEach(setup => { const cleanup = setup(); if (cleanup) cleanups.push(cleanup); }),
    dispatch: event => listeners.get('storage')?.forEach(listener => listener(event)),
    denyStorage: () => Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Access denied', 'SecurityError'); } })
  };
}
const reactMock = 'export const {createContext,useContext,useEffect,useLayoutEffect,useRef,useState} = globalThis.__appearanceLifecycle.react;';
const queryMock = 'export const {useQuery,useMutation,useQueryClient} = globalThis.__appearanceLifecycle.query;';
const i18nMock = 'export const {isLocale,languages,loadLocale,setLocale,setAccountLocale,t,useLocale} = globalThis.__appearanceLifecycle.i18n;';
const apiMock = 'export const api = globalThis.__appearanceLifecycle.api;';
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

for (const [outcome, unmounted] of [['success', true], ['failure', true], ['success', false]]) {
  test('a late language save ' + outcome + (unmounted ? ' after unmount cannot change locale or device storage' : ' while mounted applies the selected locale'), async t => {
    const env = environment(t), runtime = await load('i18n/runtime.ts'), locale = await load('i18n/locale.ts');
    if (server) await runtime.setAccountLocale('ko');
    else await runtime.setLocale('ko', false);
    const applied = [], response = deferred(), saveCalls = [];
    env.harness.i18n = { ...locale, ...runtime, useLocale: runtime.getLocale,
      setLocale: (...args) => { applied.push(args); return runtime.setLocale(...args); } };
    let onSave;
    if (server) {
      const previous = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
      Object.defineProperty(globalThis, 'fetch', { configurable: true, value: (url, options) => {
        saveCalls.push(url);
        assert.equal(url, '/api/account/language');
        assert.equal(options.method, 'PUT');
        assert.deepEqual(JSON.parse(options.body), { locale: 'ru' });
        return response.promise;
      } });
      t.after(() => previous ? Object.defineProperty(globalThis, 'fetch', previous) : delete globalThis.fetch);
      const { api } = await load('api.ts');
      onSave = api.saveLanguage;
    } else onSave = value => { saveCalls.push(value); return response.promise; };
    const { LanguageSelect } = await load('components/LanguageSettings.tsx', {
      react: reactMock, './Select': 'export function Select() {}', '../i18n': i18nMock
    });
    const view = LanguageSelect({ onSave });
    env.commit();
    view.props.children.find(child => child?.props?.onChange).props.onChange('ru');
    await settle();
    assert.equal(saveCalls.length, 1, 'the save must be in flight before logout/unmount');
    const updatesBeforeUnmount = env.updates.length;
    if (unmounted) {
      env.unmount();
      if (server) await runtime.setAccountLocale(undefined);
      else await runtime.setLocale(runtime.deviceLocale(), false);
    }
    if (outcome === 'success') response.resolve(server ? new Response(JSON.stringify({ locale: 'ru' }), { status: 200 }) : { locale: 'ru' });
    else response.reject(Error('offline'));
    await settle();
    assert.deepEqual(applied, unmounted ? [] : [['ru']], 'only a mounted selector may apply the saved locale');
    assert.equal(runtime.getLocale(), unmounted ? 'ja' : 'ru');
    assert.equal(env.records.get('virelo.language.v1'), server || unmounted ? 'ja' : 'ru');
    if (unmounted) assert.equal(env.updates.length, updatesBeforeUnmount, 'settled saves must not update unmounted React state');
  });
}

test('the locale storage listener ignores events safely when the localStorage getter is denied', async t => {
  const env = environment(t), runtime = await load('i18n/runtime.ts');
  runtime.initializeLocale();
  await settle();
  assert.equal(runtime.getLocale(), 'ja');
  env.denyStorage();
  assert.doesNotThrow(() => env.dispatch({ key: 'virelo.language.v1', storageArea: {} }));
  await settle();
  assert.equal(runtime.getLocale(), 'ja');
});

test('the appearance storage listener ignores events safely when the localStorage getter is denied', async t => {
  const env = environment(t);
  env.harness.query.useQuery = () => ({ data: { controllerStyle: 'classic', accentColor: '#c3a6ff' }, isPending: false, error: null });
  const { AppearanceProvider } = await load('components/AppearanceProvider.tsx', { react: reactMock, '@tanstack/react-query': queryMock, '../api': apiMock });
  AppearanceProvider({ children: null });
  env.commit();
  env.denyStorage();
  assert.doesNotThrow(() => env.dispatch({ key: server ? 'virelo-appearance-changed' : 'virelo.appearance.v1', storageArea: {} }));
  await settle();
  assert.deepEqual(env.calls, []);
});

if (server) test('the account-language storage listener ignores events safely when the localStorage getter is denied', async t => {
  const env = environment(t), runtime = await load('i18n/runtime.ts'), locale = await load('i18n/locale.ts');
  env.harness.i18n = { ...locale, ...runtime };
  const { AccountLanguage } = await load('components/AccountLanguage.tsx', { react: reactMock, '@tanstack/react-query': queryMock, '../api': apiMock, '../i18n': i18nMock });
  AccountLanguage();
  env.commit();
  await settle();
  assert.equal(runtime.getLocale(), 'ko');
  env.denyStorage();
  assert.doesNotThrow(() => env.dispatch({ key: 'virelo-account-language-changed', storageArea: {} }));
  await settle();
  assert.deepEqual(env.calls, []);
});

