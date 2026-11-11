// A seek window is encoded from the requested time, not from the start of a film.
// GAP entries retain the film's absolute timeline without advertising missing
// media as downloadable segments. HLS clients normalize the first real fragment
// to its playlist position, so captions/progress keep using absolute seconds.
export function seekWindowStart(value:number|undefined){
  if(value!==undefined&&(!Number.isFinite(value)||value<0||!Number.isSafeInteger(Math.floor(value))))throw new RangeError('Invalid seek position.');
  return value===undefined?0:Math.floor(value);
}

export function seekWindowPlaylist(content:string,startTime:number){
  if(startTime<=0)return content;
  const target=Number(content.match(/#EXT-X-TARGETDURATION:(\d+)/)?.[1])||2;
  const gaps:string[]=[];
  for(let time=0,index=0;time<startTime;time+=target,index++){
    gaps.push(`#EXTINF:${Math.min(target,startTime-time).toFixed(6)},`,'#EXT-X-GAP',`gap-${index}.ts`);
  }
  const lines=content.split(/\r?\n/).filter(line=>!line.startsWith('#EXT-X-START:'));
  const firstSegment=lines.findIndex(line=>line.startsWith('#EXTINF:'));
  if(firstSegment<0)return content;
  lines.splice(firstSegment,0,`#EXT-X-START:TIME-OFFSET=${startTime},PRECISE=YES`,...gaps);
  return lines.join('\n');
}
