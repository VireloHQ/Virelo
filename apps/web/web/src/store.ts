import { create } from 'zustand';

export type HomeFilter = 'all' | 'movie' | 'series';

interface UIState {
  homeFilter: HomeFilter;
  setHomeFilter: (value:HomeFilter)=>void;
  search: string;
  setSearch: (value:string)=>void;
  mobileSearchOpen: boolean;
  setMobileSearchOpen: (value:boolean)=>void;
}

export const useUIStore = create<UIState>((set) => ({
  homeFilter: 'all',
  setHomeFilter: (homeFilter) => set({ homeFilter }),
  search: '',
  setSearch: (search) => set({ search }),
  mobileSearchOpen: false,
  setMobileSearchOpen: (mobileSearchOpen) => set({ mobileSearchOpen })
}));
