import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../../../packages/core/src/utils/playback-previous.ts', import.meta.url), 'utf8');
const { previousVideoAction, PREVIOUS_RESTART_THRESHOLD_SECONDS } = await import(
  'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64')
);

test('Previous restarts a video after three seconds and skips only after restart', () => {
  assert.equal(PREVIOUS_RESTART_THRESHOLD_SECONDS, 3);
  assert.equal(previousVideoAction(52, true), 'restart');
  assert.equal(previousVideoAction(3, true), 'restart');
  assert.equal(previousVideoAction(0, true), 'previous');
  assert.equal(previousVideoAction(2.99, true), 'previous');
});

test('Previous can restart the first or only video without a preceding item', () => {
  assert.equal(previousVideoAction(15, false), 'restart');
  assert.equal(previousVideoAction(0, false), 'none');
  assert.equal(previousVideoAction(2.99, false), 'none');
  assert.equal(previousVideoAction(Number.NaN, true), 'previous');
  assert.equal(previousVideoAction(Number.POSITIVE_INFINITY, false), 'none');
});

test('the player routes Previous through the shared decision and existing seek handler', async () => {
  const player = await readFile(new URL('../web/src/components/Player.tsx', import.meta.url), 'utf8');
  assert.match(player, /const action=previousVideoAction\(current,Boolean\(onPrev&&canGoPrev\)\)/);
  assert.match(player, /if\(action==='restart'\)seek\(0\)/);
  assert.match(player, /else if\(action==='previous'\)onPrev\?\.\(\)/);
  assert.match(player, /onPrev=\{handlePrevious\}/);
  assert.match(player, /canGoPrev=\{previousVideoAction\(current,Boolean\(onPrev&&canGoPrev\)\)!=='none'\}/);
});
