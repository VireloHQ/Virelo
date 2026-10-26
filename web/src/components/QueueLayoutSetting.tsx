import { t, useLocale } from '../i18n';
import { useQueueLayout } from '../hooks/useQueueLayout';
import type { QueueLayout } from '../utils/playback-queue';
import { Select } from './Select';

export function QueueLayoutSetting() {
  useLocale();
  const { layout, setLayout } = useQueueLayout();
  return <div className="setting-row">
    <div className="setting-copy"><div><strong>{t("Queue layout")}</strong><p>{t("Horizontal filmstrip or vertical list. On wide screens, the vertical queue sits beside the video. Saved on this device.")}</p></div></div>
    <Select className="settings-picker" label={t("Queue layout")} value={layout} align="end"
      options={[{ value: 'horizontal', label: t('Horizontal') }, { value: 'vertical', label: t('Vertical') }]}
      onChange={value => setLayout(value as QueueLayout)} />
  </div>;
}
