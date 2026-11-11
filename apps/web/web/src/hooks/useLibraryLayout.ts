import { create } from 'zustand';

export type LibraryLayout = 'grid' | 'explorer';
const storageKey = 'virelo.library-layout';
function readLayout():LibraryLayout {
  try { return localStorage.getItem(storageKey)==='explorer'?'explorer':'grid'; }
  catch { return 'grid'; }
}
export const useLibraryLayout=create<{layout:LibraryLayout;setLayout:(layout:LibraryLayout)=>void}>(set=>({
  layout:readLayout(),
  setLayout:layout=>{
    try { localStorage.setItem(storageKey,layout); } catch { /* Keep the preference for this session when storage is unavailable. */ }
    set({layout});
  }
}));
