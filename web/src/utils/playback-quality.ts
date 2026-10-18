export type QualityPreference = 'auto' | 'source' | number;
const STORAGE_KEY = 'virelo-playback-quality:v1';
const LEGACY_KEY = 'virelo-playback-quality';
let sessionPreference: QualityPreference | undefined;

function parsePreference(value: string | null): QualityPreference | undefined {
  if (value === 'auto' || value === 'source') return value;
  const height = Number(value);
  return Number.isInteger(height) && height > 0 ? height : undefined;
}

export function readQualityPreference(allowAuto: boolean, allowConversion = true): QualityPreference {
  if (!allowConversion) return 'source';
  let preference = sessionPreference;
  if (preference === undefined) {
    try {
      preference = parsePreference(window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_KEY));
    } catch { /* Storage can be unavailable; keep the session choice. */ }
  }
  if (preference === 'auto' && !allowAuto) return 'source';
  return preference ?? 'source';
}

export function saveQualityPreference(preference: QualityPreference | null) {
  sessionPreference = preference === null ? 'auto' : preference;
  try { window.localStorage.setItem(STORAGE_KEY, String(sessionPreference)); }
  catch { /* Still retain the preference across videos in this tab. */ }
}

export function resolvePreferredQuality(qualities: readonly {height: number}[], preference: QualityPreference): number | null {
  if (preference === 'auto') return null;
  const heights = qualities.map(quality => quality.height).filter(height => Number.isFinite(height) && height > 0);
  if (preference === 'source') return heights.length ? Math.max(...heights) : null;
  const eligible = heights.filter(height => height <= preference);
  if (!eligible.length) throw new Error(`No quality at or below ${qualityLabel(preference)} is available. Choose another quality to continue; the quality will not be increased automatically.`);
  return Math.max(...eligible);
}

export function qualityLabel(height: number) { return height >= 2160 ? '4K' : `${height}p`; }

// Portrait HLS streams advertise their long side as height. Virelo labels the short side.
export function boundedQualityLevel(levels: readonly {width: number; height: number}[], ceiling: number): number {
  let selected = -1;
  let resolution = 0;
  levels.forEach((level, index) => {
    const size = Math.min(level.width || Infinity, level.height || Infinity);
    if (Number.isFinite(size) && size > 0 && size <= ceiling && size > resolution) {
      selected = index;
      resolution = size;
    }
  });
  if (selected < 0) throw new Error(`No stream at or below ${qualityLabel(ceiling)} is available.`);
  return selected;
}
