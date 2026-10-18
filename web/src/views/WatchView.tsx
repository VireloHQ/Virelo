import { PageSkeleton } from '../components/PageSkeleton';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft } from '@phosphor-icons/react';
import { api } from '../api';
import { PlaybackQueue } from '../components/PlaybackQueue';
import { Player } from '../components/Player';
import { queueDestination, type RepeatMode } from '../utils/playback-repeat';
import { loadFavoriteQueue } from '../utils/favorites';

export function WatchView(){
  const { mediaId } = useParams({from:'/watch/$mediaId'});
  const searchParams = useSearch({from:'/watch/$mediaId'});
  const queueEnabled = Boolean(searchParams.queue);
  const settingsQ = useQuery({queryKey:['settings'],queryFn:api.settings});
  const behavior = settingsQ.data?.queueBehavior ?? 'auto';
  const [repeatOverride,setRepeatOverride]=useState<RepeatMode|null>(null);
  const repeat=repeatOverride??(behavior==='loop'?'queue':'off');
  const queueQ = useQuery({
    queryKey:['watch-queue',searchParams],
    queryFn:()=>searchParams.favorites
      ? loadFavoriteQueue((offset,limit)=>api.media({liked:1,search:searchParams.search,sort:searchParams.sort,offset,limit}))
      : api.media({search:searchParams.search,folder:searchParams.folder,libraryId:searchParams.libraryId,sort:searchParams.sort,limit:500}),
    enabled:queueEnabled
  });
  const itemQ = useQuery({queryKey:['media',Number(mediaId)],queryFn:()=>api.mediaById(Number(mediaId)),enabled:!queueEnabled});
  const items = queueEnabled ? (queueQ.data ?? []) : [];
  const [selectedId,setSelectedId] = useState(Number(mediaId));
  const setIndex=(index:number)=>setSelectedId(items[index]?.id ?? Number(mediaId));
  useEffect(()=>{
    setSelectedId(Number(mediaId));
  },[queueEnabled,mediaId,searchParams.search,searchParams.folder,searchParams.libraryId,searchParams.sort,searchParams.favorites]);

  if (queueEnabled) {
    if (queueQ.isError) return <div className="watch-empty" role="alert"><h1>Could not load queue</h1><p>{queueQ.error.message}</p><button onClick={()=>void queueQ.refetch()}>Try again</button></div>;
    if (!queueQ.data) return <PageSkeleton kind="watch" />;
    const activeIndex=Math.max(items.findIndex((item)=>item.id===selectedId),0);
    const current = items[activeIndex];
    if (!current) return <div className="watch-empty"><h1>No media in this folder</h1><p>The current filter matches no videos.</p></div>;
    const wraps=repeat==='queue';
    const canGoPrevious=items.length>1&&(activeIndex>0||wraps);
    const canGoNext=items.length>1&&(activeIndex<items.length-1||wraps);
    const selectIndex=(target:number)=>{
      if(target<0){if(wraps)setIndex(items.length-1);return;}
      if(target>=items.length){if(wraps)setIndex(0);return;}
      setIndex(target);
    };
    const advance=(dir:1|-1)=>{const next=queueDestination(activeIndex,items.length,dir,repeat);if(next!==null)setIndex(next);};
    const handleEnded=()=>{
      const next=queueDestination(activeIndex,items.length,1,repeat,true,behavior!=='manual');
      if(next!==null)setIndex(next);
    };
    return <div className="watch-view">
      <button className="watch-back" onClick={()=>history.back()} aria-label="Back"><ArrowLeft/></button>
      <Player item={current} queue={items} queueIndex={activeIndex} onEnded={handleEnded} onNext={()=>advance(1)} onPrev={()=>advance(-1)} canGoNext={canGoNext} canGoPrev={canGoPrevious} repeatMode={repeat} onRepeatChange={setRepeatOverride} autoPlay/>
      <PlaybackQueue items={items} activeIndex={activeIndex} repeatMode={repeat} onRepeatChange={setRepeatOverride} onSelect={selectIndex}/>
      <div className="watch-copy">
        <h1>{current.title}</h1>
        <p className="watch-description">{current.overview||current.filename}</p>
      </div>
    </div>;
  }
  if (itemQ.isError) return <div className="watch-empty"><h1>Video unavailable</h1><p>{itemQ.error.message}</p><button onClick={()=>void itemQ.refetch()}>Try again</button></div>;
  if (itemQ.isLoading || !itemQ.data) return <PageSkeleton kind="watch" />;
  return <div className="watch-view"><button className="watch-back" onClick={()=>history.back()} aria-label="Back"><ArrowLeft/></button><Player item={itemQ.data} autoPlay/><div className="watch-copy"><h1>{itemQ.data.title}</h1><p>{itemQ.data.overview||itemQ.data.filename}</p></div></div>;
}
