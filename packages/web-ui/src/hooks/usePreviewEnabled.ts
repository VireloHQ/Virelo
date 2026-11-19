import { useSyncExternalStore } from 'react';
import { readPreviewEnabled, subscribePreviewEnabled } from '../utils/preview-preference';

export function usePreviewEnabled() {
  return useSyncExternalStore(subscribePreviewEnabled, readPreviewEnabled, () => true);
}
