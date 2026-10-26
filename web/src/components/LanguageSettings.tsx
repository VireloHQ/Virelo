import { useEffect, useRef, useState } from 'react';
import { Select } from './Select';
import { isLocale, languages, loadLocale, setLocale, t, useLocale } from '../i18n';
import '../i18n/language.css';

export function LanguageSelect({ onSave }: { onSave?: (locale: string) => Promise<unknown> }) {
  const locale = useLocale();
  const [pending, setPending] = useState(false), [error, setError] = useState('');
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  return <div className="language-select" aria-busy={pending}>
    <Select label={t('Language')} value={locale} options={[...languages]} onChange={value => {
      if (!isLocale(value) || pending) return;
      setPending(true); setError('');
      void (async () => {
        await loadLocale(value);if(!active.current)return;
        await onSave?.(value);if(active.current)await setLocale(value);
      })().catch(() => {if(active.current)setError('Could not change the language. Try again.');})
        .finally(() => {if(active.current)setPending(false);});
    }}/>
    {error && <p className="error-copy" role="alert">{t(error)}</p>}
  </div>;
}
export function LanguageSettings({ onSave }: { onSave?: (locale: string) => Promise<unknown> }) {
  useLocale();
  return <div className="appearance-language"><label>{t('Language')}</label><LanguageSelect onSave={onSave}/></div>;
}
