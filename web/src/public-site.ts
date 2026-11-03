import { publicLocaleForPath, type Locale } from './i18n/locale';
import seo from './i18n/public-seo.json';

export const siteOrigin = 'https://virelo.riyo.me';
export type PublicPage = 'landing' | 'setup';
export const publicPaths = {
  en: { landing: '/', setup: '/setup' },
  ja: { landing: '/ja', setup: '/ja/setup' },
  'zh-CN': { landing: '/zh-CN', setup: '/zh-CN/setup' },
  ko: { landing: '/ko', setup: '/ko/setup' },
  ru: { landing: '/ru', setup: '/ru/setup' }
} as const;

export function publicPath(locale: Locale, page: PublicPage) { return publicPaths[locale][page]; }
export function publicLocation(pathname: string): { locale: Locale; page: PublicPage } | null {
  const locale = publicLocaleForPath(pathname);
  return locale ? { locale, page: pathname.replace(/\/+$/, '').endsWith('/setup') ? 'setup' : 'landing' } : null;
}

const copy: Record<Locale, { landing: string; setup: string; description: string; guide: string; image: string }> = seo;

export function publicMetadata(locale: Locale, page: PublicPage) {
  const item = copy[locale], canonical = siteOrigin + publicPath(locale, page);
  return {
    title: item[page], description: page === 'landing' ? item.description : item.guide, canonical,
    image: siteOrigin + '/og/virelo.png', imageAlt: item.image,
    alternates: Object.keys(publicPaths).map(value => ({ locale: value, href: siteOrigin + publicPath(value as Locale, page) }))
  };
}

export function publicGraph(locale: Locale, page: PublicPage, faq: { name: string; answer: string }[] = []) {
  const meta = publicMetadata(locale, page);
  const publisher = { '@id': siteOrigin + '/#organization' };
  const graph: Record<string, unknown>[] = [
    { '@type': 'Organization', ...publisher, name: 'Virelo', url: siteOrigin + '/',
      logo: { '@type': 'ImageObject', url: siteOrigin + '/virelo-icon-512.png?v=ribbon-1' },
      sameAs: ['https://github.com/VireloHQ', 'https://github.com/VireloHQ/Virelo-Web', 'https://github.com/VireloHQ/Virelo', 'https://www.npmjs.com/package/virelo'] },
    { '@type': 'WebSite', '@id': siteOrigin + '/#website', name: 'Virelo', url: siteOrigin + '/', publisher,
      inLanguage: Object.keys(publicPaths) },
    { '@type': 'SoftwareApplication', '@id': siteOrigin + '/#software', name: 'Virelo', url: siteOrigin + '/',
      applicationCategory: 'MultimediaApplication', operatingSystem: 'Web; Windows, macOS, Linux and Android via Termux for the self-hosted server',
      description: copy[locale].description, inLanguage: locale, isAccessibleForFree: true,
      license: 'https://www.gnu.org/licenses/agpl-3.0.html', publisher,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      softwareHelp: { '@type': 'WebPage', url: siteOrigin + publicPath(locale, 'setup') },
      screenshot: [siteOrigin + '/landing/library-desktop.webp', siteOrigin + '/landing/player-desktop.webp'],
      sameAs: ['https://github.com/VireloHQ/Virelo-Web', 'https://github.com/VireloHQ/Virelo', 'https://www.npmjs.com/package/virelo'] },
    { '@type': 'WebPage', '@id': meta.canonical + '#page', name: meta.title, description: meta.description,
      url: meta.canonical, inLanguage: locale, isPartOf: { '@id': siteOrigin + '/#website' },
      mainEntity: { '@id': siteOrigin + '/#software' }, primaryImageOfPage: { '@type': 'ImageObject', url: meta.image } }
  ];
  if (page === 'landing' && faq.length) graph.push({ '@type': 'FAQPage', '@id': meta.canonical + '#faq', inLanguage: locale,
    mainEntity: faq.map(item => ({ '@type': 'Question', name: item.name, acceptedAnswer: { '@type': 'Answer', text: item.answer } })) });
  return { '@context': 'https://schema.org', '@graph': graph };
}
