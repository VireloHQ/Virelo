export function needsSeekWindow(position:number,windowStart:number,seekable:Pick<TimeRanges,'length'|'start'|'end'>){
  if(position<windowStart)return true;
  for(let index=0;index<seekable.length;index++){
    if(position>=seekable.start(index)&&position<=seekable.end(index)-.15)return false;
  }
  return true;
}
