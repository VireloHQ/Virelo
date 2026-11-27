import { useSyncExternalStore } from 'react';

const compactQuery = () => window.matchMedia('(max-width: 640px), (max-width: 900px) and (pointer: coarse)');
const subscribe = (notify: () => void) => {
  const query = compactQuery();
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

export const useCompactDialog = () => useSyncExternalStore(subscribe, () => compactQuery().matches);
