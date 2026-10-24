import { useId, type CSSProperties } from 'react';
import { ArrowsIn, ArrowsOut, ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { DEFAULT_VIDEO_PRESENTATION, type VideoPresentation } from '../utils/video-presentation';

export function VideoSettingsPanel({settings,onChange,onReset}:{
  settings: Readonly<VideoPresentation>;
  onChange: (patch: Partial<VideoPresentation>) => void;
  onReset: () => void;
}) {
  const id=useId();
  const changed=Object.entries(DEFAULT_VIDEO_PRESENTATION).some(([key,value])=>settings[key as keyof VideoPresentation]!==value);
  return (
      <div className="video-settings-content">
        <div className="video-settings-fit" role="group" aria-label="Video fit">
          <button type="button" aria-pressed={settings.fit === 'contain'} onClick={() => onChange({ fit: 'contain' })}><ArrowsIn />Fit</button>
          <button type="button" aria-pressed={settings.fit === 'cover'} onClick={() => onChange({ fit: 'cover' })}><ArrowsOut />Fill</button>
        </div>
        <p className="video-settings-hint">{settings.fit === 'cover' ? 'Crop the edges to fill the player.' : 'Show the entire frame without cropping.'} Quality stays unchanged.</p>
        <div className="video-settings-rotation"><span>Rotation</span><div>
          <button type="button" aria-label="Rotate counterclockwise" onClick={() => onChange({ rotation: settings.rotation - 90 })}><ArrowCounterClockwise /></button>
          <output aria-label="Rotation" aria-live="polite">{settings.rotation}°</output>
          <button type="button" aria-label="Rotate clockwise" onClick={() => onChange({ rotation: settings.rotation + 90 })}><ArrowClockwise /></button>
        </div></div>
        {(['brightness', 'contrast', 'saturation'] as const).map(key => <div className="video-settings-adjustment" key={key}>
          <label htmlFor={id + '-' + key}>{key === 'brightness' ? 'Brightness' : key === 'contrast' ? 'Contrast' : 'Saturation'}</label>
          <output htmlFor={id + '-' + key}>{settings[key]}%</output>
          <input id={id + '-' + key} type="range" min="0" max="200" step="1" value={settings[key]}
            aria-valuetext={settings[key] + '%'}
            style={{ '--range-fill': settings[key] / 2 + '%' } as CSSProperties} onChange={event => onChange({ [key]: Number(event.target.value) })} />
        </div>)}
        <button className="video-settings-reset" type="button" disabled={!changed} onClick={event=>{
          onReset();
          event.currentTarget.closest('.video-settings-content')?.querySelector<HTMLButtonElement>('.video-settings-fit button')?.focus({preventScroll:true});
        }}><ArrowCounterClockwise />Reset adjustments</button>
        <p className="video-settings-hint">Resets for each video. Picture in Picture uses the original view.</p>
      </div>
  );
}
