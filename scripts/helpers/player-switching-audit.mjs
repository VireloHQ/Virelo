import assert from 'node:assert/strict';
import { openPlaybackSetting } from './playback-settings.mjs';

async function audioFrequency(page) {
  return page.evaluate(async () => {
    const audio = document.querySelector('.player audio'), video = document.querySelector('.player:not(.short-player) video');
    const media = audio.hasAttribute('src') || !audio.paused ? audio : video;
    const context = new AudioContext(), source = context.createMediaStreamSource(media.captureStream()), analyser = context.createAnalyser();
    try {
      analyser.fftSize = 4096; source.connect(analyser); await context.resume();
      await new Promise(resolve => setTimeout(resolve, 250));
      const bins = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(bins);
      let peak = 0;
      for (let i = Math.floor(200 * analyser.fftSize / context.sampleRate); i < Math.ceil(1000 * analyser.fftSize / context.sampleRate); i++)
        if (bins[i] > (bins[peak] ?? -Infinity)) peak = i;
      return peak * context.sampleRate / analyser.fftSize;
    } finally { await context.close(); }
  });
}

export async function auditPlayerSwitching(page, label, check) {
  const video = page.locator('.player:not(.short-player) video');
  await video.evaluate(element => { element.pause(); element.currentTime = 1; });
  await page.waitForFunction(() => { const video = document.querySelector('.player:not(.short-player) video'); return video.paused && !video.seeking; });
  const qualityStart = Date.now();
  await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menuitemradio', { name: /^480p/ }).click();
  await page.waitForFunction(npm => {
    const video = document.querySelector('.player:not(.short-player) video');
    return video.readyState >= 2 && !video.seeking && (npm ? Math.min(video.videoWidth, video.videoHeight) : video.videoHeight) === 480;
  }, label.startsWith('npm '), { timeout: 30000 });
  check(await video.evaluate(element => element.paused), label + ' quality switching preserves manual pause');
  const before = await video.evaluate(element => {
    window.__switchLoads = 0; element.addEventListener('loadstart', () => window.__switchLoads++);
    return { source: element.currentSrc, time: element.currentTime, qualityRequests: window.__switchRequests.filter(request=>request.url.includes('/quality/start')).length };
  });
  const audioStart = Date.now();
  await openPlaybackSetting(page, 'Audio');
  const choices = page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio');
  await choices.nth(1).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('.player audio'), video = document.querySelector('.player:not(.short-player) video');
    return audio && audio.currentSrc && audio.readyState >= 2 && Math.abs(audio.currentTime - video.currentTime) < .5;
  }, undefined, { timeout: 30000 }).catch(async error => {
    console.error('AUDIO_SWITCH', label, await page.locator('.player audio').evaluate(audio => ({ source: audio.currentSrc, time: audio.currentTime, ready: audio.readyState, paused: audio.paused, error: audio.error?.message, buffered: Array.from({length:audio.buffered.length},(_,i)=>[audio.buffered.start(i),audio.buffered.end(i)]) })));
    throw error;
  });
  check(await video.evaluate(element => element.paused) && await page.locator('.player audio').evaluate(element => element.paused),
    label + ' audio switching preserves manual pause');
  check(await video.evaluate((element, source) => element.currentSrc === source, before.source)
    && await page.evaluate(() => window.__switchLoads === 0), label + ' audio-only change does not reload or re-encode the video');
  check(Math.abs(await video.evaluate(element => element.currentTime) - before.time) < .4, label + ' audio-only change keeps the playback position');
  check(await page.evaluate(()=>window.__switchRequests.filter(request=>request.url.includes('/quality/start')).length)===before.qualityRequests, label + ' audio-only change sends no video conversion request');
  console.log('SWITCH_TIMING', JSON.stringify({ label, qualityMs: audioStart - qualityStart, audioMs: Date.now() - audioStart }));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('.player:not(.short-player) video'), audio = document.querySelector('.player audio');
    return !video.paused && !audio.paused && Math.abs(video.currentTime - audio.currentTime) < .5;
  });
  check(true, label + ' converted audio and video resume in sync');
  await video.evaluate(element => { element.pause(); element.currentTime = 28; });
  await page.waitForFunction(() => {
    const video = document.querySelector('.player:not(.short-player) video');
    return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 28) < .4;
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player:not(.short-player) video').paused);
  check(Math.abs(await audioFrequency(page) - 660) < 35, label + ' forward seek retains the actual selected alternate audio');
  await video.evaluate(element => element.pause());
  await openPlaybackSetting(page, 'Audio');
  await page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio').first().click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('.player audio'), video = document.querySelector('.player:not(.short-player) video');
    return audio.readyState >= 2 && !audio.seeking && Math.abs(audio.currentTime - video.currentTime) < .5;
  });
  await video.evaluate(element => { element.currentTime = 2; });
  await page.waitForFunction(() => {
    const video = document.querySelector('.player:not(.short-player) video');
    return video.readyState >= 2 && !video.seeking && Math.abs(video.currentTime - 2) < .4;
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.player:not(.short-player) video').paused);
  check(Math.abs(await audioFrequency(page) - 440) < 35, label + ' backward seek uses the latest selected audio rather than a stale conversion');
  await video.evaluate(element => element.pause());
  await openPlaybackSetting(page, 'Audio');
  await page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio').nth(1).click();
  await page.waitForFunction(() => {
    const audio = document.querySelector('.player audio'), video = document.querySelector('.player:not(.short-player) video');
    return audio.readyState >= 2 && !audio.seeking && Math.abs(audio.currentTime - video.currentTime) < .5;
  });
  await video.evaluate(element => { element.pause(); element.currentTime = 5; });
  await openPlaybackSetting(page, 'Quality');
  await page.getByRole('menuitemradio', { name: /^Original Quality/ }).click();
  await page.waitForFunction(() => {
    const video = document.querySelector('.player:not(.short-player) video'), audio = document.querySelector('.player audio');
    return video.videoHeight === 960 && video.readyState >= 2 && audio?.readyState >= 2 && Math.abs(video.currentTime - audio.currentTime) < .5;
  });
  check(await video.evaluate(element => element.paused && Math.abs(element.currentTime - 5) < .5), label + ' returning to Original keeps selected audio, position and pause');
  await openPlaybackSetting(page, 'Audio');
  await page.getByRole('menu', { name: 'Audio', exact: true }).getByRole('menuitemradio').first().click();
  await page.waitForFunction(() => {const audio=document.querySelector('.player audio');return !audio.hasAttribute('src')&&audio.networkState===HTMLMediaElement.NETWORK_EMPTY;}).catch(async error => {
    console.error('DEFAULT_AUDIO', label, await page.locator('.player audio').evaluate(audio => ({src:audio.getAttribute('src'),currentSrc:audio.currentSrc,ready:audio.readyState,network:audio.networkState,time:audio.currentTime})), await page.evaluate(()=>window.__switchRequests));
    throw error;
  });
  assert.ok(await video.evaluate(element => element.readyState >= 2));
  check(true, label + ' default audio returns to the original source without reloading it');
}
