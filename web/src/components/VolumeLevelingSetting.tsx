import { useSyncExternalStore } from 'react';
import { Switch } from '@heroui/react';
import { readLevelingPreference,saveLevelingPreference,subscribeLeveling,canLevelAudio } from '../utils/volume-leveling';

export function VolumeLevelingSetting(){
  const enabled=useSyncExternalStore(subscribeLeveling,readLevelingPreference);
  const supported=canLevelAudio();
  return <div className="setting-row"><div className="setting-copy"><div><strong>Volume leveling</strong><p>Keep volume consistent across videos and Shorts.</p>
    {!supported&&<p className="account-notice">Unavailable in this browser. Original audio is used to avoid native HLS audio-routing issues.</p>}</div></div>
    <Switch aria-label="Volume leveling" isSelected={enabled&&supported} isDisabled={!supported} onChange={saveLevelingPreference}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch>
  </div>;
}
