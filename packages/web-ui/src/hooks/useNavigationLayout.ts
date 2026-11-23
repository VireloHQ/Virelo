import { create } from 'zustand';

type NavigationLayout = 'header' | 'sidebar';
const storageKey='virelo.navigation-layout';

function readLayout():NavigationLayout {
  try { return localStorage.getItem(storageKey)==='sidebar'?'sidebar':'header'; }
  catch { return 'header'; }
}

export const useNavigationLayout=create<{layout:NavigationLayout;setLayout:(value:NavigationLayout)=>void}>(set=>({
  layout:readLayout(),
  setLayout:layout=>{
    try { localStorage.setItem(storageKey,layout); } catch { /* Use the layout for this session. */ }
    set({layout});
  }
}));
