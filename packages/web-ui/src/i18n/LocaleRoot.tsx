import { type ReactNode } from 'react';
import { I18nProvider } from 'react-aria';
import { useLocale } from '@edition/i18n/index';
export function LocaleRoot({children}:{children:ReactNode}) {
  const locale = useLocale();
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
