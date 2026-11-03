import { createContext, useContext, useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { Globe } from '@phosphor-icons/react';
import { Select } from './Select';
import { isPublicLocale, publicLanguages, translatePublic, type PublicLocale } from '../i18n/public-locale';
import { useLocale, setLocale, getLocale } from '../i18n';
import { LANGUAGE_KEY } from '../i18n/locale';
import { publicLocation, publicMetadata, publicGraph, publicPath } from '../public-site';
import type { PublicMessage } from '../i18n/public-messages';

interface LocaleContext {
  locale: PublicLocale;
  changeLocale: (locale: PublicLocale) => void;
  t: (message: PublicMessage, values?: Record<string, string>) => string;
}
const Context = createContext<LocaleContext | null>(null);

export function PublicLocaleProvider({ children, page }: { children: ReactNode; page: 'landing' | 'setup' }) {
  const selectedLocale = useLocale();
  const router = useRouter();
  const pathname = useRouterState({ select: state => state.location.pathname });
  const locale = publicLocation(pathname)?.locale ?? selectedLocale;
  const changeLocale = (value: PublicLocale) => {
    void setLocale(value).then(() => router.navigate({ to: publicPath(value, page) })).catch(() => {});
  };
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === LANGUAGE_KEY && isPublicLocale(event.newValue)) {
        const value = event.newValue;
        void setLocale(value, false).then(() => router.navigate({ to: publicPath(value, page) })).catch(() => {});
      }
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, [router, page]);
  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    const meta = publicMetadata(locale, page);
    const previousTitle = document.title;
    document.title = meta.title;
    const saved: Array<[Element, string, string | null]> = [];
    const created: Element[] = [];
    const update = (selector: string, attribute: string, value: string) => {
      let node = document.querySelector(selector);
      if (!node) {
        node = document.createElement(selector.startsWith('link') ? 'link' : 'meta');
        for (const match of selector.matchAll(/\[([\w-]+)="([^"]+)"\]/g)) node.setAttribute(match[1], match[2]);
        document.head.append(node); created.push(node);
      }
      saved.push([node, attribute, node.getAttribute(attribute)]); node.setAttribute(attribute, value);
    };
    update('link[rel="canonical"]', 'href', meta.canonical);
    update('meta[name="robots"]', 'content', 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1');
    for (const selector of ['meta[property="og:url"]', 'meta[name="twitter:url"]']) update(selector, 'content', meta.canonical);
    for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) update(selector, 'content', meta.description);
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) update(selector, 'content', meta.title);
    for (const selector of ['meta[property="og:image:alt"]', 'meta[name="twitter:image:alt"]']) update(selector, 'content', meta.imageAlt);
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:image"]']) update(selector, 'content', meta.image);
    update('meta[property="og:type"]', 'content', 'website');
    update('meta[property="og:site_name"]', 'content', 'Virelo');
    update('meta[name="twitter:card"]', 'content', 'summary_large_image');
    update('meta[property="og:locale"]', 'content', publicLanguages.find(language => language.value === locale)!.og);
    for (const alternate of [...meta.alternates, { locale: 'x-default', href: publicMetadata('en', page).canonical }]) {
      const selector = `link[rel="alternate"][hreflang="${alternate.locale}"]`;
      if (!document.querySelector(selector)) {
        const link = document.createElement('link'); link.rel = 'alternate'; link.hreflang = alternate.locale;
        document.head.append(link); created.push(link);
      }
      update(selector, 'href', alternate.href);
    }
    let schema = document.querySelector<HTMLScriptElement>('script[type="application/ld+json"]');
    if (!schema) { schema = document.createElement('script'); schema.type = 'application/ld+json'; document.head.append(schema); created.push(schema); }
    const originalSchema = schema.textContent;
    const faq = Array.from(document.querySelectorAll('.landing-faq details')).map(details => ({
      name: details.querySelector('summary')?.textContent ?? '', answer: details.querySelector('p')?.textContent ?? ''
    }));
    schema.textContent = JSON.stringify(publicGraph(locale, page, faq));
    return () => {
      document.title = previousTitle;
      document.documentElement.lang = getLocale();
      for (const [node, attribute, value] of saved) { if (value === null) node.removeAttribute(attribute); else node.setAttribute(attribute, value); }
      schema.textContent = originalSchema;
      for (const node of created) node.remove();
    };
  }, [locale, page]);
  return <Context.Provider value={{ locale, changeLocale, t: (message, values) => translatePublic(locale, message, values) }}>{children}</Context.Provider>;
}

export function usePublicLocale() {
  const context = useContext(Context);
  if (!context) throw new Error('Public locale requires PublicLocaleProvider.');
  return context;
}

const options = publicLanguages.map(({ value, label }) => ({ value, label }));
export function PublicLanguageSelect() {
  const { locale, changeLocale, t } = usePublicLocale();
  return <div className="public-language-select">
    <Globe aria-hidden="true" />
    <Select value={locale} options={options} align="end" className="public-language-picker"
      label={t('Language') + ': ' + publicLanguages.find(language => language.value === locale)!.label}
      onChange={value => { if (isPublicLocale(value)) changeLocale(value); }} />
  </div>;
}
