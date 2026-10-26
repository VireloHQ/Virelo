import { getLocale } from './runtime';
export function formatDuration(seconds: number) {
  const hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=Math.floor(seconds%60);
  const unit=(value:number,name:'hour'|'minute'|'second')=>new Intl.NumberFormat(getLocale(),{style:'unit',unit:name,unitDisplay:'narrow'}).format(value);
  return hours ? unit(hours,'hour')+' '+unit(minutes,'minute') : minutes ? unit(minutes,'minute') : unit(rest,'second');
}
