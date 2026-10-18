import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VireloDB } from '../dist/db.js';
import { refreshMetadata } from '../dist/metadata.js';
import { parseMediaName } from '../dist/scanner.js';

test('matches free metadata and replaces generated artwork for an episode', async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-metadata-test-'));
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.VIRELO_TMDB_API_KEY;
  let db;
  try {
    await Promise.all(['thumbnails', 'artwork', 'cache'].map((name) => mkdir(join(root, name), { recursive: true })));
    delete process.env.VIRELO_TMDB_API_KEY;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes('/catalog/series/top/search=')) {
        return Response.json({ metas: [{ id: 'tt0903747', name: 'Breaking Bad', releaseInfo: '2008-2013' }] });
      }
      if (url.endsWith('/meta/series/tt0903747.json')) {
        return Response.json({ meta: {
          id: 'tt0903747',
          name: 'Breaking Bad',
          description: 'Series description',
          genres: ['Crime', 'Drama'],
          poster: 'https://images.example/poster.jpg',
          background: 'https://images.example/background.jpg',
          videos: [{ season: 1, episode: 1, name: 'Pilot', overview: 'Episode description', firstAired: '2008-01-20', thumbnail: 'https://images.example/episode.jpg' }]
        } });
      }
      if (url.startsWith('https://images.example/')) {
        return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4nUAAAAASUVORK5CYII=','base64'), { headers: { 'content-type': 'image/png' } });
      }
      throw new Error(`Unexpected request: ${url}`);
    };

    db = new VireloDB(root);
    const library = db.addLibrary(process.cwd(), 'Test');
    const media = db.upsertMedia({
      library_id: library.id,
      path: join(process.cwd(), 'Breaking.Bad.S01E01.mkv'),
      filename: 'Breaking.Bad.S01E01.mkv',
      title: 'Breaking Bad · S01E01',
      sort_title: 'breaking bad · s01e01',
      kind: 'series',
      series_title: 'Breaking Bad',
      season: 1,
      episode: 1,
      year: null,
      duration: 3600,
      width: 1920,
      height: 1080,
      video_codec: 'h264',
      audio_codec: 'aac',
      container: 'mkv',
      folder: '',
      size: 123,
      mtime: 456,
      thumbnail_path: join(root, 'thumbnails', '1.jpg'),
      poster_path: null,
      backdrop_path: null,
      overview: null,
      genres: null,
      external_id: null
    });

    const updated = await refreshMetadata(db, root, media.id);
    assert.equal(updated?.title, 'Breaking Bad · Pilot');
    assert.equal(updated?.overview, 'Episode description');
    assert.equal(updated?.genres, 'Crime, Drama');
    assert.equal(updated?.year, 2008);
    assert.equal(updated?.external_id, 'cinemeta:series:tt0903747:s1:e1');
    assert.match(updated?.poster_path || '', /cinemeta-tt0903747-poster\.jpg$/);
    assert.match(updated?.backdrop_path || '', /cinemeta-tt0903747-s1-e1-backdrop\.jpg$/);
    await access(updated.poster_path);
    await access(updated.backdrop_path);
    db.setLike(media.id, true);
    db.setProgress(media.id, 123, 3600);
    const staleRevision = updated.metadata_revision;
    const cleared = db.clearExternalMetadata(media.id, parseMediaName(media.path));
    assert.equal(cleared.title, 'Breaking Bad · S01E01');
    for (const field of ['overview','genres','poster_path','backdrop_path','external_id']) assert.equal(cleared[field], null);
    assert.equal(cleared.thumbnail_path, media.thumbnail_path);
    assert.equal(cleared.progress_position, 123);
    assert.equal(cleared.liked, 1);
    assert.equal(cleared.metadata_blocked, 1);
    assert.equal(db.listMetadataCandidates(500, true).length, 0);
    // An in-flight lookup from before Clear must not replace the user's reset.
    db.updateExternalMetadata(media.id, {title:'Stale match', external_id:'stale'}, staleRevision);
    assert.equal(db.getMedia(media.id).external_id, null);
    // Manual matching opts the file back in; scanning alone does not.
    const rematched = await refreshMetadata(db, root, media.id);
    assert.equal(rematched.metadata_blocked, 0);
    assert.equal(rematched.title, 'Breaking Bad · Pilot');
  } finally {
    if (db) db.close();
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.VIRELO_TMDB_API_KEY;
    else process.env.VIRELO_TMDB_API_KEY = originalApiKey;
    await rm(root, { recursive: true, force: true });
  }
});
