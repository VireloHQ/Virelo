// Sort exactly one series within a library for Web and npm playback.
export interface SeriesEpisode {
  id: number;
  kind: string;
  library_id: number;
  series_title: string | null;
  season: number | null;
  episode: number | null;
  title: string;
}

export function seriesTitleKey(title: string): string {
  return title.trim().toLowerCase();
}

export function sortSeriesEpisodes<T extends SeriesEpisode>(items: readonly T[], seriesTitle: string, libraryId: number): T[] {
  const title = seriesTitleKey(seriesTitle);
  return items.filter(item =>
    item.kind === 'series' && item.library_id === libraryId
    && item.series_title !== null && seriesTitleKey(item.series_title) === title
  ).sort((a, b) =>
    (a.season ?? Number.MAX_SAFE_INTEGER) - (b.season ?? Number.MAX_SAFE_INTEGER)
    || (a.episode ?? Number.MAX_SAFE_INTEGER) - (b.episode ?? Number.MAX_SAFE_INTEGER)
    || a.title.localeCompare(b.title, undefined, { numeric: true })
    || a.id - b.id
  );
}
