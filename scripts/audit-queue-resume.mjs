// Runs against the real edition adapters using the playlist audit's isolated libraries.
export async function auditQueueResume(page, mode, base, prefix, playlistId, label, check) {
  const stored = async (key, selectedId) => page.waitForFunction(async ({ mode, key, selectedId }) => {
    const api = mode === 'web' ? (await import('/src/api.ts')).api : null;
    const rows = api ? await api.queueSessions() : await (await fetch('/api/queue-sessions')).json();
    return rows.some(row => (key ? row.key === key : row.key.startsWith('queue-')) && row.item.id === selectedId);
  }, { mode, key, selectedId });
  const ids = () => page.locator('.playback-queue-tile').evaluateAll(rows => rows.map(row => Number(row.dataset.queueId)));
  const selected = id => page.locator('[data-queue-id="' + id + '"] .playback-queue-item[aria-current="true"]').waitFor();
  const play = async id => { await page.locator('[data-queue-id="' + id + '"] .playback-queue-item').click(); await selected(id); };
  const roundTrip = async (key, current, order) => {
    await stored(key, current);
    await page.getByRole('link', { name: 'Home', exact: true }).first().click();
    const row = page.getByRole('region', { name: 'Continue watching titles', exact: true });
    const link = row.locator('.media-card-link[href*="resumeSession=' + key + '"]');
    await link.waitFor();
    check(await link.textContent().then(text => /Queue|Playlist/.test(text)), label + ' Continue watching distinguishes queue and playlist resumes');
    await link.click(); await selected(current);
    check(JSON.stringify(await ids()) === JSON.stringify(order), label + ' Continue watching restores the saved queue order and selection');
    await page.reload(); await selected(current);
    check(JSON.stringify(await ids()) === JSON.stringify(order), label + ' queue context survives a full page reload');
  };

  await page.goto(base + prefix + '/watch/1?queue=true');
  await play(3);
  await page.getByRole('button', { name: 'Options for Clip 4', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Remove from queue', exact: true }).click();
  await page.locator('.playback-queue').getByRole('button', { name: 'Shuffle queue', exact: true }).click();
  await stored(null, 3);
  const key = await page.evaluate(async mode => {
    const rows = mode === 'web' ? await (await import('/src/api.ts')).api.queueSessions() : await (await fetch('/api/queue-sessions')).json();
    return rows.find(row => row.key.startsWith('queue-') && row.item.id === 3).key;
  }, mode);
  const order = await ids();
  await roundTrip(key, 3, order);
  await play(order[1]);
  await roundTrip(key, order[1], order);
  check(await page.locator('.playback-queue').getByRole('button', { name: 'Shuffle queue', exact: true }).getAttribute('aria-pressed') === 'true', label + ' restores shuffle without reintroducing removed videos');
  await play(order.at(-1));
  await page.locator('.player video').evaluate(video => video.dispatchEvent(new Event('ended')));
  await page.waitForFunction(async ({ mode, key }) => {
    const rows = mode === 'web' ? await (await import('/src/api.ts')).api.queueSessions() : await (await fetch('/api/queue-sessions')).json();
    return !rows.some(row => row.key === key);
  }, { mode, key });
  check(true, label + ' finishing the final video removes the completed queue resume');

  await page.goto(base + prefix + '/watch/2?playlistId=' + playlistId);
  await play(1);
  await roundTrip('playlist-' + playlistId, 1, [2, 1, 3]);
  check(await page.locator('.playback-queue h2 a').getAttribute('href') === prefix + '/playlists/' + playlistId, label + ' resumed playlists retain their named playlist link');
  await play(2);
  await roundTrip('playlist-' + playlistId, 2, [2, 1, 3]);
}
