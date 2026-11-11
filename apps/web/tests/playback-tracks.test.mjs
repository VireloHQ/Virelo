import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const source = await readFile(new URL('../web/src/utils/playback-tracks.ts', import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let serial = 0;
const fresh = () => import(moduleUrl + '#' + (++serial));
function storage(values = {}) {
  const entries = new Map(Object.entries(values));
  globalThis.window = { localStorage: { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) } };
  return entries;
}
const track = (index, language, overrides = {}) => ({
  index, typeIndex: index, language, title: null, codec: 'aac', channels: 2,
  channelLayout: 'stereo', default: false, forced: false, supported: true, ...overrides
});
const audio = () => [track(1, 'eng'), track(2, 'jpn')];
const subtitles = () => [track(3, 'eng', { codec: 'subrip', channels: null, channelLayout: null }), track(4, 'jpn', { codec: 'subrip', channels: null, channelLayout: null })];

test('unconfigured playback retains the current audio default and subtitle Off', async () => {
  storage(); const p = await fresh();
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 1);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), null), null);
  assert.equal(p.hasPlaybackTrackPreference('audio'), false);
});

test('manual audio and subtitles survive a fresh page without storing stream IDs', async () => {
  const entries = storage(); let p = await fresh();
  assert.ok(p.savePlaybackTrackSelection('audio', audio(), 2));
  assert.ok(p.savePlaybackTrackSelection('subtitles', subtitles(), 4));
  p = await fresh();
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 2);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), null), 4);
  assert.ok(p.hasPlaybackTrackPreference('audio'));
  assert.equal(entries.size, 2);
  assert.ok(!JSON.parse(entries.get('virelo-playback-audio:v1')).selection.includes('index'));
});

test('equivalent language tags and shifted/reordered stream IDs map to the selected language', async () => {
  storage(); const p = await fresh(); p.savePlaybackTrackSelection('audio', audio(), 2);
  const shifted = [track(8, 'ja', { default: true }), track(6, 'en', { typeIndex: 0 })];
  assert.equal(p.resolvePlaybackTrackSelection('audio', shifted, 6), 8);
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio().map(t => ({ ...t, default: !t.default })), 1), 2);
});

test('a different composition uses its default without erasing the previous preference', async () => {
  const entries = storage(); const p = await fresh(); p.savePlaybackTrackSelection('audio', audio(), 2);
  const original = entries.get('virelo-playback-audio:v1');
  for (const changed of [
    [track(0, 'eng')], [track(0, 'eng'), track(1, 'fra')],
    [track(0, 'eng'), track(1, 'jpn'), track(2, 'deu')],
    [track(0, 'eng'), track(1, 'jpn', { codec: 'ac3' })],
    [track(0, 'eng'), track(1, 'jpn', { channels: 6, channelLayout: '5.1' })],
    [track(0, 'eng'), track(1, 'jpn', { title: 'Commentary' })]
  ]) assert.equal(p.resolvePlaybackTrackSelection('audio', changed, 0), 0);
  assert.equal(entries.get('virelo-playback-audio:v1'), original);
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 2);
});

test('audio and subtitle compatibility are checked independently', async () => {
  storage(); const p = await fresh();
  p.savePlaybackTrackSelection('audio', audio(), 2);
  p.savePlaybackTrackSelection('subtitles', subtitles(), 4);
  assert.equal(p.resolvePlaybackTrackSelection('audio', [track(8, 'fra')], 8), 8);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), null), 4);
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 2);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', [], null), null);
});

test('subtitle Off is an explicit persisted choice, not an automatic fallback', async () => {
  storage(); let p = await fresh(); p.savePlaybackTrackSelection('subtitles', subtitles(), null);
  p = await fresh();
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), 3), null);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles().slice(0, 1), 3), 3);
  p.savePlaybackTrackSelection('subtitles', subtitles(), 4);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), null), 4);
});

test('unknown/duplicate and now-unsupported tracks cannot silently restore the wrong stream', async () => {
  storage(); const p = await fresh();
  const ambiguous = [track(1, null), track(2, 'und')];
  p.savePlaybackTrackSelection('audio', ambiguous, 2);
  assert.equal(p.resolvePlaybackTrackSelection('audio', ambiguous, 1), 1);
  p.savePlaybackTrackSelection('audio', audio(), 2);
  assert.equal(p.resolvePlaybackTrackSelection('audio', [track(1, 'eng'), track(2, 'jpn', { supported: false })], 1), 1);
});

test('subtitle title and forced/full roles are not interchangeable', async () => {
  storage(); const p = await fresh();
  const tracks = [track(3, 'eng', { codec: 'subrip', title: 'Full' }), track(4, 'eng', { codec: 'subrip', title: 'Signs', forced: true })];
  p.savePlaybackTrackSelection('subtitles', tracks, 4);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', tracks.map(t => ({ ...t, index: t.index + 10 })), null), 14);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', tracks.map(t => ({ ...t, forced: false })), null), null);
});

test('invalid user selections do not clobber a valid preference', async () => {
  const entries = storage(); const p = await fresh(); p.savePlaybackTrackSelection('audio', audio(), 2);
  const saved = entries.get('virelo-playback-audio:v1');
  for (const value of [null, -1, 1.5, Infinity, 999]) assert.equal(p.savePlaybackTrackSelection('audio', audio(), value), false);
  assert.equal(p.savePlaybackTrackSelection('audio', [track(2, 'jpn', { supported: false })], 2), false);
  assert.equal(entries.get('virelo-playback-audio:v1'), saved);
});

test('malformed stored preferences safely fall back', async () => {
  for (const value of ['broken', 'null', '[]', '{}', '{"configuration":"x"}', '{"configuration":"x","selection":23}', '{"configuration":"x","selection":null}']) {
    storage({ 'virelo-playback-audio:v1': value }); const p = await fresh();
    assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 1);
  }
});

test('blocked reads/writes retain choices for the current tab', async () => {
  globalThis.window = { localStorage: { getItem() { throw Error('blocked'); }, setItem() { throw Error('full'); } } };
  const p = await fresh();
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 1);
  p.savePlaybackTrackSelection('audio', audio(), 2);
  p.savePlaybackTrackSelection('subtitles', subtitles(), 4);
  assert.equal(p.resolvePlaybackTrackSelection('audio', audio(), 1), 2);
  assert.equal(p.resolvePlaybackTrackSelection('subtitles', subtitles(), null), 4);
});
