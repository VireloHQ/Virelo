import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = path => readFile(new URL('../web/src/' + path, import.meta.url), 'utf8');

test('the normal player shares one settings entry instead of a row of preference icons', async () => {
  const player = await source('components/Player.tsx');
  assert.match(player, /unified=\{!shorts\}/);
  assert.match(player, /pictureControls=.*VideoSettingsPanel/);
  assert.doesNotMatch(player, /VideoSettingsMenu|RepeatControl/);
  const tools = player.slice(player.indexOf('<div className="player-tools">'), player.indexOf('{contextPosition'));
  assert.doesNotMatch(tools, /PictureInPicture/);
  const menu = await source('components/PlaybackSettingsMenu.tsx');
  for (const setting of ['quality', 'audio', 'subtitles', 'video', 'repeat']) assert.ok(menu.includes("sectionButton('" + setting + "'"));
  assert.match(menu, /Playback settings/);
  assert.match(menu, /Picture in Picture/);
});

test('Shorts audio and subtitle controls retain visible names', async () => {
  const menu = await source('components/PlaybackSettingsMenu.tsx');
  assert.match(menu, /playback-setting-label">\{label\}/);
  assert.match(menu, /settingButton\('audio','Audio'/);
  assert.match(menu, /settingButton\('subtitles','Subtitles'/);
});

test('watching starts without a back button or its loading placeholder', async () => {
  assert.doesNotMatch(await source('views/WatchView.tsx'), /watch-back|history.back|ArrowLeft/);
  assert.doesNotMatch(await source('styles.css'), /watch-back/);
  const skeleton = await source('components/PageSkeleton.tsx');
  assert.doesNotMatch(skeleton, /loading-watch-layout"><div className="skeleton loading-label"/);
});

test('menu navigation preserves range controls and picture changes have no separate popup lifecycle', async () => {
  const menu = await source('components/PlaybackSettingsMenu.tsx');
  assert.match(menu, /Back to playback settings/);
  assert.match(menu, /event.target instanceof HTMLInputElement/);
  assert.match(menu, /if\(open==='video'\|\|/);
  const panel = await source('components/VideoSettingsPanel.tsx');
  assert.doesNotMatch(panel, /createPortal|useEffect|setOpen/);
  assert.match(panel, /Reset adjustments/);
  const css = await source('player-ui.css');
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /player-transport \{ flex-wrap:nowrap/);
});
