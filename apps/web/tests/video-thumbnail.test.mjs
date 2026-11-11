import test from 'node:test';
import assert from 'node:assert/strict';
import { thumbnailTimes } from '../web/src/utils/video-thumbnail.ts';

test('thumbnail candidates skip beyond short black intros without scanning the whole video', () => {
  assert.deepEqual(thumbnailTimes(120), [5, 30, 60, 96]);
  assert.deepEqual(thumbnailTimes(8), [0.8, 2, 4, 6.4]);
});

test('very short clips stay within the video rather than losing their thumbnail', () => {
  for (const duration of [0.01, 0.15, 0.2, 1]) {
    const times = thumbnailTimes(duration);
    assert.ok(times.length > 0);
    assert.ok(times.every(time => time >= 0 && time < duration));
  }
});

test('unknown durations never produce invalid seek positions', () => {
  for (const duration of [0, -1, NaN, Infinity]) assert.deepEqual(thumbnailTimes(duration), [0]);
});
