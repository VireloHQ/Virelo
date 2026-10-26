import { createContext, useContext, useLayoutEffect, type ReactNode } from 'react';
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
  const query = useQuery({ queryKey: ['appearance'], queryFn: async () => normalizeAppearance(await api.appearance()), refetchOnWindowFocus: true });
  const mutation = useMutation({ mutationFn: api.saveAppearance, onSuccess: value => client.setQueryData(['appearance'], normalizeAppearance(value)) });
  const value = query.data ?? DEFAULT_APPEARANCE;
  useLayoutEffect(() => {
    const style = document.documentElement.style, variables = appearanceVariables(value.accentColor);
    const previous = Object.keys(variables).map(key => [key, style.getPropertyValue(key), style.getPropertyPriority(key)]);
    for (const [key, color] of Object.entries(variables)) style.setProperty(key, color);
    return () => { for (const [key, color, priority] of previous) color ? style.setProperty(key, color, priority) : style.removeProperty(key); };
  }, [value.accentColor]);
  return <AppearanceContext.Provider value={{ value, loading: query.isPending, saving: mutation.isPending, error: query.error, saveError: mutation.error, save: mutation.mutateAsync }}>{children}</AppearanceContext.Provider>;
}
