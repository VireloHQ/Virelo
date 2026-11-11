export const LANGUAGE_KEY = 'virelo.language.v1';
import { languages, isLocale, type Locale } from '../../../src/languages';
export { languages, isLocale, type Locale } from '../../../src/languages';
export type MessageValue = string | number;
export type Translation = string | { one?: string; few?: string; many?: string; other: string };
export type Catalog = Record<string, Translation>;
const templates = new WeakMap<Catalog, Array<{ key: string; names: string[]; parts: string[] }>>();
const fieldValidation = new Set(['{value0} is required.','{value0} must contain 1–{value1} characters.','{value0} must contain 1–{value1} visible characters.','Enter a valid {value0}.']);
export function resolveLocale(saved: unknown, preferred: readonly string[]): Locale {
  if (isLocale(saved)) return saved;
  for (const value of preferred) {
    const code = value.toLowerCase();
    const match = languages.find(language => language.value.toLowerCase() === code || code.startsWith(language.value.toLowerCase() + '-'));
    if (match) return match.value;
    if (/^zh(?:$|-(?:cn|sg|hans)(?:-|$))/.test(code)) return 'zh-CN';
  }
  return 'en';
}
export function translate(catalog: Catalog, locale: Locale, message: string, values: Record<string, MessageValue> = {}): string {
  if (!Object.hasOwn(catalog,message) && message.length <= 8192) {
    let patterns = templates.get(catalog);
    if (!patterns) {
      patterns = Object.keys(catalog).filter(key => /\{\w+\}/.test(key) && /[A-Za-z]{3}/.test(key.replace(/\{\w+\}/g,''))).map(key => ({
        key, names: Array.from(key.matchAll(/\{(\w+)\}/g), match => match[1]),
        parts: key.split(/\{\w+\}/)
      })).sort((a,b) => b.key.replace(/\{\w+\}/g,'').length - a.key.replace(/\{\w+\}/g,'').length);
      templates.set(catalog,patterns);
    }
    for (const template of patterns) {
      if (!message.startsWith(template.parts[0])) continue;
      let position=template.parts[0].length, matched=true;
      const captured: Record<string,string> = {};
      for (let index=0;index<template.names.length;index++) {
        const next=template.parts[index+1],last=index===template.names.length-1;
        const end=last ? message.endsWith(next) ? message.length-next.length : -1 : next ? message.indexOf(next,position) : -1;
        if (end<position) { matched=false; break; }
        captured[template.names[index]]=message.slice(position,end); position=end+next.length;
      }
      if (matched && position===message.length) {
        if (fieldValidation.has(template.key) && Object.hasOwn(catalog,captured.value0)) captured.value0=translate(catalog,locale,captured.value0);
        return translate(catalog,locale,template.key,captured);
      }
    }
  }
  const entry = Object.hasOwn(catalog, message) ? catalog[message] : message;
  const text = typeof entry === 'string' ? entry : entry[new Intl.PluralRules(locale).select(Number(values.count)) as keyof typeof entry] ?? entry.other;
  return text.replace(/\{(\w+)\}/g, (token, key: string) => Object.hasOwn(values, key) ? String(values[key]) : token);
}
