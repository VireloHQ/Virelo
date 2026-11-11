import type { PlaybackTrack } from '../types';

type TrackKind = 'audio' | 'subtitles';
interface TrackPreference { configuration: string; selection: string | null; }
const session: Partial<Record<TrackKind, TrackPreference | null>> = {};
const storageKey = (kind: TrackKind) => 'virelo-playback-' + kind + ':v1';
const text = (value: string | null) => (value || '').trim().toLowerCase().replace(/\s+/g, ' ');

function trackKey(track: PlaybackTrack): string {
  let language = text(track.language);
  if (language === 'und') language = '';
  if (language) {
    try { language = Intl.getCanonicalLocales(language.replace(/_/g, '-'))[0].toLowerCase(); }
    catch { /* Retain nonstandard language tags without guessing. */ }
  }
  return JSON.stringify([language, text(track.title), text(track.codec), track.channels, text(track.channelLayout), track.forced]);
}

function configuration(tracks: readonly PlaybackTrack[]) {
  // Container stream IDs, ordering and default flags do not identify a language.
  return JSON.stringify(tracks.map(trackKey).sort());
}

function readPreference(kind: TrackKind): TrackPreference | null {
  if (session[kind] !== undefined) return session[kind]!;
  try {
    const saved = JSON.parse(window.localStorage.getItem(storageKey(kind)) || 'null');
    if (saved && typeof saved.configuration === 'string' && saved.configuration.length <= 32768
      && (saved.selection === null || (typeof saved.selection === 'string' && saved.selection.length <= 2048))
      && (kind === 'subtitles' || saved.selection !== null)) {
      return session[kind] = { configuration: saved.configuration, selection: saved.selection };
    }
  } catch { /* Corrupt or blocked storage must not prevent playback. */ }
  return session[kind] = null;
}

export function hasPlaybackTrackPreference(kind: TrackKind): boolean {
  return readPreference(kind) !== null;
}

export function resolvePlaybackTrackSelection(kind: TrackKind, tracks: readonly PlaybackTrack[], fallback: number | null): number | null {
  const preference = readPreference(kind);
  if (!preference || preference.configuration !== configuration(tracks)) return fallback;
  if (preference.selection === null) return null;
  const matching = tracks.filter(track => trackKey(track) === preference.selection);
  // Identical unnamed tracks are ambiguous; do not silently select another language.
  return matching.length === 1 && matching[0].supported ? matching[0].index : fallback;
}

export function savePlaybackTrackSelection(kind: TrackKind, tracks: readonly PlaybackTrack[], index: number | null): boolean {
  const selected = tracks.find(track => track.index === index);
  if (index !== null && (!Number.isSafeInteger(index) || index < 0 || !selected?.supported)) return false;
  if (index === null && kind !== 'subtitles') return false;
  const preference = { configuration: configuration(tracks), selection: selected ? trackKey(selected) : null };
  session[kind] = preference;
  try { window.localStorage.setItem(storageKey(kind), JSON.stringify(preference)); }
  catch { /* Still retain the user's choice between videos in this tab. */ }
  return true;
}
