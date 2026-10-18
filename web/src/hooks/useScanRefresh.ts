import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

export function useScanRefresh(){
  const client=useQueryClient();
  const scan=useQuery({queryKey:['scan'],queryFn:api.scanStatus,refetchInterval:query=>query.state.data?.running?1000:5000});
  const finishedAt=scan.data?.finishedAt;
  const lastFinished=useRef<number|null>(null);
  useEffect(()=>{
    if(!finishedAt||lastFinished.current===finishedAt)return;
    lastFinished.current=finishedAt;
    void client.invalidateQueries({predicate:query=>['home','media','folders','favorites','shorts','search','watch-queue','queue','related','data-usage'].includes(String(query.queryKey[0]))});
  },[client,finishedAt]);
}
