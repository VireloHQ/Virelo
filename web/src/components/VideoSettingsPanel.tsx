import { t, useLocale } from '../i18n';
import { useId, type CSSProperties } from 'react';
import { ArrowsIn, ArrowsOut, ArrowCounterClockwise, ArrowClockwise } from '@phosphor-icons/react';
import { DEFAULT_VIDEO_PRESENTATION, type VideoPresentation } from '../utils/video-presentation';

export function VideoSettingsPanel({settings,onChange,onReset}:{
  settings: Readonly<VideoPresentation>;
  onChange: (patch: Partial<VideoPresentation>) => void;
  onReset: () => void;
}) {
  useLocale();
  const id=useId();
  const changed=Object.entries(DEFAULT_VIDEO_PRESENTATION).some(([key,value])=>settings[key as keyof VideoPresentation]!==value);
  return (
      <div className="video-settings-content">
        <div className="video-settings-fit" role="group" aria-label={t("Video fit")}>
          <button type="button" aria-pressed={settings.fit === 'contain'} onClick={() => onChange({ fit: 'contain' })}><ArrowsIn />{t("Fit")}</button>
          <button type="button" aria-pressed={settings.fit === 'cover'} onClick={() => onChange({ fit: 'cover' })}><ArrowsOut />{t("Fill")}</button>
        </div>
        <div className="video-settings-rotation"><span>{t("Rotation")}</span><div>
          <button type="button" aria-label={t("Rotate counterclockwise")} onClick={() => onChange({ rotation: settings.rotation - 90 })}><ArrowCounterClockwise /></button>
          <output aria-label={t("Rotation")} aria-live="polite">{settings.rotation}°</output>
          <button type="button" aria-label={t("Rotate clockwise")} onClick={() => onChange({ rotation: settings.rotation + 90 })}><ArrowClockwise /></button>
        </div></div>
        {(['brightness', 'contrast', 'saturation'] as const).map(key => <div className="video-settings-adjustment" key={key}>
          <label htmlFor={id + '-' + key}>{key === 'brightness' ? t("Brightness") : key === 'contrast' ? t("Contrast") : t("Saturation")}</label>
          <output htmlFor={id + '-' + key}>{settings[key]}%</output>
          <input id={id + '-' + key} type="range" min="0" max="200" step="1" value={settings[key]}
            aria-valuetext={settings[key] + '%'}
            style={{ '--range-fill': settings[key] / 2 + '%' } as CSSProperties} onChange={event => onChange({ [key]: Number(event.target.value) })} />
        </div>)}
        <button className="video-settings-reset" type="button" disabled={!changed} onClick={event=>{
          onReset();
          event.currentTarget.closest('.video-settings-content')?.querySelector<HTMLButtonElement>('.video-settings-fit button')?.focus({preventScroll:true});
        }}><ArrowCounterClockwise />{t("Reset adjustments")}</button>
      </div>
  );
}
