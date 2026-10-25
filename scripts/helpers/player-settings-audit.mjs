import { join } from 'node:path';
import { openPlaybackSetting } from './playback-settings.mjs';

export async function auditPlayerSettings(page, label, check, artifacts) {
  const player = page.locator('.player:not(.short-player)');
  const video = player.locator('video');
  await player.focus();
  const toolbar = player.locator('.player-toolbar');
  const geometry = await toolbar.locator('.player-transport').boundingBox();
  check(geometry.height <= 52, label + ' normal transport stays on one row');
  check(await page.locator('.watch-back').count() === 0, label + ' no redundant video back button');
  check(await toolbar.locator('[data-setting="quality"],[data-setting="audio"],[data-setting="subtitles"],[data-setting="video"]').count() === 0,
    label + ' playback preferences share one More button');
  const root = page.getByRole('menu', { name: 'Settings', exact: true });
  const gear = page.getByRole('button', { name: 'Playback settings', exact: true });
  await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menuitemradio', { name: /^Original Quality/ }).click();
  await openPlaybackSetting(page, 'Repeat');
  await page.getByRole('menuitemradio', { name: 'Repeat video', exact: true }).click();
  check(await video.evaluate(element => element.loop), label + ' repeat is available inside Settings');
  await openPlaybackSetting(page, 'Subtitles');
  check(await page.getByRole('menuitemradio', { name: 'Off', exact: true }).count() === 1, label + ' captions are available inside Settings');
  await page.keyboard.press('Escape');
  await root.waitFor();
  check(await root.getByRole('menuitem', { name: 'Subtitles', exact: true }).evaluate(element => element === document.activeElement),
    label + ' submenu Back restores its parent row');
  const audioRow = root.getByRole('menuitem', { name: 'Audio', exact: true });
  check(await audioRow.count() === 1, label + ' audio tracks are available inside Settings');
  await audioRow.click();
  check(await page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio').count() === 2, label + ' audio track choices are retained');
  await page.keyboard.press('Escape');
  await root.getByRole('menuitem', { name: 'Picture', exact: true }).click();
  const picture = page.getByRole('dialog', { name: 'Picture', exact: true });
  await picture.waitFor();
  const before = await video.evaluate(element => {
    window.__settingsLoads = 0;
    element.addEventListener('loadstart', () => window.__settingsLoads++);
    return element.currentSrc;
  });
  const box = await picture.boundingBox(), viewport = page.viewportSize();
  check(box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7,
    label + ' picture controls fit the viewport');
  await picture.getByRole('button', { name: 'Fill', exact: true }).click();
  check(await video.evaluate(element => getComputedStyle(element).objectFit) === 'cover', label + ' Fill retains its behavior');
  for (const angle of [90, 180, 270, 0]) {
    await picture.getByRole('button', { name: 'Rotate clockwise', exact: true }).click();
    check(await picture.getByRole('status', { name: 'Rotation', exact: true }).textContent() === angle + '°', label + ' rotation ' + angle);
  }
  const brightness = picture.getByRole('slider', { name: 'Brightness', exact: true });
  for (const [name, value] of [['Brightness', 120], ['Contrast', 90], ['Saturation', 75]]) {
    await picture.getByRole('slider', { name, exact: true }).evaluate((input, value) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  }
  await brightness.focus(); await page.keyboard.press('ArrowLeft');
  check(await brightness.inputValue() === '119', label + ' slider arrow keys do not navigate the menu');
  await picture.getByRole('button', { name: 'Reset adjustments', exact: true }).click();
  await page.waitForFunction(() => {
    const video=document.querySelector('.player:not(.short-player) video');
    return video&&getComputedStyle(video).filter==='none'&&getComputedStyle(video).objectFit==='contain';
  });
  check(await video.evaluate(element => getComputedStyle(element).filter) === 'none'
    && await video.evaluate(element => getComputedStyle(element).objectFit) === 'contain', label + ' picture reset restores the original view');
  check(await video.evaluate(element => element.currentSrc) === before && await page.evaluate(() => window.__settingsLoads) === 0,
    label + ' presentation changes do not reload the video');
  if (artifacts) await page.screenshot({ path: join(artifacts, label.replace(/ /g, '-') + '-settings.png') });
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await gear.focus(); await page.keyboard.press('Enter');
  await root.waitFor();
  check(await root.getAttribute('data-animate') === 'false', label + ' keyboard Settings opens without animation');
  await page.keyboard.press('Escape');
  await player.click({ button: 'right' });
  await page.getByRole('menu', { name: 'Video actions' }).getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await root.waitFor();
  check(await page.getByRole('menu', { name: 'Video actions' }).count() === 0, label + ' context Settings uses the same anchored menu');
  await page.keyboard.press('Escape');
  if (viewport.width >= 1000) {
    await player.getByRole('button', { name: 'Fullscreen', exact: true }).click();
    await page.waitForFunction(() => Boolean(document.fullscreenElement));
    await openPlaybackSetting(page, 'Picture');
    check(await picture.evaluate(element => document.fullscreenElement.contains(element)), label + ' settings remain inside fullscreen');
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await page.evaluate(() => document.exitFullscreen());
  }
  await openPlaybackSetting(page, 'Repeat');
  await page.getByRole('menuitemradio', { name: 'Repeat off', exact: true }).click();
}
