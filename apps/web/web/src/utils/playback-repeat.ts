export type RepeatMode = 'off' | 'one' | 'queue';

export const repeatLabels: Record<RepeatMode,string> = { off:'Repeat off', one:'Repeat video', queue:'Repeat queue' };

export function nextRepeatMode(mode: RepeatMode, hasQueue: boolean): RepeatMode {
  return mode === 'off' ? 'one' : mode === 'one' && hasQueue ? 'queue' : 'off';
}

// Repeat-one is handled by the media element; it must never advance the queue.
export function queueDestination(index:number, count:number, direction:1|-1, mode:RepeatMode, ended=false, automatic=true):number|null {
  if(count<1 || index<0 || index>=count)return null;
  if(ended && (mode==='one' || (!automatic && mode!=='queue')))return null;
  const next=index+direction;
  if(next>=0 && next<count)return next;
  return mode==='queue' ? (next+count)%count : null;
}
