import { useSyncExternalStore } from 'react';
import { Switch } from '@heroui/react';
import { readLevelingPreference,saveLevelingPreference,subscribeLeveling,canLevelAudio } from '../utils/volume-leveling';

export function VolumeLevelingSetting(){
  const enabled=useSyncExternalStore(subscribeLeveling,readLevelingPreference);
  const supported=canLevelAudio();
  return <div className="setting-row"><div className="setting-copy"><div><strong>Volume leveling</strong><p>Smooth out volume differences between videos during playback. Applies to normal videos and Shorts on this device. No pre-scan or original-file changes. This is live leveling, not whole-file integrated LUFS normalization.</p>
    {!supported&&<p className="account-notice">Unavailable in this browser. Original audio is used to avoid native HLS audio-routing issues.</p>}</div></div>
    <Switch aria-label="Volume leveling" isSelected={enabled&&supported} isDisabled={!supported} onChange={saveLevelingPreference}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch>
  </div>;
}
