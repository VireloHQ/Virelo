import { AccountError } from './accounts.js';
import type { AppSettings } from './types.js';

export const DEFAULT_SETTINGS: AppSettings = {
  externalMetadataEnabled: true,
  externalImagesEnabled: true,
  metadataProvider: 'cinemeta',
  metadataLanguage: 'ja-JP',
  tmdbApiKey: '',
  libraryWatchEnabled: true,
  shortsIncludeLandscapes: false,
  queueBehavior: 'auto'
};

export function isSettingValue(key: string, value: unknown): boolean {
  if (!Object.hasOwn(DEFAULT_SETTINGS, key)) return false;
  switch (key) {
    case 'metadataProvider': return value === 'cinemeta' || value === 'tmdb';
    case 'queueBehavior': return value === 'auto' || value === 'loop' || value === 'manual';
    case 'metadataLanguage': return typeof value === 'string' && value.length <= 64 && /^[a-z]{2,3}(?:-[a-z\d]{2,8})*$/i.test(value);
    case 'tmdbApiKey': return typeof value === 'string' && value.length <= 4096 && !/[\0\r\n]/.test(value);
    default: return typeof value === 'boolean';
  }
}

export function validateSettingsPatch(patch: Partial<AppSettings>) {
  for (const [key, value] of Object.entries(patch)) {
    if (Object.hasOwn(DEFAULT_SETTINGS, key) && !isSettingValue(key, value)) throw new AccountError('Invalid settings.');
  }
}
