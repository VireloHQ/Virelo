import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, rename, stat, symlink, utimes, link } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { DemandCache } from '../dist/demand-cache.js';
import { startDemand, demandSegment, stopDemandPlayback } from '../dist/demand-playback.js';
import { hasFfmpeg } from '../dist/ffmpeg.js';

const directoryLink = (target, path) => symlink(target, path, process.platform === 'win32' ? 'junction' : 'dir');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'virelo-media-security-'));
  t.after(async () => {
    await stopDemandPlayback(root);
    assert.ok(relative(resolve(tmpdir()), root).startsWith('virelo-media-security-'));
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('cache hits reject replaced ancestor links without touching external file timestamps', async t => {
  const root = await fixture(t), directory = join(root, 'cache', 'hls'), outside = join(root, 'outside');
  await mkdir(directory, { recursive: true }); await mkdir(outside);
  const path = join(directory, 'segment-0.ts'), original = join(outside, 'segment-0.ts');
  await writeFile(path, 'cached'); await writeFile(original, 'private original');
  await utimes(original, new Date(1000), new Date(1000));
  const before = (await stat(original)).mtimeMs, cache = new DemandCache(root);
  await cache.init(); await rename(directory, directory + '-old'); await directoryLink(outside, directory);
  await assert.rejects(cache.lookup(path), /filesystem links/);
  assert.equal((await stat(original)).mtimeMs, before);
  assert.equal(await readFile(original, 'utf8'), 'private original');
  await assert.rejects(cache.record(path), /filesystem links/);
});

test('failed segment preparation never removes a .part file through a cache junction', async t => {
  if (!await hasFfmpeg()) return t.skip('FFmpeg unavailable');
  const root = await fixture(t), source = join(root, 'source.mp4');
  await writeFile(source, 'temporary source fixture');
  const state = await startDemand(root, 7, source, { mode: 'compatible', duration: 1 });
  assert.equal(state.status, 'ready');
  const prefix = state.playlist.replace('/index.m3u8', ''), stamp = prefix.split('/')[3];
  const outside = join(root, 'outside'), parent = join(outside, '7', stamp, 'compatible', 'default', 'original');
  await mkdir(parent, { recursive: true });
  const original = join(parent, 'segment-0.ts.part'); await writeFile(original, 'do not delete');
  await mkdir(join(root, 'cache'), { recursive: true });
  await directoryLink(outside, join(root, 'cache', 'segments-v2'));
  await assert.rejects(demandSegment(root, prefix, 'segment-0.ts', new AbortController().signal), /filesystem links/);
  assert.equal(await readFile(original, 'utf8'), 'do not delete');
});

test('a pre-existing hard-linked encode target cannot overwrite an original file', async t => {
  if (!await hasFfmpeg()) return t.skip('FFmpeg unavailable');
  const root = await fixture(t), source = join(root, 'source.mp4');
  execFileSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=s=160x90:r=12', '-t', '1', '-c:v', 'libx264', source], { windowsHide: true });
  const state = await startDemand(root, 8, source, { mode: 'compatible', duration: 1 });
  assert.equal(state.status, 'ready');
  const prefix = state.playlist.replace('/index.m3u8', ''), stamp = prefix.split('/')[3];
  const parent = join(root, 'cache', 'segments-v2', '8', stamp, 'compatible', 'default', 'original');
  await mkdir(parent, { recursive: true });
  const original = join(root, 'original.mp4'); await writeFile(original, 'preserve original bytes');
  await link(original, join(parent, 'segment-0.ts.part'));
  let failure;
  try { const segment = await demandSegment(root, prefix, 'segment-0.ts', new AbortController().signal); segment.release(); }
  catch (error) { failure = error; }
  assert.equal(await readFile(original, 'utf8'), 'preserve original bytes');
  assert.match(failure?.message ?? '', /hard links/);
});

test('hard-linked cache hits cannot expose originals or change their timestamps', async t => {
  const root = await fixture(t), directory = join(root, 'cache', 'hls');
  await mkdir(directory, { recursive: true });
  const original = join(root, 'original.mp4'), path = join(directory, 'segment-0.ts');
  await writeFile(original, 'private original'); await link(original, path);
  await utimes(original, new Date(1000), new Date(1000));
  const before = (await stat(original)).mtimeMs, cache = new DemandCache(root);
  await assert.rejects(cache.lookup(path), /hard links/);
  await assert.rejects(cache.record(path), /hard links/);
  assert.equal((await stat(original)).mtimeMs, before);
  assert.equal(await readFile(original, 'utf8'), 'private original');
});

test('cache reservations are atomic, released once, and respected by pruning', async t => {
  const root = await fixture(t), cache = new DemandCache(root, 128);
  const [first, second] = await Promise.all([cache.reserve(64), cache.reserve(64)]);
  await assert.rejects(cache.reserve(1), /cache is busy/);
  await assert.rejects(cache.prune(1), /cache is busy/);
  first(); first();
  const third = await cache.reserve(64);
  await assert.rejects(cache.reserve(1), /cache is busy/);
  second(); third();
  const all = await cache.reserve(128); all();
});

test('a retained overlap guard blocks every cache operation before discovery or file mutation', async t => {
  const root = await fixture(t), directory = join(root, 'cache', 'hls'); await mkdir(directory, { recursive: true });
  const path = join(directory, 'segment-0.ts'); await writeFile(path, 'original bytes');
  const before = (await stat(path)).mtimeMs, cache = new DemandCache(root, 0);
  cache.setSafetyCheck(() => { throw Object.assign(Error('overlapping library'), { statusCode: 409 }); });
  for (const operation of [() => cache.prune(), () => cache.reserve(1), () => cache.lookup(path), () => cache.record(path), () => cache.clearUnused()])
    await assert.rejects(operation(), { statusCode: 409 });
  assert.throws(() => cache.discard(path), { statusCode: 409 });
  assert.equal(cache.bytes, 0, 'blocked operations never scan or adopt original files as cache entries');
  assert.equal(await readFile(path, 'utf8'), 'original bytes'); assert.equal((await stat(path)).mtimeMs, before);
});
