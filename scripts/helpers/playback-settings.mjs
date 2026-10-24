// Open a player preference in either the toolbar Settings menu or the direct Shorts controls.
export async function openPlaybackSetting(page, label) {
  const direct = page.getByRole('button', { name: label, exact: true });
  if (await direct.count()) { await direct.click(); return; }
  const root = page.getByRole('menu', { name: 'Settings', exact: true });
  if (!(await root.isVisible())) {
    const back = page.getByRole('button', { name: 'Back to playback settings', exact: true });
    if (await back.isVisible()) await back.click();
    else await page.getByRole('button', { name: 'Playback settings', exact: true }).click();
  }
  await root.getByRole('menuitem', { name: label, exact: true }).click();
}
