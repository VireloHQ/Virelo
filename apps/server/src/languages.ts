export const languages = [
  { value: 'en', label: 'English', og: 'en_US' },
  { value: 'ja', label: '日本語', og: 'ja_JP' },
  { value: 'zh-CN', label: '简体中文', og: 'zh_CN' },
  { value: 'ko', label: '한국어', og: 'ko_KR' },
  { value: 'ru', label: 'Русский', og: 'ru_RU' }
] as const;
export type Locale = typeof languages[number]['value'];
export function isLocale(value: unknown): value is Locale { return languages.some(language => language.value === value); }
