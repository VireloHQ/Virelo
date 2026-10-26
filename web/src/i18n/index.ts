import { useSyncExternalStore } from 'react';
import { getLocale, subscribeLocale } from './runtime';
export { t, getLocale, setLocale, initializeLocale, deviceLocale, loadLocale, translateLocale } from './runtime';
export { languages, isLocale, type Locale } from './locale';
export function useLocale() { return useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const); }
