import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { imageFileExists, prepareGeneratedFile } from './image-files.js';
import type { VireloDB } from './db.js';
import type { MediaRecord } from './types.js';

const CINEMETA_API = 'https://v3-cinemeta.strem.io';
const TMDB_API = 'https://api.themoviedb.org/3';
const TMDB_IMAGE = 'https://image.tmdb.org/t/p';
const REQUEST_TIMEOUT = 15000;
const JSON_LIMIT = 16 * 1024 * 1024;
const ARTWORK_LIMIT = 32 * 1024 * 1024;

function responseLimit(limit: number) {
  let bytes = 0;
  return new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    done(bytes > limit ? new Error('Remote response exceeds the size limit.') : null, chunk);
  } });
}

interface CinemetaPreview {
  id: string;
  name?: string;
  releaseInfo?: string;
  year?: string;
}

interface CinemetaVideo {
  name?: string;
  season?: number;
  episode?: number;
  number?: number;
  overview?: string;
  description?: string;
  thumbnail?: string;
  firstAired?: string;
  released?: string;
}

interface CinemetaMeta extends CinemetaPreview {
  description?: string;
  genres?: string[];
  genre?: string[];
  poster?: string;
  background?: string;
  released?: string;
  videos?: CinemetaVideo[];
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!response.ok) throw new Error(`Metadata request failed: ${response.status}`);
  if (!response.body) throw new Error('Metadata details were unavailable.');
  const chunks: Buffer[] = [];
  await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), responseLimit(JSON_LIMIT), async stream => {
    for await (const chunk of stream) chunks.push(chunk);
  });
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

async function download(url: string, target: string) {
  if (await imageFileExists(target)) return;
  await prepareGeneratedFile(target);
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') throw new Error('Artwork URL must use HTTPS.');
  const response = await fetch(parsed, { redirect: 'follow', signal: AbortSignal.timeout(REQUEST_TIMEOUT) });
  if (!response.ok || !response.body) throw new Error(`Artwork download failed: ${response.status}`);
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error('Artwork response was not an image.');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), responseLimit(ARTWORK_LIMIT), createWriteStream(temporary));
    if(!await imageFileExists(temporary))throw Error('Artwork download was not a supported image.');
    await prepareGeneratedFile(target);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (!await imageFileExists(target)) throw error;
  }
}

function normalizeTitle(value: string) {
  return value.normalize('NFKD').toLocaleLowerCase('en-US').replace(/[\p{P}\p{S}\s]+/gu, ' ').trim();
}

function firstYear(value?: string | null) {
  const match = value?.match(/(?:19|20)\d{2}/);
  return match ? Number(match[0]) : null;
}

function chooseCinemetaMatch(results: CinemetaPreview[], query: string, expectedYear: number | null) {
  const normalizedQuery = normalizeTitle(query);
  return results
    .map((item, index) => {
      const normalizedName = normalizeTitle(item.name || '');
      const resultYear = firstYear(item.releaseInfo || item.year);
      let score = Math.max(0, 30 - index);
      if (normalizedName === normalizedQuery) score += 100;
      else if (normalizedName.startsWith(normalizedQuery) || normalizedQuery.startsWith(normalizedName)) score += 45;
      else if (normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName)) score += 20;
      if (expectedYear && resultYear) score += Math.max(-20, 35 - Math.abs(expectedYear - resultYear) * 12);
      return { item, score };
    })
    .sort((a, b) => b.score - a.score)[0]?.item;
}

