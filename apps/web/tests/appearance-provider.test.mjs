import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';
import { QueryClient, QueryObserver, MutationObserver } from '@tanstack/react-query';

const server = existsSync(new URL('../src/appearance.ts', import.meta.url));
const { DEFAULT_APPEARANCE: defaults, appearanceVariables } = await load('utils/appearance.ts');
const settle = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function mount(t, api, client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })) {
  const effects = [], unsubscribers = [], cleanups = [], properties = new Map([['--color-brand', ['#112233', 'important']]]);
  const window = new EventTarget(), records = new Map();
  const localStorage = { getItem: key => records.get(key) ?? null, setItem: (key, value) => records.set(key, value) };
  const style = {
    getPropertyValue: key => properties.get(key)?.[0] ?? '',
    getPropertyPriority: key => properties.get(key)?.[1] ?? '',
    setProperty: (key, value, priority = '') => properties.set(key, [value, priority]),
    removeProperty: key => properties.delete(key)
  };
  const harness = { api, hooks: {
    createContext: () => ({ Provider: 'appearance-provider' }), useContext: context => context, useRef: value => ({current:value}),
    useEffect: setup => effects.push(setup), useLayoutEffect: setup => effects.push(setup)
  }, query: {
    useQueryClient: () => client,
    useQuery: options => {
      const observer = new QueryObserver(client, options);
      unsubscribers.push(observer.subscribe(() => {}));
      return observer.getCurrentResult();
    },
    useMutation: options => {
      return { isPending: false, error: null, mutateAsync: value => new MutationObserver(client, options).mutate(value) };
    }
  } };
  const restores = [];
  for (const [key, value] of Object.entries({ window, localStorage, document: { documentElement: { style } }, __appearanceTest: harness })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    restores.push(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key]);
  }
  const unmount = () => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); unsubscribers.splice(0).forEach(unsubscribe => unsubscribe()); };
  t.after(() => { unmount(); client.clear(); restores.reverse().forEach(restore => restore()); });
  const { AppearanceProvider } = await load('components/AppearanceProvider.tsx', {
    react: 'export const {createContext,useContext,useEffect,useLayoutEffect,useRef} = globalThis.__appearanceTest.hooks;',
    '@tanstack/react-query': 'export const {useQueryClient,useQuery,useMutation} = globalThis.__appearanceTest.query;',
    '../api': 'export const api = globalThis.__appearanceTest.api;'
  });
  const element = AppearanceProvider({ children: null });
  for (const effect of effects) {
    const cleanup = effect();
    if (cleanup) cleanups.push(cleanup);
  }
  return { client, properties, records, value: element.props.value, unmount,
    storage: (key, storageArea = localStorage) => window.dispatchEvent(Object.assign(new Event('storage'), { key, storageArea })) };
}

test('a late appearance GET cannot overwrite a completed save', async t => {
  const read = deferred(), saved = { controllerStyle: 'theater', accentColor: '#abcdef' };
  const env = await mount(t, { appearance: () => read.promise, saveAppearance: async () => saved });
  await env.value.save(saved);
  read.resolve(defaults);
  await settle();
  assert.deepEqual(env.client.getQueryData(['appearance']), saved);
});

test('cross-tab changes supersede a pending initial appearance read', async t => {
  const read = deferred(), saved = { controllerStyle: 'theater', accentColor: '#abcdef' };
  let reads = 0;
  const env = await mount(t, { appearance: () => ++reads === 1 ? read.promise : Promise.resolve(saved), saveAppearance: async value => value });
  env.storage(server ? 'virelo-appearance-changed' : 'virelo.appearance.v1');
  await settle();
  read.resolve(defaults);
  await settle();
  assert.deepEqual(env.client.getQueryData(['appearance']), saved);
});

test('cross-tab appearance changes and cleared storage refetch, while unrelated and session events do not', async t => {
  let current = defaults, reads = 0;
  const env = await mount(t, { appearance: async () => { reads++; return current; }, saveAppearance: async value => value });
  await settle();
  current = { controllerStyle: 'centerstage', accentColor: '#ff0000' };
  env.storage('unrelated');
  env.storage(server ? 'virelo-appearance-changed' : 'virelo.appearance.v1', {});
  await settle();
  assert.equal(reads, 1);
  env.storage(server ? 'virelo-appearance-changed' : 'virelo.appearance.v1');
  await settle();
  assert.deepEqual(env.client.getQueryData(['appearance']), current);
  assert.equal(reads, 2);
  current = defaults;
  env.storage(null);
  await settle();
  assert.deepEqual(env.client.getQueryData(['appearance']), defaults);
  assert.equal(reads, 3);
  env.unmount();
  env.storage(null);
  await settle();
  assert.equal(reads, 3, 'unmount removes the cross-tab listener');
});

test('accent overrides restore the preceding CSS value and priority on unmount', async t => {
  const env = await mount(t, { appearance: async () => defaults, saveAppearance: async value => value });
  assert.equal(env.properties.get('--color-brand')[0], appearanceVariables(defaults.accentColor)['--color-brand']);
  env.unmount();
  assert.deepEqual([...env.properties], [['--color-brand', ['#112233', 'important']]]);
});

test('failed appearance saves leave the current settings in the cache', async t => {
  const env = await mount(t, { appearance: async () => defaults, saveAppearance: async () => { throw Error('offline'); } });
  await settle();
  await assert.rejects(env.value.save({ controllerStyle: 'theater', accentColor: '#abcdef' }), /offline/);
  assert.deepEqual(env.client.getQueryData(['appearance']), defaults);
});

test('consecutive appearance saves run in order and keep the latest choice', async t => {
  const first = deferred(), calls = [], older = { ...defaults, controllerStyle:'theater' }, latest = { ...defaults, controllerStyle:'centerstage' };
  const env = await mount(t, { appearance: async () => defaults, saveAppearance: async value => {
    calls.push(value); if (calls.length === 1) await first.promise; return value;
  } });
  const one = env.value.save(older), two = env.value.save(latest);
  await settle(); assert.deepEqual(calls, [older]);
  first.resolve(); await Promise.all([one,two]);
  assert.deepEqual(calls, [older,latest]);
  assert.deepEqual(env.client.getQueryData(['appearance']), latest);
});

test('queued appearance writes cannot start after the account provider unmounts', async t => {
  const first = deferred(), calls = [];
  const env = await mount(t, { appearance: async () => defaults, saveAppearance: async value => {
    calls.push(value); await first.promise; return value;
  } });
  const one = env.value.save(defaults), two = env.value.save({...defaults,controllerStyle:'theater'});
  const rejected = assert.rejects(two, /unavailable/);
  await settle(); env.unmount(); first.resolve();
  await Promise.all([one,rejected]);
  assert.equal(calls.length, 1);
});

