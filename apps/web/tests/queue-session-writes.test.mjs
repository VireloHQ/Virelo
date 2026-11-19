import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import * as writes from '../../../packages/web-ui/src/utils/queue-session-writes.ts';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

const { enqueueQueueSessionWrite: enqueue, waitForQueueSessionWrites: drain,
  activateQueueSessionWrites: activate, stopQueueSessionWrites: stop } = writes;
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test('actual save invocation is serialized per client/key, including failures', async () => {
  const owner = {}, first = deferred(), calls = [];
  const a = enqueue(owner, 'queue-1', () => { calls.push(1); return first.promise; });
  const b = enqueue(owner, 'queue-1', async () => { calls.push(2); });
  await settle(); assert.deepEqual(calls, [1]);
  first.resolve(); assert.deepEqual(await Promise.all([a, b]), [true, true]);
  assert.deepEqual(calls, [1, 2]);
  const failure = enqueue(owner, 'queue-1', () => { throw Error('write failed'); });
  const next = enqueue(owner, 'queue-1', async () => { calls.push(3); });
  await assert.rejects(failure, /write failed/); assert.equal(await next, true);
  const independent = deferred();
  const pending = enqueue(owner, 'queue-1', () => independent.promise);
  assert.equal(await enqueue(owner, 'queue-2', async () => {}), true);
  assert.equal(await enqueue({}, 'queue-1', async () => {}), true);
  independent.resolve(); await pending;
});

test('completion delete reserves its place before a new mount saves the same playlist', async () => {
  const owner = {}, first = deferred(), deletion = deferred(), calls = [];
  let stored;
  const a = enqueue(owner, 'playlist-7', async () => { calls.push('old save'); await first.promise; stored = 1; });
  const b = enqueue(owner, 'playlist-7', async () => { calls.push('delete'); await deletion.promise; stored = undefined; });
  const c = enqueue(owner, 'playlist-7', async () => { calls.push('new save'); stored = 2; });
  await settle(); assert.deepEqual(calls, ['old save']);
  first.resolve(); await a; await settle(); assert.deepEqual(calls, ['old save', 'delete']);
  deletion.resolve(); await Promise.all([b, c]);
  assert.equal(stored, 2); assert.deepEqual(calls, ['old save', 'delete', 'new save']);
});

test('drain includes writes added during waiting and GET sees the final selection', async () => {
  const owner = {}, first = deferred(), second = deferred(), third = deferred();
  let stored = 0, read;
  const a = enqueue(owner, 'queue-1', async () => { await first.promise; stored = 1; });
  const waiting = drain(owner, 'queue-1').then(() => { read = stored; });
  const b = enqueue(owner, 'queue-1', async () => { await second.promise; stored = 2; });
  first.resolve(); await a; await settle(); assert.equal(read, undefined);
  const c = enqueue(owner, 'queue-1', async () => { await third.promise; stored = 3; });
  second.resolve(); await b; await settle(); assert.equal(read, undefined);
  third.resolve(); await c; await waiting; assert.equal(read, 3);
});

test('account stop cancels undispatched saves/delete and suppresses old success callbacks', async () => {
  const owner = {}, first = deferred(), calls = [], callbacks = [];
  const a = enqueue(owner, 'queue-1', () => { calls.push('in flight'); return first.promise; }).then(applied => { if (applied) callbacks.push('old'); });
  const b = enqueue(owner, 'queue-1', async () => { calls.push('queued save'); });
  const c = enqueue(owner, 'queue-1', async () => { calls.push('queued delete'); });
  await settle();
  const waiting = assert.rejects(drain(owner, 'queue-1').then(() => { calls.push('GET'); }), /writes stopped/);
  stop(owner); first.resolve(); await Promise.all([a, b, c, waiting]);
  assert.deepEqual(calls, ['in flight']); assert.deepEqual(callbacks, []);
  assert.equal(await enqueue(owner, 'queue-1', async () => { calls.push('late old save'); }), false);
  assert.equal(await enqueue({}, 'queue-1', async () => { calls.push('new account'); }), true);
  assert.deepEqual(calls, ['in flight', 'new account']);
});

test('StrictMode/reactivation cannot revive old work or bypass current provider cleanup', async () => {
  const owner = {}, cleanup = activate(owner), calls = [];
  const old = enqueue(owner, 'queue-1', async () => { calls.push('old'); });
  cleanup();
  const stopped = enqueue(owner, 'queue-1', async () => { calls.push('while stopped'); });
  const realCleanup = activate(owner);
  const fresh = enqueue(owner, 'queue-1', async () => { calls.push('fresh'); });
  assert.deepEqual(await Promise.all([old, stopped, fresh]), [false, false, true]);
  assert.deepEqual(calls, ['fresh']);
  stop(owner); activate(owner); // failed logout recovery
  assert.equal(await enqueue(owner, 'queue-1', async () => {}), true);
  realCleanup();
  assert.equal(await enqueue(owner, 'queue-1', async () => { calls.push('after cleanup'); }), false);
});

