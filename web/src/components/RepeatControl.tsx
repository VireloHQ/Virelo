import { Repeat, RepeatOnce } from '@phosphor-icons/react';
import { nextRepeatMode, repeatLabels, type RepeatMode } from '../utils/playback-repeat';

export function RepeatControl({mode,hasQueue,onChange,queueOnly=false}:{
  mode:RepeatMode;hasQueue:boolean;onChange:(mode:RepeatMode)=>void;queueOnly?:boolean;
}) {
  const active=queueOnly?mode==='queue':mode!=='off';
  const next=queueOnly?(mode==='queue'?'off':'queue'):nextRepeatMode(mode,hasQueue);
  return <div className="repeat-control">
    <button type="button" className={active?'active':''}
      aria-label={queueOnly?'Repeat queue':'Repeat'} aria-pressed={active}
      title={queueOnly?'Repeat queue':`${repeatLabels[mode]} · ${repeatLabels[next]}`}
      onClick={()=>onChange(next)}>
      {!queueOnly&&mode==='one'?<RepeatOnce weight="bold"/>:<Repeat weight={active?'bold':'regular'}/>}
      <span className="sr-only">{queueOnly?'Repeat queue':repeatLabels[mode]}</span>
    </button>
  </div>;
}
