import type { ScanStatus } from '../types';
import { t } from './runtime';
export function scanMessage(status?: ScanStatus) {
  if (!status) return t('Idle');
  if (!status.running && status.message.startsWith('Scan complete')) return [t('Scan complete'),
    t('{count} checked',{count:status.scanned}),t('{count} added',{count:status.added}),t('{count} updated',{count:status.updated}),
    t('{count} thumbnails generated',{count:status.thumbnailsGenerated??0}),t('{count} thumbnails restored',{count:status.thumbnailsRepaired??0}),
    ...(status.message.match(/ · (\d+) metadata matches/)?.[1] ? [t('{count} metadata matches',{count:Number(status.message.match(/ · (\d+) metadata matches/)![1])})] : []),
    t('{count} errors',{count:status.errors})].join(' · ');
  return t(status.message);
}
