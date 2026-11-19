import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import * as writes from '../../../packages/web-ui/src/utils/queue-session-writes.ts';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

const { enqueueQueueSessionWrite: enqueue, waitForQueueSessionWrites: drain,
  activateQueueSessionWrites: activate, stopQueueSessionWrites: stop } = writes;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
let serial = 0;
async function accountEnvironment(t, signOut) {
  const key = '__queueAccountLifecycle' + ++serial, outer = new QueryClient();
  const root = { slots: [], cursor: 0, layout: [], passive: [], cleanups: [] };
  const privateRoot = { slots: [], cursor: 0, layout: [], passive: [], cleanups: [] };
  let current = root;
  const status = { user: { id: 1, revision: 1, permissions: { play: true } }, localAccess: true };
  outer.setQueryData(['account-session'], status);
  const window = new EventTarget(), previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousChannel = Object.getOwnPropertyDescriptor(globalThis, 'BroadcastChannel');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'BroadcastChannel', { configurable: true, value: class { close() {} postMessage() {} } });
  globalThis[key] = { writes, api: { signOut }, QueryClient,
    QueryClientProvider: 'query-provider', useQueryClient: () => outer,
    useQuery: () => ({ data: outer.getQueryData(['account-session']), isPending: false }),
    hooks: {
      createContext: () => ({ Provider: 'context-provider' }), useContext: () => null,
      useEffect: setup => current.passive.push(setup), useLayoutEffect: setup => current.layout.push(setup),
      useRef(value) { const index = current.cursor++; return current.slots[index] ??= { current: value }; },
      useState(value) {
        const instance = current, index = current.cursor++;
        if (!(index in instance.slots)) instance.slots[index] = typeof value === 'function' ? value() : value;
        return [instance.slots[index], value => { instance.slots[index] = value; }];
      }
    }
  };
  const env = `globalThis[${JSON.stringify(key)}]`;
  const { AccountSession } = await load('components/AccountSession.tsx', {
    react: `export const {createContext,useContext,useEffect,useLayoutEffect,useRef,useState}=${env}.hooks;`,
    '@tanstack/react-query': `export const {QueryClient,QueryClientProvider,useQuery,useQueryClient}=${env};`,
    '@virelo/web-ui/utils/queue-session-writes.ts': `export const {activateQueueSessionWrites,stopQueueSessionWrites}=${env}.writes;`,
    '../api': `export const api=${env}.api;`, '../i18n': 'export const t=value=>value,useLocale=()=>{};',
    '@heroui/react': 'export const Button="button",Input="input";',
    '@virelo/web-ui/store.ts': 'export const useUIStore={setState(){}};',
    './ActivityDisclosure': 'export const ActivityDisclosure=()=>null,ActivityReporter=()=>null;',
    './AccountLanguage': 'export const AccountLanguage=()=>null;',
    '@virelo/web-ui/components/LanguageSettings.tsx': 'export const LanguageSelect=()=>null;'
  });
  const mount = instance => {
    for (const setup of [...instance.layout, ...instance.passive]) {
      const cleanup = setup(); if (cleanup) instance.cleanups.push(cleanup);
    }
  };
  const unmount = instance => { instance.cleanups.splice(0).forEach(cleanup => cleanup()); };
  const element = AccountSession({ children: null }); mount(root);
  current = privateRoot;
  const provider = element.type(element.props); mount(privateRoot);
  const ref = element.props.queueClientRef, owner = ref.current;
  const providerCleanup = activate(owner);
  t.after(() => {
    providerCleanup(); unmount(privateRoot); unmount(root); owner.clear(); outer.clear();
    delete globalThis[key];
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousChannel) Object.defineProperty(globalThis, 'BroadcastChannel', previousChannel); else delete globalThis.BroadcastChannel;
  });
  return { owner, outer, ref, window, session: provider.props.value,
    unmount: () => unmount(privateRoot), providerCleanup };
}

test('failed logout restores only the current account; cleanup still stops the recovered lifetime', async t => {
  const request = deferred(), pending = deferred(), calls = [];
  const env = await accountEnvironment(t, () => { calls.push('sign out'); return request.promise; });
  const old = enqueue(env.owner, 'queue-1', () => { calls.push('old started'); return pending.promise; });
  const queued = enqueue(env.owner, 'queue-1', async () => { calls.push('old queued'); });
  await settle();
  const logout = assert.rejects(env.session.logout(), /network failure/);
  assert.deepEqual(calls, ['old started', 'sign out']);
  pending.resolve(); assert.equal(await old, false); assert.equal(await queued, false);
  request.reject(Error('network failure')); await logout;
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { calls.push('recovered'); }), true);
  env.providerCleanup();
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { calls.push('after cleanup'); }), false);
  assert.deepEqual(calls, ['old started', 'sign out', 'recovered']);
});

test('logout failure cannot reactivate an old private client after account switching', async t => {
  const request = deferred(), env = await accountEnvironment(t, () => request.promise);
  const logout = assert.rejects(env.session.logout(), /late failure/);
  const next = new QueryClient(); t.after(() => { stop(next); next.clear(); });
  env.ref.current = next;
  env.outer.setQueryData(['account-session'], { user: { id: 2, revision: 1 } });
  request.reject(Error('late failure')); await logout;
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { throw Error('old account write'); }), false);
  assert.equal(await enqueue(next, 'queue-1', async () => {}), true);
});

test('expiry stops the account before clearing cache and a pending drain never issues GET', async t => {
  const env = await accountEnvironment(t, async () => {}), pending = deferred(), calls = [];
  const old = enqueue(env.owner, 'queue-1', () => pending.promise);
  const queued = enqueue(env.owner, 'queue-1', async () => { calls.push('queued write'); });
  await settle();
  const waiting = assert.rejects(drain(env.owner, 'queue-1').then(() => { calls.push('GET'); }), /writes stopped/);
  env.window.dispatchEvent(new Event('virelo-auth-expired'));
  assert.equal(env.outer.getQueryData(['account-session']).user, null);
  pending.resolve(); await Promise.all([old, queued, waiting]); assert.deepEqual(calls, []);
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { calls.push('late'); }), false);
});

test('successful logout keeps old writes stopped and private-session teardown stops every lifetime', async t => {
  const request = deferred(), env = await accountEnvironment(t, () => request.promise);
  const logout = env.session.logout();
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { throw Error('write after logout started'); }), false);
  request.resolve(); await logout;
  assert.equal(env.outer.getQueryData(['account-session']).user, null);
  activate(env.owner); env.unmount();
  assert.equal(await enqueue(env.owner, 'queue-1', async () => { throw Error('write after account teardown'); }), false);
});
