import { ArrowsOutSimple, Pause, Play, X } from '@phosphor-icons/react';
import { t, useLocale } from '@edition/i18n';
import { useAppearance } from '@edition/components/AppearanceProvider';
import { usePlaybackDock } from './PlaybackDock';
import { PlayerTimeline, type TimelineProps } from './PlayerTimeline';
import { useMiniplayerDrag } from '../hooks/useMiniplayerDrag';

export function MiniplayerControls({paused,onToggle,title,subtitle,timeline}: {
  paused:boolean; onToggle:()=>void; title:string; subtitle?:string; timeline:TimelineProps;
}) {
  useLocale();
  const dock = usePlaybackDock();
  const drag=useMiniplayerDrag();
  const style=useAppearance().value.controllerStyle;
  if (!dock) return null;
  return <><div {...drag} className="miniplayer-controls" data-controller-style={style} role="group" tabIndex={0} aria-label={t("Miniplayer")}
    onDoubleClick={event=>event.stopPropagation()}>
    <button className="miniplayer-toggle" type="button" aria-label={t(paused ? "Play" : "Pause")} onClick={onToggle}>
      {paused ? <Play weight="fill" aria-hidden="true"/> : <Pause weight="fill" aria-hidden="true"/>}
    </button>
    <button className="miniplayer-expand" type="button" aria-label={t("Expand player")} title={t("Expand player")} onClick={dock.restore}><ArrowsOutSimple aria-hidden="true"/></button>
    <button className="miniplayer-close" type="button" aria-label={t("Close miniplayer")} title={t("Close miniplayer")} onClick={dock.close}><X aria-hidden="true"/></button>
    <PlayerTimeline compact {...timeline}/>
  </div><div className="miniplayer-meta" data-controller-style={style}>
    <strong title={title}>{title}</strong>
    {subtitle && subtitle!==title && <small title={subtitle}>{subtitle}</small>}
  </div></>;
}
