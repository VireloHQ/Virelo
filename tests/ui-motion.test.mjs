import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = path => readFile(new URL('../web/src/' + path, import.meta.url), 'utf8');

test('the app loads one shared, restrained motion system after its base styles', async () => {
  const tokens = await source('design-tokens.css');
  const main = await source('main.tsx');
  for (const [name, value] of [['micro', 160], ['short', 200], ['long', 250]]) {
    assert.ok(tokens.includes('--dur-' + name + ': ' + value + 'ms;'));
  }
  assert.ok(main.indexOf("./ui-motion.css") > main.indexOf("./streaming-ui.css"));
  const motion = await source('ui-motion.css');
  assert.match(motion, /@starting-style/);
  assert.doesNotMatch(motion, /transition:all|transition-delay|animation-delay|translateY/);
  assert.match(motion, /@media \(hover:hover\) and \(pointer:fine\)/);
});

test('the splash uses static branding and a single short fade, not delayed text or a slide', async () => {
  const splash = await source('components/SplashScreen.tsx');
  assert.match(splash, /--dur-long/);
  assert.match(splash, /prefers-reduced-motion/);
  assert.doesNotMatch(splash, /setPhase|phase ===|1400|translate|scale/);
  assert.match(splash, /clearTimeout\(finishTimer\)/);
  const css = await source('styles.css');
  assert.match(css, /html \{[^}]*scroll-behavior: auto/);
  assert.doesNotMatch(css, /splashSlideUp|splashNameReveal|@keyframes picker-in|transition:width/);
});

test('closing dropdowns stay visually present but become inert and hidden to assistive tech', async () => {
  const select = await source('components/Select.tsx');
  assert.match(select, /hidden=\{!open\} inert=\{!open\} aria-hidden=\{!open\}/);
  assert.match(select, /event.detail > 0/);
  const motion = await source('ui-motion.css');
  assert.match(motion, /display var\(--dur-short\) allow-discrete/);
  assert.match(motion, /data-animate="false"[^}]*transition:none!important/);
});

test('switch motion transforms a fixed thumb and preserves keyboard and reduced-motion feedback', async () => {
  const motion = await source('ui-motion.css');
  assert.match(motion, /transition:transform var\(--dur-short\) var\(--ease-in-out\)/);
  assert.match(motion, /switch:has\(\[data-focus-visible="true"\]\)[^}]*transition:none/);
  assert.match(motion, /prefers-reduced-motion:reduce/);
  assert.match(motion, /switch__thumb \{ transition-property:background-color!important/);
  assert.match(motion, /:dir\(rtl\)/);
});

test('modal motion reverses CSS transitions instead of restarting exit keyframes', async () => {
  const css = await source('components/ConfirmationDialog.css');
  assert.match(css, /transition:opacity var\(--dur-long\)/);
  assert.match(css, /transform:scale\(\.97\)/);
  assert.match(css, /data-exiting="true"[^}]*transition-duration:var\(--dur-micro\)/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(css, /@keyframes|translateY/);
  assert.match(css, /data-animate="false"[^}]*transition:none/);
  assert.doesNotMatch(css, /:root:has/);
  const dialog = await source('components/ConfirmationDialog.tsx');
  assert.match(dialog, /onPressStart=.*pointerType/);
  assert.equal((dialog.match(/data-animate=\{animate\}/g) || []).length, 2);
  assert.match(dialog, /getAnimations\(\).*playState === 'running'/);
  assert.match(dialog, /else finishClose\(\)/);
});

test('scan progress animates only the fill transform, without changing layout widths', async () => {
  const scan = await source('components/ScanProgress.tsx');
  assert.match(scan, /width: '100%', transform: `scaleX\(/);
  const css = await source('styles.css');
  assert.match(css, /scan-progress-track>span[^}]*transition:transform var\(--dur-short\) linear/);
});

test('caption avoidance uses a reversible translation without delaying subtitle dragging', async () => {
  const css = await source('styles.css');
  assert.match(css, /transition:translate var\(--dur-long\)/);
  assert.match(css, /player-caption\.dragging[^}]*transition:none/);
  assert.doesNotMatch(css, /transition:bottom|will-change:transform,bottom/);
  const player = await source('player-ui.css');
  assert.match(player, /short-player \.player-caption[^}]*translate:0 0/);
});

