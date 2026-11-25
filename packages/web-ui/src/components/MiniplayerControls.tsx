import { ArrowsOutSimple, CaretDown, Pause, Play, X } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { usePlaybackDock } from './PlaybackDock';
import { useMiniplayerDrag } from '../hooks/useMiniplayerDrag';

export function MinimizePlayerButton() {
  useLocale();
  const dock = usePlaybackDock();
  if (!dock?.started || dock.minimized) return null;
  const label = t("Minimize player");
  return <button type="button" aria-label={label} title={label} onClick={dock.minimize}><CaretDown aria-hidden="true"/></button>;
}

export function MiniplayerControls({paused,onToggle}: {paused:boolean;onToggle:()=>void}) {
  useLocale();
  const dock = usePlaybackDock();
  const drag=useMiniplayerDrag();
  if (!dock) return null;
  return <div {...drag} className="miniplayer-controls" role="group" tabIndex={0} aria-label={t("Miniplayer")}
    onDoubleClick={event=>event.stopPropagation()}>
    <button className="miniplayer-toggle" type="button" aria-label={t(paused ? "Play" : "Pause")} onClick={onToggle}>
      {paused ? <Play weight="fill" aria-hidden="true"/> : <Pause weight="fill" aria-hidden="true"/>}
    </button>
    <button className="miniplayer-expand" type="button" aria-label={t("Expand player")} title={t("Expand player")} onClick={dock.restore}><ArrowsOutSimple aria-hidden="true"/></button>
    <button className="miniplayer-close" type="button" aria-label={t("Close miniplayer")} title={t("Close miniplayer")} onClick={dock.close}><X aria-hidden="true"/></button>
  </div>;
}
