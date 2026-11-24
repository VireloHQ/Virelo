import { useEffect,useRef,useState } from 'react';
import type { IptvCheckResult } from '@virelo/core/iptv';

type CheckChannel=(source:string,index:number,signal:AbortSignal)=>Promise<IptvCheckResult>;
const noResults:ReadonlyMap<number,IptvCheckResult>=new Map();
const noPending:ReadonlySet<number>=new Set();

export function useIptvChecks(source:string|undefined,check:CheckChannel) {
  const job=useRef<{source:string;controller:AbortController}|null>(null);
  const [results,setResults]=useState<{source:string;entries:ReadonlyMap<number,IptvCheckResult>}|null>(null);
  const [pending,setPending]=useState<{source:string;indexes:ReadonlySet<number>}|null>(null);
  useEffect(()=>()=>{
    if(job.current&&job.current.source===source){job.current.controller.abort();job.current=null;}
  },[source]);
  function cancel() {
    job.current?.controller.abort();
    job.current=null;
    setPending(null);
  }
  async function run(indices:number[]) {
    if(!source||job.current||!indices.length)return;
    const batch=[...new Set(indices)].slice(0,12);
    const controller=new AbortController();
    job.current={source,controller};
    setPending({source,indexes:new Set(batch)});
    let next=0;
    await Promise.all(Array.from({length:Math.min(3,batch.length)},async()=>{
      while(!controller.signal.aborted&&next<batch.length){
        const index=batch[next++];
        let result:IptvCheckResult;
        try{result=await check(source,index,controller.signal);}
        catch{result={status:'unconfirmed'};}
        if(controller.signal.aborted)return;
        setResults(previous=>{
          const entries=new Map(previous?.source===source?previous.entries:noResults);
          entries.set(index,result);
          return {source,entries};
        });
        setPending(previous=>{
          if(previous?.source!==source)return previous;
          const indexes=new Set(previous.indexes);
          indexes.delete(index);
          return {source,indexes};
        });
      }
    }));
    if(job.current?.controller===controller){job.current=null;setPending(null);}
  }
  return {
    results:results?.source===source?results?.entries??noResults:noResults,
    checking:pending?.source===source?pending?.indexes??noPending:noPending,
    running:Boolean(pending&&pending.source===source),run,cancel
  };
}
