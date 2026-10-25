import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, stat, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { probeMedia, probePlaybackInfo, hasFfprobe, hasFfmpeg } from '../dist/ffmpeg.js';

test('playback probes share in-flight work and invalidate when the source changes', async t => {
  if (!await hasFfmpeg() || !await hasFfprobe()) return t.skip('FFmpeg and ffprobe are required');
  const root = await mkdtemp(join(tmpdir(), 'virelo-probe-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'clip.mp4');
  const generate = duration => execFileSync(process.env.FFMPEG_PATH || 'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=160x90:r=5', '-t', String(duration), '-c:v', 'libx264', '-preset', 'ultrafast', source], { windowsHide: true });
  generate(1);
  const originalSpawn = childProcess.spawn;
  let probes = 0;
  childProcess.spawn = function(command, args, ...rest) {
    if (args?.includes('-show_streams')) probes++;
    return originalSpawn.call(this, command, args, ...rest);
  };
  syncBuiltinESMExports();
  try {
    const before = await stat(source);
    const [first, parallel] = await Promise.all([probePlaybackInfo(source), probeMedia(source), probePlaybackInfo(source)]);
    assert.equal(probes, 1); assert.equal(first.width, 160); assert.equal(parallel.duration, 1);
    await probePlaybackInfo(source); assert.equal(probes, 1);
    assert.equal((await stat(source)).mtimeMs, before.mtimeMs);
    generate(2); await utimes(source, new Date(), new Date(before.mtimeMs + 2000));
    assert.equal((await probeMedia(source)).duration, 2); assert.equal(probes, 2);
    assert.equal(await probePlaybackInfo(join(root, 'missing.mp4')), null); assert.equal(probes, 2);
  } finally { childProcess.spawn = originalSpawn; syncBuiltinESMExports(); }
});
