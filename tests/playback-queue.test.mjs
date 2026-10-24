import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../web/src/utils/playback-queue.ts', import.meta.url), 'utf8');
const { createQueue, reconcileQueue, moveQueueItem, playQueueItemNext, removeQueueItem, clearUpcoming, toggleQueueShuffle, resetQueue, undoQueueEdit } =
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('queue IDs are unique and selection falls back to an available video', () => {
  const state = createQueue([1, 2, 2, 3], 99);
  assert.deepEqual(state.ids, [1, 2, 3]); assert.equal(state.selectedId, 1);
  assert.equal(state.undo, null);
  assert.deepEqual(createQueue([], 1).ids, []);
});
test('drag reorder preserves current video and input arrays', () => {
  const state = createQueue([1, 2, 3, 4], 2);
  const next = moveQueueItem(state, 2, 3);
  assert.deepEqual(next.ids, [1, 3, 4, 2]); assert.equal(next.selectedId, 2);
  assert.deepEqual(state.ids, [1, 2, 3, 4]);
  for (const [id, position] of [[99, 1], [1, -1], [1, 5], [1, .5], [1, 0]]) assert.equal(moveQueueItem(state, id, position), state);
});
test('play next handles videos before and after the current position', () => {
  const state = createQueue([1, 2, 3, 4], 3);
  assert.deepEqual(playQueueItemNext(state, 1).ids, [2, 3, 1, 4]);
  assert.equal(playQueueItemNext(state, 4), state);
  assert.equal(playQueueItemNext(state, 3), state);
});
test('removal edits only the queue and current removal advances predictably', () => {
  const state = createQueue([1, 2, 3, 4], 2);
  const removed = removeQueueItem(state, 2);
  assert.deepEqual(removed.ids, [1, 3, 4]); assert.equal(removed.selectedId, 3);
  assert.deepEqual(removed.sourceIds, [1, 2, 3, 4]);
  assert.equal(removeQueueItem(createQueue([1, 2], 2), 2).selectedId, 1);
  const last = createQueue([1], 1); assert.equal(removeQueueItem(last, 1), last);
  assert.equal(removeQueueItem(state, 99), state);
});
test('clear upcoming keeps history and now playing; reset restores exclusions', () => {
  const state = createQueue([1, 2, 3, 4], 2);
  const cleared = clearUpcoming(state);
  assert.deepEqual(cleared.ids, [1, 2]); assert.equal(cleared.selectedId, 2);
  assert.equal(clearUpcoming(cleared), cleared);
  assert.deepEqual(resetQueue(cleared).ids, state.ids);
});
test('shuffle keeps playback and restores custom order when switched off', () => {
  const state = moveQueueItem(createQueue([1, 2, 3, 4, 5], 3), 5, 0);
  const shuffled = toggleQueueShuffle(state, () => 0);
  assert.equal(shuffled.ids[0], 3); assert.equal(shuffled.selectedId, 3); assert.equal(shuffled.shuffled, true);
  assert.deepEqual(new Set(shuffled.ids), new Set(state.ids));
  assert.deepEqual(toggleQueueShuffle(shuffled).ids, state.ids);
  const edited = moveQueueItem(shuffled, 3, 2);
  assert.equal(edited.shuffled, false); assert.deepEqual(edited.manualIds, edited.ids);
  const removed = removeQueueItem(shuffled, 2);
  assert.ok(!toggleQueueShuffle(removed).ids.includes(2));
});
test('undo does not jump away from a newly selected video', () => {
  const original = createQueue([1, 2, 3, 4], 2);
  const edited = { ...removeQueueItem(original, 4), selectedId: 3 };
  const undone = undoQueueEdit(edited);
  assert.deepEqual(undone.ids, original.ids); assert.equal(undone.selectedId, 3); assert.equal(undone.undo, null);
  assert.equal(undoQueueEdit(original), original);
});
test('refetches preserve edits, append new videos, and prune inaccessible IDs from undo', () => {
  const original = createQueue([1, 2, 3, 4], 2);
  assert.equal(reconcileQueue(original, [1, 2, 3, 4]), original);
  const edited = removeQueueItem(moveQueueItem(original, 4, 0), 3);
  const next = reconcileQueue(edited, [1, 2, 4, 5]);
  assert.deepEqual(next.ids, [4, 1, 2, 5]); assert.equal(next.selectedId, 2);
  assert.ok(!undoQueueEdit(next).ids.includes(3));
  const vanished = reconcileQueue(next, [1, 4, 5]);
  assert.equal(vanished.selectedId, 5); assert.ok(!undoQueueEdit(vanished).ids.includes(2));
});
test('an initially randomized queue contains every video exactly once', () => {
  const state = createQueue(Array.from({ length: 750 }, (_, i) => i + 1), 650, true);
  assert.equal(state.ids.length, 750); assert.equal(new Set(state.ids).size, 750);
  assert.equal(state.ids[0], 650); assert.equal(state.shuffled, true); assert.equal(state.undo, null);
});
test('long edit sequences keep queue and manual membership consistent', () => {
  let state = createQueue(Array.from({ length: 50 }, (_, i) => i + 1), 20);
  for (let i = 0; i < 100; i++) {
    const id = state.ids[i % state.ids.length];
    switch (i % 7) {
      case 0: state = toggleQueueShuffle(state, () => .3); break;
      case 1: state = moveQueueItem(state, id, state.ids.length - 1); break;
      case 2: state = removeQueueItem(state, id); break;
      case 3: state = undoQueueEdit(state); break;
      case 4: state = playQueueItemNext(state, id); break;
      case 5: state = clearUpcoming(state); break;
      case 6: state = resetQueue(state); break;
    }
    assert.ok(state.ids.includes(state.selectedId));
    assert.equal(state.ids.length, new Set(state.ids).size);
    assert.deepEqual(new Set(state.ids), new Set(state.manualIds));
  }
});
test('queue scroll does not fight CSS snapping; layouts and edits stay client-side', async () => {
  const css = await readFile(new URL('../web/src/playback-queue.css', import.meta.url), 'utf8');
  assert.match(css, /scroll-snap-type:none/); assert.match(css, /touch-action:none/);
  assert.match(css, /min-width:1200px/); assert.match(css, /prefers-reduced-motion/);
  const watch = await readFile(new URL('../web/src/views/WatchView.tsx', import.meta.url), 'utf8');
  assert.match(watch, /loadMediaQueue/); assert.match(watch, /sort === 'random' \? 'title'/);
  assert.doesNotMatch(watch, /limit:500|deleteMedia|removeLibrary/);
  const queue = await readFile(new URL('../web/src/components/PlaybackQueue.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(queue, /api\.(remove|delete|save|set)/);
  assert.match(queue, /\[currentId, layout\]/);
});
