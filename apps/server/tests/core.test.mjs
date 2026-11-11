import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { parseMediaName, scanLibrary } from '../dist/scanner.js';
import { playbackQualities } from '../dist/ffmpeg.js';

test('parses movie and episode names', () => {
  assert.deepEqual(parseMediaName('/Movies/Blade.Runner.1982.1080p.mkv'), {
    title: 'Blade Runner', kind: 'movie', seriesTitle: null, season: null, episode: null, year: 1982
  });
  const episode = parseMediaName('/Shows/Example Show/Season 01/Example.Show.S01E03.2026.mkv');
  assert.equal(episode.kind, 'series');
  assert.equal(episode.seriesTitle, 'Example Show');
  assert.equal(episode.season, 1);
  assert.equal(episode.episode, 3);
  assert.equal(episode.year, 2026);
});

test('builds an adaptive quality ladder without upscaling the source', () => {
  assert.deepEqual(playbackQualities(1920, 1080).map((quality) => quality.label), ['1080p', '720p', '480p', '360p']);
  assert.deepEqual(playbackQualities(3840, 2160).map((quality) => quality.label), ['4K', '1440p', '1080p', '720p', '480p', '360p']);
  assert.deepEqual(playbackQualities(1080, 1920).map((quality) => quality.label), ['1080p', '720p', '480p', '360p']);
  assert.deepEqual(playbackQualities(640, 360).map((quality) => quality.label), ['360p']);
});

test('persists local library and watch progress in sqlite', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-test-'));
  try {
    await Promise.all(['thumbnails','artwork','cache'].map((name) => mkdir(join(dir, name), { recursive: true })));
    const db = new VireloDB(dir);
    await access(join(dir, 'virelo.db'));
    const library = db.addLibrary('/tmp/media', 'Media');
    const item = db.upsertMedia({
      library_id: library.id,
      path: '/tmp/media/test.mp4', filename: 'test.mp4', title: 'Test', sort_title: 'test', kind: 'movie',
      series_title: null, season: null, episode: null, year: null, duration: 100, width: 1920, height: 1080,
      video_codec: 'h264', audio_codec: 'aac', container: 'mp4', folder: '', size: 123, mtime: 456,
      thumbnail_path: null, poster_path: null, backdrop_path: null, overview: null, genres: null, external_id: null
    });
    db.setProgress(item.id, 42, 100);
    const loaded = db.getMedia(item.id);
    assert.equal(loaded?.progress_position, 42);
    assert.equal(loaded?.progress_completed, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('moves unchanged media into a more specific library when it is rescanned there', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'virelo-library-move-'));
  const mediaRoot = join(dir, 'media');
  const showRoot = join(mediaRoot, 'Show');
  try {
    await Promise.all([join(dir,'thumbnails'),join(dir,'artwork'),join(dir,'cache'),showRoot].map((path) => mkdir(path, { recursive: true })));
    const videoPath = join(showRoot, 'Example.S01E01.mp4');
    await writeFile(videoPath, 'not-a-real-video');
    const db = new VireloDB(dir);
    const parent = db.addLibrary(mediaRoot, 'Media');
    const status = () => ({ running:true,startedAt:null,finishedAt:null,total:0,scanned:0,added:0,updated:0,skipped:0,errors:0,message:'' });
    await scanLibrary(db, parent, dir, status());
    assert.equal(db.getMediaByPath(videoPath)?.library_id, parent.id);
    const child = db.addLibrary(showRoot, 'Show');
    await scanLibrary(db, child, dir, status());
    assert.equal(db.getMediaByPath(videoPath)?.library_id, child.id);
    await scanLibrary(db, parent, dir, status());
    assert.equal(db.getMediaByPath(videoPath)?.library_id, child.id,'a parent rescan cannot expose a nested library');
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
