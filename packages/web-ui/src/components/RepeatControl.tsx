import { t, useLocale } from '@edition/i18n';
import { nextRepeatMode, repeatLabels, type RepeatMode } from '@virelo/core/playback-repeat';
import { Repeat, RepeatOnce } from '@phosphor-icons/react';

export function RepeatControl({mode,hasQueue,onChange,queueOnly=false}:{
  mode:RepeatMode;hasQueue:boolean;onChange:(mode:RepeatMode)=>void;queueOnly?:boolean;
}) {
  useLocale();
  const active=queueOnly?mode==='queue':mode!=='off';
  const next=queueOnly?(mode==='queue'?'off':'queue'):nextRepeatMode(mode,hasQueue);
  const state=active?(queueOnly?'queue':mode):'off';
  return <div className="repeat-control">
    <button type="button" className={active?'active':''} data-repeat-mode={state}
      aria-label={queueOnly?t("Repeat queue"):t("Repeat")} aria-pressed={active}
      title={queueOnly?t("Repeat queue"):`${t(repeatLabels[mode])} · ${t(repeatLabels[next])}`}
      onClick={()=>onChange(next)}>
      <span className="repeat-button-face" aria-hidden="true">{state==='one'?<RepeatOnce className="repeat-icon"/>:<Repeat className="repeat-icon"/>}</span>
      <span className="sr-only">{queueOnly?t("Repeat queue"):t(repeatLabels[mode])}</span>
    </button>
  </div>;
}
