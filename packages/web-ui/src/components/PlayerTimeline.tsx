import { t } from '@edition/i18n';
import type { CSSProperties } from 'react';

export interface TimelineProps {
  current: number; duration: number; rolling?: boolean; atLiveEdge?: boolean;
  onSeek: (position: number) => void;
}

export function PlayerTimeline({current, duration, rolling = false, atLiveEdge = false, onSeek, compact = false}: TimelineProps & {compact?: boolean}) {
  const live = rolling && (atLiveEdge || duration <= 0);
  const remaining = playerTime(Math.max(0, duration - current));
  const rangeMax = duration > 0 ? duration : 1;
  const position = live ? rangeMax : duration > 0 ? Math.max(0, Math.min(current, rangeMax)) : 0;
  const progress = position / rangeMax * 100;
  return <div className={compact ? 'player-timeline miniplayer-timeline' : 'player-timeline'}>
    <span className="player-time" aria-label={rolling?undefined:t("Elapsed time")}>{rolling ? live ? (compact ? t("Live") : '—') : `−${remaining}` : compact ? `${playerTime(current)} / ${playerTime(duration)}` : playerTime(current)}</span>
    <input className="player-seek" style={{ '--range-fill': progress + '%' } as CSSProperties} aria-label={t("Seek")}
      aria-valuetext={rolling ? live ? t("Live") : t("{value0} behind live",{value0:remaining}) : t('{value0} of {value1}',{value0:playerTime(current),value1:playerTime(duration)})}
      type="range" min={0} max={rangeMax} step={.1}
      disabled={duration <= 0} value={position} onChange={event => onSeek(Number(event.currentTarget.value))}
      onKeyDown={event => {
        const value = live ? current : Number(event.currentTarget.value), step = event.shiftKey ? 30 : 5;
        const target = event.key === 'ArrowLeft' ? value - step : event.key === 'ArrowRight' ? value + step
          : event.key === 'Home' ? 0 : event.key === 'End' ? duration : null;
        if (target !== null) { event.preventDefault(); onSeek(Math.max(0, Math.min(duration, target))); }
      }}/>
    {!compact && (rolling ? <span className="player-time">{t("Live")}</span>
      : <span className="player-time player-time-remaining" aria-label={t("Remaining time")} title={t("Remaining time")}>{remaining}</span>)}
  </div>;
}

function playerTime(value: number) {
  const total = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0, seconds = total % 60, minutes = Math.floor(total / 60) % 60, hours = Math.floor(total / 3600);
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : `${minutes}:${String(seconds).padStart(2, '0')}`;
}