test('reactivation still waits for already dispatched work, without old error callbacks', async () => {
  const owner = {}, first = deferred(), calls = [];
  const old = enqueue(owner, 'queue-1', () => { calls.push('old started'); return first.promise; });
  await settle(); stop(owner); activate(owner);
  const next = enqueue(owner, 'queue-1', async () => { calls.push('new started'); });
  await settle(); assert.deepEqual(calls, ['old started']);
  first.reject(Error('late failure'));
  assert.equal(await old, false); assert.equal(await next, true);
  assert.deepEqual(calls, ['old started', 'new started']);
});

let serial = 0;
async function hookEnvironment(t, api, client = new QueryClient()) {
  const key = '__queueWriteHook' + ++serial;
  let instance;
  const env = globalThis[key] = { writes, client, api, hooks: {
    useState(value) {
      const index = instance.cursor++;
      if (!(index in instance.slots)) instance.slots[index] = typeof value === 'function' ? value() : value;
      const current = instance;
      return [current.slots[index], value => { current.slots[index] = value; }];
    },
    useRef(value) { const index = instance.cursor++; return instance.slots[index] ??= { current: value }; },
    useEffect(setup, deps) {
      const index = instance.cursor++, previous = instance.effects[index];
      if (!previous || deps.some((value, i) => value !== previous.deps[i])) instance.pending.push(() => {
        previous?.cleanup?.(); instance.effects[index] = { deps, setup, cleanup: setup() };
      });
    }
  } };
  const module = await load('hooks/useQueueSession.ts', {
    react: `export const {useState,useRef,useEffect}=globalThis[${JSON.stringify(key)}].hooks;`,
    '@tanstack/react-query': `export const useQueryClient=()=>globalThis[${JSON.stringify(key)}].client;`,
    '../media-services': `export const useMediaServices=()=>({api:globalThis[${JSON.stringify(key)}].api});`,
    '../utils/queue-session-writes': `export const {enqueueQueueSessionWrite}=globalThis[${JSON.stringify(key)}].writes;`
  });
  const mounts = [];
  t.after(() => { for (const current of mounts) current.unmount(); stop(client); client.clear(); delete globalThis[key]; });
  return { client, env, mount() {
    const current = { cursor: 0, slots: [], effects: [], pending: [],
      render(id) {
        instance = current; current.cursor = 0;
        current.value = module.useQueueSession({ ids: [1, 2, 3], manualIds: [1, 2, 3], sourceIds: [1, 2, 3], selectedId: id, shuffled: false }, 7);
        current.pending.splice(0).forEach(run => run());
        return current.value;
      },
      unmount() { for (const effect of current.effects) { effect?.cleanup?.(); if (effect) effect.cleanup = undefined; } }
    };
    mounts.push(current); return current;
  } };
}

test('actual hook preserves queued last selection on Home navigation and orders remount/delete', async t => {
  const first = deferred(), deletion = deferred(), calls = [];
  let stored, firstSave = true;
  const env = await hookEnvironment(t, {
    saveQueueSession: async value => { calls.push('save ' + value.state.selectedId); if (firstSave) { firstSave = false; await first.promise; } stored = value; },
    deleteQueueSession: async () => { calls.push('delete'); await deletion.promise; stored = undefined; }
  });
  const old = env.mount(); old.render(1); old.render(2); old.unmount();
  await settle(); assert.deepEqual(calls, ['save 1']);
  first.resolve(); await drain(env.client, 'playlist-7'); assert.equal(stored.state.selectedId, 2);
  const resumed = env.mount(); const session = resumed.render(3); session.complete(); session.complete(); resumed.unmount();
  const restarted = env.mount(); restarted.render(1);
  await settle(); assert.deepEqual(calls, ['save 1', 'save 2', 'save 3', 'delete']);
  deletion.resolve(); await drain(env.client, 'playlist-7'); assert.equal(stored.state.selectedId, 1);
  session.complete(); await settle(); assert.equal(calls.filter(call => call === 'delete').length, 1, 'unmounted callbacks cannot delete a restarted session');
});

test('actual hook invalidates detail without fetching an active completed session', async t => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let completed = false, detailGets = 0;
  const options = { queryKey: ['queue-session', 'playlist-7'], staleTime: Infinity, queryFn: async () => {
    detailGets++; if (completed) throw Error('404'); return { state: { selectedId: 1 }, items: [{ id: 1 }] };
  } };
  await client.fetchQuery(options);
  const observer = new QueryObserver(client, options), unsubscribe = observer.subscribe(() => {});
  t.after(() => { unsubscribe(); observer.destroy(); });
  const env = await hookEnvironment(t, { saveQueueSession: async () => {}, deleteQueueSession: async () => { completed = true; } }, client);
  const current = env.mount(), session = current.render(1);
  await drain(client, 'playlist-7'); await settle();
  assert.equal(client.getQueryState(options.queryKey).isInvalidated, true);
  session.complete(); await drain(client, 'playlist-7'); await settle();
  assert.equal(detailGets, 1); assert.equal(client.getQueryState(options.queryKey).status, 'success');
  assert.equal(client.getQueryState(options.queryKey).isInvalidated, true);
  assert.deepEqual(client.getQueryData(options.queryKey).items, [{ id: 1 }], 'never create a partial detail object');
  assert.equal(env.client, client);
});
