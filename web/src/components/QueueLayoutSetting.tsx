import { useQueueLayout } from '../hooks/useQueueLayout';
import type { QueueLayout } from '../utils/playback-queue';
import { Select } from './Select';

export function QueueLayoutSetting() {
  const { layout, setLayout } = useQueueLayout();
  return <div className="setting-row">
    <div className="setting-copy"><div><strong>Queue layout</strong><p>Horizontal filmstrip or vertical list. On wide screens, the vertical queue sits beside the video. Saved on this device.</p></div></div>
    <Select className="settings-picker" label="Queue layout" value={layout} align="end"
      options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]}
      onChange={value => setLayout(value as QueueLayout)} />
  </div>;
}
