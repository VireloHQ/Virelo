import { t, useLocale } from '../i18n';
import { useSyncExternalStore } from 'react';
import { Switch } from '@heroui/react';
import { readLevelingPreference,saveLevelingPreference,subscribeLeveling,canLevelAudio } from '../utils/volume-leveling';

export function VolumeLevelingSetting(){
  useLocale();
  const enabled=useSyncExternalStore(subscribeLeveling,readLevelingPreference);
  const supported=canLevelAudio();
  return <div className="setting-row"><div className="setting-copy"><div><strong>{t("Volume leveling")}</strong><p>{t("Keep volume consistent across videos and Shorts.")}</p>
    {!supported&&<p className="account-notice">{t("Unavailable in this browser.")}</p>}</div></div>
    <Switch aria-label={t("Volume leveling")} isSelected={enabled&&supported} isDisabled={!supported} onChange={saveLevelingPreference}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch>
  </div>;
}
