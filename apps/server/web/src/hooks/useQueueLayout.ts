import { create } from 'zustand';
import type { QueueLayout } from '../utils/playback-queue';

const storageKey = 'virelo.queue-layout';
function readLayout(): QueueLayout {
  try { return localStorage.getItem(storageKey) === 'vertical' ? 'vertical' : 'horizontal'; }
  catch { return 'horizontal'; }
}
export const useQueueLayout = create<{ layout: QueueLayout; setLayout: (layout: QueueLayout) => void }>(set => ({
  layout: readLayout(),
  setLayout: layout => {
    try { localStorage.setItem(storageKey, layout); } catch { /* Keep the preference for this session when storage is unavailable. */ }
    set({ layout });
  }
}));
