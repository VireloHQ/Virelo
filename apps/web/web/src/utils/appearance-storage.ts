import { isAppearance, normalizeAppearance, type Appearance } from './appearance';
const key = 'virelo.appearance.v1';
export function readAppearance(): Appearance {
  try { return normalizeAppearance(JSON.parse(localStorage.getItem(key) || 'null')); }
  catch { return normalizeAppearance(null); }
}
export function writeAppearance(value: Appearance): Appearance {
  if (!isAppearance(value)) throw new Error('Choose a controller style and a six-digit hex color.');
  const appearance = normalizeAppearance(value);
  try { localStorage.setItem(key, JSON.stringify(appearance)); }
  catch { throw new Error('Could not save appearance. Allow browser storage and try again.'); }
  return appearance;
}
