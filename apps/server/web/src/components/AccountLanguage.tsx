import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { isLocale, setAccountLocale } from '../i18n';

export function AccountLanguage() {
  const client = useQueryClient();
  const { data } = useQuery({queryKey:['account-language'],queryFn:api.language,refetchOnWindowFocus:'always'});
  useEffect(() => {
    void setAccountLocale(isLocale(data?.locale) ? data.locale : null);
  }, [data]);
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
      if (event.key === 'virelo-account-language-changed')
        void client.cancelQueries({queryKey:['account-language']}).then(() => client.invalidateQueries({queryKey:['account-language']}));
    };
    window.addEventListener('storage', storage);
    return () => {
      window.removeEventListener('storage', storage);
      void setAccountLocale(undefined);
    };
  }, [client]);
  return null;
}
