import { createContext, useContext, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { appearanceVariables, DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from '../utils/appearance';
import '../appearance.css';

const AppearanceContext = createContext({
  value: DEFAULT_APPEARANCE as Appearance, loading: false, saving: false,
  error: null as Error | null, saveError: null as Error | null,
  save: async (_value: Appearance): Promise<Appearance> => { throw new Error('Appearance settings are unavailable.'); }
});
export const useAppearance = () => useContext(AppearanceContext);
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const client = useQueryClient();
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const query = useQuery({ queryKey: ['appearance'], queryFn: async () => normalizeAppearance(await api.appearance()), refetchOnWindowFocus: 'always' });
  const mutation = useMutation({ scope: { id: 'appearance' }, mutationFn: (value: Appearance) => {
    if (!active.current) throw new Error('Appearance settings are unavailable.');
    return api.saveAppearance(value);
  }, onSuccess: async value => {
    await client.cancelQueries({queryKey:['appearance']});
    client.setQueryData(['appearance'], normalizeAppearance(value));
  } });
  useEffect(() => {
    const storage = (event: StorageEvent) => {
      try { if (event.storageArea && event.storageArea !== localStorage) return; } catch { return; }
      if (event.key === 'virelo.appearance.v1' || event.key === null)
        void client.cancelQueries({queryKey:['appearance']}).then(() => client.invalidateQueries({queryKey:['appearance']}));
    };
    window.addEventListener('storage', storage);
    return () => window.removeEventListener('storage', storage);
  }, [client]);
  const value = query.data ?? DEFAULT_APPEARANCE;
  useLayoutEffect(() => {
    const style = document.documentElement.style, variables = appearanceVariables(value.accentColor);
    const previous = Object.keys(variables).map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]);
    for (const [key, color] of Object.entries(variables)) style.setProperty(key, color);
    return () => { for (const [key, color, priority] of previous) color ? style.setProperty(key, color, priority) : style.removeProperty(key); };
  }, [value.accentColor]);
  return <AppearanceContext.Provider value={{ value, loading: query.isPending, saving: mutation.isPending, error: query.error, saveError: mutation.error, save: mutation.mutateAsync }}>{children}</AppearanceContext.Provider>;
}
