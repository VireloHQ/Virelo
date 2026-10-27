import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { startDemand, demandSegment, stopDemandPlayback, playbackCacheLimit } from '../dist/demand-playback.js';
import { DemandCache, SEGMENT_MAX_BYTES } from '../dist/demand-cache.js';
import { dataUsage } from '../dist/data-management.js';
import { hasFfmpeg } from '../dist/ffmpeg.js';

test('a burst of queued segments cannot exceed the configured cache budget', { timeout: 10000 }, async t => {
  if (!await hasFfmpeg()) return t.skip('FFmpeg unavailable');
  const root = await mkdtemp(join(tmpdir(), 'virelo-demand-budget-'));
  const spawn = childProcess.spawn, setting = process.env.VIRELO_CACHE_MAX_MB;
  const admission = DemandCache.prototype.reserve ? 'reserve' : 'prune', admit = DemandCache.prototype[admission];
  let finishing = false;
  const ready = [];
  try {
    process.env.VIRELO_CACHE_MAX_MB = '128';
    const source = join(root, 'source.mp4'); await writeFile(source, 'temporary source');
    const state = await startDemand(root, 1, source, { mode: 'compatible', duration: 10 });
    assert.equal(state.status, 'ready');
    let workersStarted, admissions = 0;
    const active = new Promise(resolve => { workersStarted = resolve; });
    DemandCache.prototype[admission] = async function(bytes) {
      try { return await admit.call(this, bytes); }
      finally { if (bytes === 2 * SEGMENT_MAX_BYTES) admissions++; }
    };
    childProcess.spawn = (command, args, options) => {
      if (!args.includes('mpegts')) return spawn(command, args, options);
      const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { queueMicrotask(() => child.emit('close', 1)); return true; };
      const finish = async () => {
        const file = await open(args.at(-1), 'w');
        try { await file.truncate(SEGMENT_MAX_BYTES - 1); } finally { await file.close(); }
        child.emit('close', 0);
      };
      if (finishing) void finish(); else { ready.push(finish); if(ready.length===2)workersStarted(); }
      return child;
    };
    syncBuiltinESMExports();
    const prefix = state.playlist.replace('/index.m3u8', '');
    const results = Promise.allSettled(Array.from({ length: 5 }, (_, index) => demandSegment(root, prefix, `segment-${index}.ts`, new AbortController().signal, 'viewer')));
    // Queued requests must not reserve the disk budget before obtaining a work slot.
    await active; assert.equal(admissions,2); finishing = true; await Promise.all(ready.map(finish => finish()));
    const settled = await results;
    for (const result of settled) if (result.status === 'fulfilled') result.value.release();
    assert.ok(settled.some(result => result.status === 'fulfilled'));
    const limit = playbackCacheLimit(root), usage = await dataUsage(root, limit);
    assert.ok(usage.categories.cache.bytes <= limit, `${settled.filter(result => result.status === 'fulfilled').length} segments retained ${usage.categories.cache.bytes} bytes with a ${limit}-byte budget`);
  } finally {
    childProcess.spawn = spawn; syncBuiltinESMExports();
    DemandCache.prototype[admission] = admit;
    if (setting === undefined) delete process.env.VIRELO_CACHE_MAX_MB; else process.env.VIRELO_CACHE_MAX_MB = setting;
    await stopDemandPlayback(root);
    assert.ok(relative(resolve(tmpdir()), root).startsWith('virelo-demand-budget-'));
    await rm(root, { recursive: true, force: true });
  }
});
