import en from './messages/en.json';
import { isLocale, LANGUAGE_KEY, resolveLocale, translate, type Catalog, type Locale, type MessageValue } from './locale';

const loaders = {
  en: async () => en,
  ja: () => import('./messages/ja.json').then(module => module.default),
  'zh-CN': () => import('./messages/zh-CN.json').then(module => module.default),
  ko: () => import('./messages/ko.json').then(module => module.default),
  ru: () => import('./messages/ru.json').then(module => module.default)
};
const catalogs = new Map<Locale, Catalog>([['en', en]]);
const pending = new Map<Locale, Promise<Catalog>>();
const listeners = new Set<() => void>();
let locale: Locale = 'en', sequence = 0;
export const getLocale = () => locale;
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function loadLocale(value: Locale): Promise<Catalog> {
  const saved = catalogs.get(value);
  if (saved) return saved;
  let task = pending.get(value);
  if (!task) {
    task = loaders[value]().then(catalog => { catalogs.set(value, catalog); return catalog; }).finally(() => pending.delete(value));
    pending.set(value, task);
  }
  return task;
}
export async function setLocale(value: Locale, persist = true): Promise<void> {
  if (!isLocale(value)) throw new Error('Choose a supported language.');
  const request = ++sequence;
  try { await loadLocale(value); } catch (error) { if (request !== sequence) return; throw error; }
  if (request !== sequence) return;
  locale = value;
  if (typeof document !== 'undefined') document.documentElement.lang = value;
  if (persist) try { localStorage.setItem(LANGUAGE_KEY, value); } catch { /* The choice still applies to this tab. */ }
  listeners.forEach(listener => listener());
}
export function deviceLocale(): Locale {
  let saved: unknown;
  try { saved = localStorage.getItem(LANGUAGE_KEY) ?? localStorage.getItem('virelo-public-locale:v1'); } catch { /* Browser preferences remain available. */ }
  return resolveLocale(saved, typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language]);
}
export const t = (message: string, values?: Record<string, MessageValue>) => translate(catalogs.get(locale) ?? en, locale, message, values);
export const translateLocale = (value: Locale, message: string, values?: Record<string, MessageValue>) => translate(catalogs.get(value) ?? en, value, message, values);
export function initializeLocale() {
  if (typeof window === 'undefined') return;
  void setLocale(deviceLocale(), false).catch(() => setLocale('en',false));
  window.addEventListener('storage', event => {
    if (event.key === LANGUAGE_KEY || event.key === null) void setLocale(deviceLocale(), false).catch(() => {});
  });
}
