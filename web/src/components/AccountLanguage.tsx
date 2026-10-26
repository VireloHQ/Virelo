import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';
import { deviceLocale, isLocale, setLocale } from '../i18n';

export function AccountLanguage() {
  const { data } = useQuery({queryKey:['account-language'],queryFn:api.language,refetchOnWindowFocus:true});
  useEffect(() => {
    if (data) void setLocale(isLocale(data.locale) ? data.locale : deviceLocale(), false).catch(() => {});
  }, [data]);
  useEffect(() => () => { void setLocale(deviceLocale(), false).catch(() => {}); }, []);
  return null;
}
