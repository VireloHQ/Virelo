import { useCallback,useEffect,useRef,useState } from 'react';
import type { IptvCheckResult } from '@virelo/core/iptv';

type CheckChannel=(source:string,index:number,signal:AbortSignal)=>Promise<IptvCheckResult>;
type CheckProgress={source:string;indexes:ReadonlySet<number>;completed:number;total:number};
const noPending:ReadonlySet<number>=new Set();

export function useIptvChecks(source:string|undefined,check:CheckChannel,publishResults:(source:string,results:ReadonlyMap<number,IptvCheckResult>)=>void) {
  const job=useRef<{source:string;finish:(keepResults:boolean)=>void}|null>(null);
  const [pending,setPending]=useState<CheckProgress|null>(null);
  useEffect(()=>()=>{
    if(job.current?.source===source)job.current?.finish(false);
  },[source]);
  function cancel() {
    if(job.current)job.current.finish(true);
    else setPending(null);
  }
  const run=useCallback(async (indices:readonly number[])=>{
    if(!source||job.current||!indices.length)return;
    const batch=[...new Set(indices)];
    const controller=new AbortController();
    const active=new Set<number>(),buffered=new Map<number,IptvCheckResult>();
    let next=0,nextStart=0,completed=0,timer:number|undefined;
    const publish=(finished=false)=>{
      if(buffered.size){
        const updates=new Map(buffered);
        buffered.clear();
        publishResults(source,updates);
      }
      setPending(finished?null:{source,indexes:new Set(active),completed,total:batch.length});
    };
    const schedulePublish=()=>{
      // Batch updates so a long queue doesn't render or copy its entire result set per request.
      timer??=window.setTimeout(()=>{timer=undefined;publish();},200);
    };
    const current={source,finish(keepResults:boolean){
      controller.abort();
      if(timer!==undefined)window.clearTimeout(timer);
      job.current=null;
      if(keepResults)publish(true);
    }};
    job.current=current;
    publish();
    await Promise.all(Array.from({length:Math.min(3,batch.length)},async()=>{
      while(!controller.signal.aborted&&next<batch.length){
        const index=batch[next++];
        const now=performance.now(),start=Math.max(nextStart,now);
        nextStart=start+100;
        if(start>now)await new Promise<void>(resolve=>window.setTimeout(resolve,start-now));
        if(controller.signal.aborted)return;
        active.add(index);
        schedulePublish();
        let result:IptvCheckResult;
        try{result=await check(source,index,controller.signal);}
        catch{result={status:'unconfirmed'};}
        if(controller.signal.aborted)return;
        active.delete(index);
        buffered.set(index,result);
        completed++;
        schedulePublish();
      }
    }));
    if(job.current===current)current.finish(true);
  },[source,check,publishResults]);
  const progress=pending?.source===source?pending:null;
  return {
    checking:progress?.indexes??noPending,
    running:Boolean(progress),progress,run,cancel
  };
}
