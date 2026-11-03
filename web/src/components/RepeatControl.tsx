import { t, useLocale } from '../i18n';
import { nextRepeatMode, repeatLabels, type RepeatMode } from '../utils/playback-repeat';
import repeatAll from '../assets/icons/repeat-all.svg';
import repeatOne from '../assets/icons/repeat-one.svg';
import repeatOff from '../assets/icons/repeat-off.svg';

export function RepeatControl({mode,hasQueue,onChange,queueOnly=false}:{
  mode:RepeatMode;hasQueue:boolean;onChange:(mode:RepeatMode)=>void;queueOnly?:boolean;
}) {
  useLocale();
  const active=queueOnly?mode==='queue':mode!=='off';
  const next=queueOnly?(mode==='queue'?'off':'queue'):nextRepeatMode(mode,hasQueue);
  const icon=!active?repeatOff:!queueOnly&&mode==='one'?repeatOne:repeatAll;
  return <div className="repeat-control">
    <button type="button" className={active?'active':''}
      aria-label={queueOnly?t("Repeat queue"):t("Repeat")} aria-pressed={active}
      title={queueOnly?t("Repeat queue"):`${t(repeatLabels[mode])} · ${t(repeatLabels[next])}`}
      onClick={()=>onChange(next)}>
      <span className="repeat-button-face" aria-hidden="true"><span className="repeat-icon" style={{maskImage:`url("${icon}")`}}/></span>
      <span className="sr-only">{queueOnly?t("Repeat queue"):t(repeatLabels[mode])}</span>
    </button>
  </div>;
}
