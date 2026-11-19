import { t, useLocale } from '@edition/i18n';
import { Switch } from '@heroui/react';
import { usePreviewEnabled } from '../hooks/usePreviewEnabled';
import { savePreviewEnabled } from '../utils/preview-preference';

export function PreviewSetting() {
  useLocale();
  const enabled = usePreviewEnabled();
  return <div className="setting-row"><div className="setting-copy"><div>
    <strong>{t('Video previews')}</strong>
    <p>{t('Play video previews when hovering over or focusing a card. Saved in this browser.')}</p>
  </div></div>
    <Switch aria-label={t('Video previews')} isSelected={enabled} onChange={savePreviewEnabled}>
      <Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content>
    </Switch>
  </div>;
}
