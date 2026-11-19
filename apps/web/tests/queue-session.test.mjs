import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const load = async path => import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(await readFile(new URL(path, import.meta.url), 'utf8'))).toString('base64'));
const core = await load('../../../packages/core/src/utils/queue-session.ts');
const server = await load('../../server/src/queue-session-values.ts');
const { reconcileQueue } = await load('../../../packages/core/src/utils/playback-queue.ts');
const session = () => ({ key: 'queue-test', state: { ids: [3, 1], manualIds: [1, 3], sourceIds: [1, 2, 3], selectedId: 3, shuffled: true }, updatedAt: 1 });

for (const [name, { parseQueueSession, restrictQueueSession }] of [['core', core], ['server', server]]) {
  test(name + ': saved queues retain edited order, exclusions, selection and shuffle', () => {
    const value = session(), saved = parseQueueSession(value);
    assert.deepEqual(saved.state, value.state);
    saved.state.ids.push(4);
    assert.deepEqual(value.state.ids, [3, 1], 'never mutate a caller-owned array');
    assert.equal(parseQueueSession({ ...value, key: 'playlist-4', playlistId: 4 }).playlistId, 4);
  });
  test(name + ': reject invalid or unbounded session data at the storage boundary', () => {
    for (const value of [null, [], {}, { ...session(), key: '../private' }, { ...session(), key: 'playlist-4' },
      { ...session(), key: 'playlist-4', playlistId: 5 }, { ...session(), playlistId: -1 }]) assert.throws(() => parseQueueSession(value));
    for (const patch of [{ ids: [] }, { ids: [3, 3] }, { sourceIds: [1] }, { selectedId: 2 }, { manualIds: [3, 2] },
      { manualIds: [3] }, { shuffled: 'yes' }, { ids: ['3', 1] }, { sourceIds: [0, 1, 3] },
      { sourceIds: Array.from({ length: 10001 }, (_, i) => i + 1) }])
      assert.throws(() => parseQueueSession({ ...session(), state: { ...session().state, ...patch } }));
  });
  test(name + ': filter deleted or inaccessible videos without disclosing their IDs', () => {
    const value = parseQueueSession(session());
    assert.equal(restrictQueueSession(value, []), null);
    const filtered = restrictQueueSession(value, [1, 2]);
    assert.deepEqual(filtered.state.ids, [1]); assert.deepEqual(filtered.state.sourceIds, [1, 2]);
    assert.equal(filtered.state.selectedId, 1);
    const restored = reconcileQueue({ ...filtered.state, undo: null, notice: '' }, [1, 2, 4]);
    assert.deepEqual(restored.ids, [1, 4], 'new playlist videos append; deliberately removed videos stay excluded');
    assert.equal(restored.selectedId, 1); assert.equal(restored.shuffled, true);
  });
}

test('server validation mirror stays byte-for-byte in sync with pure core', async () => {
  assert.equal(await readFile(new URL('../../server/src/queue-session-values.ts', import.meta.url), 'utf8'),
    await readFile(new URL('../../../packages/core/src/utils/queue-session.ts', import.meta.url), 'utf8'));
});
