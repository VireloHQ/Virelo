import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearanceTestModule as load } from './appearance-test-loader.mjs';

let serial = 0;
const session = key => ({ key, state: { ids: [1, 2, 3], manualIds: [1, 2, 3], sourceIds: [1, 2, 3], selectedId: 2, shuffled: false }, updatedAt: 1 });
async function environment(t) {
  const key = '__queueSessionTest' + ++serial;
  const state = globalThis[key] = { stored: [], items: [1, 2, 3].map(id => ({ id, title: 'Clip ' + id })), playlists: new Map(), fail: false };
  t.after(() => delete globalThis[key]);
  const { localQueueSession, localQueueSessions, saveLocalQueueSession, deleteLocalQueueSession } = await load('local-queue-sessions.ts', {
    './local-library': `const state=globalThis[${JSON.stringify(key)}];
      export const hydrateMediaIds=async ids=>ids.flatMap(id=>state.items.filter(item=>item.id===id));
      export const openDatabase=async()=>({close(){},transaction(){const tx={objectStore:()=>({
        get(){const request={};queueMicrotask(()=>{if(state.fail){tx.error=new Error('Storage blocked');tx.onabort();return;}
          request.result=structuredClone(state.stored);request.onsuccess();queueMicrotask(()=>tx.oncomplete());});return request;},
        put(value){state.stored=structuredClone(value);}
      })};return tx;}});`,
    './local-playlists': `const state=globalThis[${JSON.stringify(key)}];export const getLocalPlaylist=async id=>{
      const playlist=state.playlists.get(id);if(!playlist)throw new Error('Playlist not found.');return playlist;};`
  });
  return { state, localQueueSession, localQueueSessions, saveLocalQueueSession, deleteLocalQueueSession };
}
test('browser queue sessions persist order, selection, updates and the latest 12 entries', async t => {
  const env = await environment(t);
  await env.saveLocalQueueSession(session('queue-test'));
  assert.deepEqual((await env.localQueueSession('queue-test')).state, session('queue-test').state);
  await env.saveLocalQueueSession({ ...session('queue-test'), state: { ...session('queue-test').state, selectedId: 3 } });
  assert.equal((await env.localQueueSessions())[0].item.id, 3);
  for (let i = 0; i < 14; i++) await env.saveLocalQueueSession(session('queue-' + i));
  assert.equal((await env.localQueueSessions()).length, 12);
  assert.equal((await env.localQueueSessions())[0].key, 'queue-13');
  await env.deleteLocalQueueSession('queue-13');
  await assert.rejects(env.localQueueSession('queue-13'), /Saved queue not found/);
});
test('unavailable current videos choose the same next item on the card and in playback', async t => {
  const env = await environment(t);
  await env.saveLocalQueueSession(session('queue-test'));
  env.state.items = env.state.items.filter(item => item.id !== 2);
  assert.equal((await env.localQueueSessions())[0].item.id, 3);
  assert.equal((await env.localQueueSession('queue-test')).state.selectedId, 3);
  env.state.items = [];
  assert.deepEqual(await env.localQueueSessions(), []);
  await assert.rejects(env.localQueueSession('queue-test'), /Saved queue not found/);
});
test('playlist resume follows current membership and hides deleted playlists', async t => {
  const env = await environment(t);
  env.state.playlists.set(8, { name: 'Evening', items: [{ id: 1 }, { id: 3 }, { id: 4 }] });
  await env.saveLocalQueueSession({ ...session('playlist-8'), playlistId: 8 });
  const detail = await env.localQueueSession('playlist-8');
  assert.equal(detail.state.selectedId, 3); assert.deepEqual(detail.items.map(item => item.id), [1, 3, 4]);
  assert.equal((await env.localQueueSessions())[0].label, 'Evening');
  env.state.playlists.clear(); assert.deepEqual(await env.localQueueSessions(), []);
  await assert.rejects(env.localQueueSession('playlist-8'), /Playlist not found/);
});
test('corrupt storage is skipped and validation/storage failures are reported', async t => {
  const env = await environment(t);
  env.state.stored = [null, {}, session('queue-valid')];
  assert.equal((await env.localQueueSessions()).length, 1);
  await assert.rejects(env.saveLocalQueueSession({ key: '../bad' }), /Invalid saved queue/);
  env.state.fail = true;
  await assert.rejects(env.localQueueSessions(), /Storage blocked/);
  await assert.rejects(env.saveLocalQueueSession(session('queue-test')), /Storage blocked/);
});