async function refreshCinemetaMetadata(db: VireloDB, dataDir: string, media: MediaRecord, onArtworkFailure?:()=>void) {
  const type = media.kind === 'series' ? 'series' : 'movie';
  const query = media.kind === 'series' && media.series_title ? media.series_title : media.title;
  const searchUrl = `${CINEMETA_API}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
  const search = await fetchJson<{ metas?: CinemetaPreview[] }>(searchUrl);
  const match = chooseCinemetaMatch(search.metas || [], query, media.year);
  if (!match?.id) throw new Error('No metadata match found.');

  const detail = await fetchJson<{ meta?: CinemetaMeta }>(`${CINEMETA_API}/meta/${type}/${encodeURIComponent(match.id)}.json`);
  const metadata = detail.meta;
  if (!metadata) throw new Error('Metadata details were unavailable.');

  const episode = type === 'series' && media.season != null && media.episode != null
    ? metadata.videos?.find((video) => video.season === media.season && (video.episode ?? video.number) === media.episode)
    : undefined;
  const settings = db.getSettings();
  let posterPath = media.poster_path;
  let backdropPath = media.backdrop_path;
  if (settings.externalImagesEnabled) {
    if (metadata.poster) {
      const target = join(dataDir, 'artwork', `cinemeta-${encodeURIComponent(match.id)}-poster.jpg`);
      try { await download(metadata.poster, target); posterPath = target; } catch { onArtworkFailure?.(); }
    }
    const backdrop = episode?.thumbnail || metadata.background;
    if (backdrop) {
      const suffix = episode ? `-s${media.season}-e${media.episode}` : '';
      const target = join(dataDir, 'artwork', `cinemeta-${encodeURIComponent(match.id)}${suffix}-backdrop.jpg`);
      try { await download(backdrop, target); backdropPath = target; } catch { onArtworkFailure?.(); }
    }
  }

  const title = episode?.name
    ? `${media.series_title || metadata.name || query} · ${episode.name}`
    : (metadata.name || media.title);
  const date = episode?.firstAired || episode?.released || metadata.released || metadata.releaseInfo || metadata.year;
  const genres = metadata.genres || metadata.genre;
  db.updateExternalMetadata(media.id, {
    title,
    overview: episode?.overview || episode?.description || metadata.description || media.overview,
    genres: Array.isArray(genres) ? genres.join(', ') : media.genres,
    poster_path: posterPath,
    backdrop_path: backdropPath,
    external_id: `cinemeta:${type}:${match.id}${episode ? `:s${media.season}:e${media.episode}` : ''}`,
    year: firstYear(date) ?? media.year
  }, media.metadata_revision ?? 0);
  return db.getMedia(media.id);
}

async function refreshTmdbMetadata(db: VireloDB, dataDir: string, media: MediaRecord, apiKey: string, onArtworkFailure?:()=>void) {
  const settings = db.getSettings();
  const type = media.kind === 'series' ? 'tv' : 'movie';
  const query = media.kind === 'series' && media.series_title ? media.series_title : media.title;
  const params = new URLSearchParams({ api_key: apiKey, query, language: settings.metadataLanguage, include_adult: 'false' });
  if (media.year) params.set(type === 'movie' ? 'year' : 'first_air_date_year', String(media.year));
  const searchJson = await fetchJson<{ results?: Array<{ id: number }> }>(`${TMDB_API}/search/${type}?${params.toString()}`);
  const match = searchJson.results?.[0];
  if (!match) throw new Error('No TMDB match found.');

  const details = await fetchJson<any>(`${TMDB_API}/${type}/${match.id}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.metadataLanguage)}`);
  let content = details;
  let externalId = `tmdb:${type}:${details.id}`;
  if (type === 'tv' && media.season != null && media.episode != null) {
    try {
      content = await fetchJson<any>(`${TMDB_API}/tv/${details.id}/season/${media.season}/episode/${media.episode}?api_key=${encodeURIComponent(apiKey)}&language=${encodeURIComponent(settings.metadataLanguage)}`);
      externalId = `tmdb:tv:${details.id}:s${media.season}:e${media.episode}`;
    } catch {
      content = details;
    }
  }

  let posterPath = media.poster_path;
  let backdropPath = media.backdrop_path;
  if (settings.externalImagesEnabled) {
    if (details.poster_path) {
      const target = join(dataDir, 'artwork', `tmdb-${type}-${encodeURIComponent(String(details.id))}-poster.jpg`);
      try { await download(`${TMDB_IMAGE}/w780${details.poster_path}`, target); posterPath = target; } catch { onArtworkFailure?.(); }
    }
    const backdrop = content.still_path || details.backdrop_path;
    if (backdrop) {
      const target = join(dataDir, 'artwork', `${media.id}-backdrop.jpg`);
      try { await download(`${TMDB_IMAGE}/w1280${backdrop}`, target); backdropPath = target; } catch { onArtworkFailure?.(); }
    }
  }

  const isEpisode = type === 'tv' && content !== details;
  const title = isEpisode && content.name
    ? `${media.series_title || details.name} · ${content.name}`
    : (details.title || details.name || media.title);
  const date = isEpisode ? content.air_date : (details.release_date || details.first_air_date);
  db.updateExternalMetadata(media.id, {
    title,
    overview: content.overview || details.overview || media.overview,
    genres: Array.isArray(details.genres) ? details.genres.map((genre: { name?: string }) => genre.name).filter(Boolean).join(', ') : media.genres,
    poster_path: posterPath,
    backdrop_path: backdropPath,
    external_id: externalId,
    year: firstYear(date) ?? media.year
  }, media.metadata_revision ?? 0);
  return db.getMedia(media.id);
}

export async function refreshMetadata(db: VireloDB, dataDir: string, mediaId: number, manual = true, onArtworkFailure?:()=>void) {
  const settings = db.getSettings();
  if (!settings.externalMetadataEnabled) throw new Error('Online metadata is disabled. Enable it in Settings first.');
  const media = db.getMedia(mediaId);
  if (!media) throw new Error('Media not found.');
  if (!manual && media.metadata_blocked) return media;
  const tmdbApiKey = settings.tmdbApiKey || process.env.VIRELO_TMDB_API_KEY?.trim();
  return tmdbApiKey
    ? refreshTmdbMetadata(db, dataDir, media, tmdbApiKey,onArtworkFailure)
    : refreshCinemetaMetadata(db, dataDir, media,onArtworkFailure);
}

export async function refreshMissingMetadata(db: VireloDB, dataDir: string, onProgress?: (done: number, total: number) => void, scope?: import('./auth-types.js').CatalogScope, signal?: AbortSignal) {
  const settings = db.getSettings();
  if (!settings.externalMetadataEnabled) return { attempted: 0, updated: 0, failed: 0, artworkFailed:0 };
  const candidates = db.listMetadataCandidates(5000, settings.externalImagesEnabled, scope);
  let updated = 0;
  let failed = 0;
  let artworkFailed=0;
  let attempted=0;
  for (let index = 0; index < candidates.length; index++) {
    if (signal?.aborted) break;
    attempted++;
    try {
      await refreshMetadata(db, dataDir, candidates[index].id, false,()=>artworkFailed++);
      updated++;
    } catch {
      failed++;
    }
    onProgress?.(index + 1, candidates.length);
    if (!signal?.aborted && index + 1 < candidates.length) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return { attempted, updated, failed, artworkFailed };
}
