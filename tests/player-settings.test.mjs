import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = path => readFile(new URL('../web/src/' + path, import.meta.url), 'utf8');


test('audio toggles share fixed icon, label and check columns', async () => {
  const menu = await source('components/PlaybackSettingsMenu.tsx');
  assert.match(menu, /className="playback-toggle-row" role="menuitemcheckbox" tabIndex=\{-1\}/);
  assert.match(menu, /aria-checked=\{leveling\}/);
  const css = await source('player-ui.css');
  assert.match(css, /:is\(\.playback-setting-row,\.playback-toggle-row\).*grid-template-columns:20px minmax\(0,1fr\) 16px/);
  assert.match(css, /\.playback-leveling:not\(:last-child\)/);
  assert.doesNotMatch(await source('components/Communication.css'), /playback-leveling/);
});

test('routine controls omit implementation commentary while errors and privacy notices remain', async () => {
  for (const file of ['components/PlaybackSettingsMenu.tsx','components/Player.tsx','components/VideoSettingsPanel.tsx','views/WatchView.tsx','views/PlaylistsView.tsx']) {
    assert.doesNotMatch(await source(file), /No pre-scan|file changes|file stays unchanged|Playback is unchanged|Quality stays unchanged|Original files stay unchanged|cached result will be reused/);
  }
  assert.match(await source('components/PlaybackSettingsMenu.tsx'), /levelingError/);
  assert.match(await source('components/VolumeLevelingSetting.tsx'), /Unavailable in this browser\./);
});

test('the normal player shares one settings entry instead of a row of preference icons', async () => {
  const player = await source('components/Player.tsx');
  assert.match(player, /unified=\{!shorts\}/);
  assert.match(player, /pictureControls=.*VideoSettingsPanel/);
  assert.doesNotMatch(player, /VideoSettingsMenu|RepeatControl/);
  assert.match(player, /<PlayerControls current=\{current\}/);
  const controls = await source('components/PlayerControls.tsx');
  assert.doesNotMatch(controls, /player-title|title: string|\{title\}/);
  assert.match(controls, /assets\/icons\/replay-10\.svg/);
  assert.match(controls, /assets\/icons\/forward-30\.svg/);
  assert.doesNotMatch(controls, /function SeekIcon|<text/);
  assert.match(controls, /aria-label=\{props.pip \? t\(["']Exit Picture in Picture["']\) : t\(["']Picture in Picture["']\)\}/);
  const menu = await source('components/PlaybackSettingsMenu.tsx');
  for (const setting of ['quality', 'audio', 'subtitles', 'video', 'repeat', 'speed']) assert.ok(menu.includes("sectionButton('" + setting + "'"));
  assert.match(menu, /Playback settings/);
  assert.doesNotMatch(menu, /PictureInPicture|onPip/);
  assert.match(menu, /context\?'Settings':'Playback settings'/);
  assert.match(menu, /context-settings-menu/);
  assert.match(menu, /sidePopoverPlacement/);
  assert.doesNotMatch(player, /dispatchEvent\(new MouseEvent\('click'/);
  assert.match(menu, /hidden=\{!open\} inert=\{!open\}/);
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
  const css = await source('player-transport.css');
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /player-transport \{ flex-wrap:nowrap/);
  assert.match(css, /translateY\(12px\)/);
  const menuCss = await source('player-ui.css');
  assert.match(menuCss, /playback-track-list \{ padding:8px/);
  assert.match(menuCss, /playback-menu-page.*transition:opacity/);
});
