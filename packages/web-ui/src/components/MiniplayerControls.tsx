import { ArrowsOutSimple, CaretDown, Pause, Play, X } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { usePlaybackDock } from './PlaybackDock';

export function MinimizePlayerButton() {
  useLocale();
  const dock = usePlaybackDock();
  if (!dock?.started || dock.minimized) return null;
  const label = t("Minimize player");
  return <button type="button" aria-label={label} title={label} onClick={dock.minimize}><CaretDown aria-hidden="true"/></button>;
}

export function MiniplayerControls({title,paused,onToggle}: {title:string;paused:boolean;onToggle:()=>void}) {
  useLocale();
  const dock = usePlaybackDock();
  if (!dock) return null;
  return <div className="miniplayer-controls" role="group" aria-label={t("Miniplayer")} onDoubleClick={event=>event.stopPropagation()}>
    <button type="button" aria-label={t(paused ? "Play" : "Pause")} onClick={onToggle}>
      {paused ? <Play weight="fill" aria-hidden="true"/> : <Pause weight="fill" aria-hidden="true"/>}
    </button>
    <span title={title}>{title}</span>
    <button type="button" aria-label={t("Expand player")} title={t("Expand player")} onClick={dock.restore}><ArrowsOutSimple aria-hidden="true"/></button>
    <button type="button" aria-label={t("Close miniplayer")} title={t("Close miniplayer")} onClick={dock.close}><X aria-hidden="true"/></button>
  </div>;
}
