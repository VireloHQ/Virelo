import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Shorts use the normal playback pipeline instead of a separate player', async () => {
  const shorts = await readFile(new URL('../web/src/views/ShortsView.tsx', import.meta.url), 'utf8');
  const player = await readFile(new URL('../web/src/components/Player.tsx', import.meta.url), 'utf8');
  assert.match(shorts, /<Player item=\{item\} autoPlay repeatMode="one" shorts=/);
  assert.match(shorts, /if \(!active\) return <ShortsPreview/);
  assert.doesNotMatch(shorts, /useHlsFallback|startFallback|togglePlay|shorts-back/);
  assert.match(player, /<ShortsPlayerControls[\s\S]*?\{playbackSettings\}/);
  assert.equal((player.match(/<PlaybackSettingsMenu\b/g) || []).length, 1);
  assert.match(player, /<HiddenSubtitleTrack/);
});

test('Shorts retain accessible seeking, favorites, PiP and context actions', async () => {
  const controls = await readFile(new URL('../web/src/components/ShortsPlayerControls.tsx', import.meta.url), 'utf8');
  assert.match(controls, /aria-label="Seek video"/);
  assert.match(controls, /event.shiftKey \? 30 : 5/);
  assert.match(controls, /onPointerUp=.*commitSeek/);
  assert.match(controls, /<FavoriteButton item=\{item\} short/);
  assert.match(controls, /Picture in Picture/);
  assert.match(controls, /<MediaContextMenu/);
  assert.match(controls, /aria-label="Next short"/);
});

test('Shorts have no back overlay or opaque icon discs', async () => {
  const css = await readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /\.shorts-back\b/);
  assert.match(css, /\.short-actions button svg \{[^}]*padding:0;[^}]*border:0;[^}]*background:transparent;/);
});
