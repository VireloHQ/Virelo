/** Curated shelves from local history and metadata; no external recommendation service. */
export interface HomeMedia {
  id:number; library_id:number; title:string; kind:string; series_title:string|null;
  season:number|null; episode:number|null; duration:number|null; width:number|null; height:number|null;
  genres:string|null; added_at:number; updated_at:number; liked?:number;
  progress_position?:number; progress_duration?:number; progress_completed?:number; progress_updated_at?:number;
}
export function mediaGenres(value:string|null):string[] {
  if (!value) return [];
  let genres:unknown;
  try { genres=JSON.parse(value); } catch { genres=value.startsWith('[') ? [] : value.split(','); }
  if (!Array.isArray(genres)) genres=typeof genres==='string' ? [genres] : [];
  return [...new Set((genres as unknown[]).filter((g):g is string=>typeof g==='string').map(g=>g.trim()).filter(Boolean))];
}
const seriesKey=(item:HomeMedia)=>item.kind==='series'&&item.series_title
  ? JSON.stringify([item.library_id,item.series_title.trim().toLocaleLowerCase()]) : 'item:'+item.id;
const portrait=(item:HomeMedia)=>Boolean(item.width&&item.height&&item.height>item.width);
const completed=(item:HomeMedia)=>Boolean(item.progress_completed) ||
  Boolean((item.progress_duration||item.duration)&& (item.progress_position||0)/(item.progress_duration||item.duration!)>=.92);
const started=(item:HomeMedia)=>completed(item)||(item.progress_position||0)>10;
/** Keep the general movie shelf complementary to the chronological Recent shelf. */
export function moviesOutsideRecent<T extends HomeMedia>(movies:T[],recent:HomeMedia[]):T[] {
  const recentIds=new Set(recent.map(item=>item.id));
  return movies.filter(item=>!recentIds.has(item.id));
}
/** A different order or episode from the same show is not a different collection. */
export function distinctDiscoveryShelves<T extends HomeMedia>(recent:T[],shelves:T[][]):T[][] {
  const signature=(items:T[])=>JSON.stringify([...new Set(items.map(seriesKey))].sort());
  const seen=new Set<string>(recent.length?[signature(recent)]:[]);
  return shelves.map(items=>{
    if(!items.length)return items;
    const key=signature(items);
    if(seen.has(key))return [];
    seen.add(key);return items;
  });
}
function uniqueTitles<T extends HomeMedia>(items:T[],limit=24):T[] {
  const seen=new Set<string>(),result:T[]=[];
  for (const item of items) {const key=seriesKey(item);if(seen.has(key))continue;seen.add(key);result.push(item);if(result.length===limit)break;}
  return result;
}
function rank(id:number,day:number) {
  let n=(id^day)>>>0;n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);return (n^(n>>>16))>>>0;
}
export function buildHome<T extends HomeMedia>(items:T[],now=Date.now()) {
  const newest=[...items].sort((a,b)=>b.added_at-a.added_at||b.id-a.id);
  const watchable=newest.filter(item=>!portrait(item));
  const recent=uniqueTitles(newest);
  const movieItems=watchable.filter(item=>item.kind==='movie');
  const recentIds=new Set(recent.map(item=>item.id));
  // Choose older candidates before bounding the payload; filtering an already
  // truncated newest-movies list would leave the discovery shelf empty.
  const movies=[...moviesOutsideRecent(movieItems,recent),...movieItems.filter(item=>recentIds.has(item.id))].slice(0,24);
  const groups=new Map<string,T[]>();
  for(const item of watchable)if(item.kind==='series'){const key=seriesKey(item);const group=groups.get(key);if(group)group.push(item);else groups.set(key,[item]);}
  const episodeOrder=(a:T,b:T)=>(a.season??Infinity)-(b.season??Infinity)||(a.episode??Infinity)-(b.episode??Infinity)||a.id-b.id;
  const shows:T[]=[],nextEpisodes:T[]=[],startedShows=new Set<string>();
  for(const [key,group] of groups){
    group.sort(episodeOrder);
    if(group.some(started))startedShows.add(key);
    const partial=group.filter(item=>!completed(item)&&(item.progress_position||0)>10)
      .sort((a,b)=>(b.progress_updated_at??b.updated_at)-(a.progress_updated_at??a.updated_at));
    const numbered=group.filter(item=>(item.season??0)>0&&(item.episode??0)>0);
    const lastCompleted=numbered.reduce((last,item,index)=>completed(item)?index:last,-1);
    const next=lastCompleted<0?undefined:numbered.slice(lastCompleted+1).find(item=>!completed(item));
    shows.push(partial[0]??next??group.find(item=>!completed(item))??group[0]);
    if(next&&!partial.length)nextEpisodes.push(next);
  }
  shows.sort((a,b)=>b.added_at-a.added_at||a.id-b.id);
  nextEpisodes.sort((a,b)=>(b.progress_updated_at??b.updated_at)-(a.progress_updated_at??a.updated_at)||a.id-b.id);
  const discovery=[...watchable.filter(item=>item.kind!=='series'),...shows];
  const fresh=uniqueTitles(discovery.filter(item=>!started(item)&&!startedShows.has(seriesKey(item))),Math.max(1,watchable.length))
    .sort((a,b)=>rank(a.id,Math.floor(now/86400000))-rank(b.id,Math.floor(now/86400000))||a.id-b.id).slice(0,24);
  const genreGroups=new Map<string,{name:string;items:T[];weight:number}>();
  for(const item of discovery)for(const genre of mediaGenres(item.genres)){
    const key=genre.toLocaleLowerCase();const group=genreGroups.get(key)??{name:genre,items:[],weight:0};
    group.items.push(item);group.weight+=item.liked?3:started(item)?2:1;genreGroups.set(key,group);
  }
  return {
    total:items.length,
    recent,
    continueWatching:uniqueTitles(items.filter(item=>(item.progress_position||0)>10&&!completed(item))
      .sort((a,b)=>(b.progress_updated_at??b.updated_at)-(a.progress_updated_at??a.updated_at)),20),
    favorites:newest.filter(item=>item.liked).slice(0,24),
    movies,
    series:shows.slice(0,24),
    nextEpisodes:nextEpisodes.slice(0,12),
    unwatched:fresh,
    quickWatches:watchable.filter(item=>item.kind==='movie'&&!started(item)&&(item.duration||0)>=60&&(item.duration||0)<=5400).slice(0,24),
    genres:[...genreGroups.values()].filter(group=>group.items.length>=3)
      .sort((a,b)=>b.weight-a.weight||a.name.localeCompare(b.name)).slice(0,4).map(({name,items})=>({name,items:items.slice(0,24)}))
  };
}
