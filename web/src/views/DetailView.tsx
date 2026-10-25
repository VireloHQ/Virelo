import { PageSkeleton } from '../components/PageSkeleton';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@heroui/react';
import { ArrowLeft, ArrowsClockwise, Play } from '@phosphor-icons/react';
import { api, artwork } from '../api';
import { FavoriteButton } from '../components/FavoriteButton';
import { SavePlaylist } from '../components/SavePlaylist';
import { MediaRow } from '../components/MediaRow';
import { useAccount } from '../components/AccountSession';

export function DetailView() {
  const account = useAccount()?.user;
  const {mediaId} = useParams({from:'/title/$mediaId'});
  const id = Number(mediaId);
  const navigate = useNavigate();
  const client = useQueryClient();
  const {data:item,isLoading,error:loadError,refetch} = useQuery({queryKey:['media',id],queryFn:()=>api.mediaById(id)});
  const {data:settings} = useQuery({queryKey:['settings'],queryFn:api.settings});
  const related = useQuery({
    queryKey:['related',item?.series_title,item?.kind],
    queryFn:()=>api.media(item?.series_title ? {search:item.series_title,limit:50} : {kind:item?.kind,limit:24}),
    enabled:Boolean(item)
  });
  const refresh = useMutation({mutationFn:()=>api.refreshMetadata(id),onSuccess:(media)=>{client.setQueryData(['media',id],media);void client.invalidateQueries({predicate:(query)=>['home','media','related','shorts','watch-queue','queue','search'].includes(String(query.queryKey[0]))});}});
  if (loadError) return <div className="watch-empty"><h1>Video unavailable</h1><p>{loadError.message}</p><Button variant="secondary" onPress={()=>void refetch()}>Try again</Button></div>;
  if (isLoading || !item) return <PageSkeleton kind="detail" />;
  const isPortrait = Boolean(item.width && item.height && item.height > item.width);
  const landscapeThumb = !isPortrait && !item.poster_path;
  return <article className="detail-view">
    <div className="detail-backdrop"><img key={item.metadata_revision ?? 0} src={artwork(item,item.backdrop_path?'backdrop':item.poster_path?'poster':'thumbnail')} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}/><div/></div>
    <div className="detail-wrap">
      <Button isIconOnly variant="secondary" aria-label="Back" onPress={()=>history.back()} className="detail-back"><ArrowLeft/></Button>
      <div className="detail-main">
        <div className={`detail-poster ${landscapeThumb?'landscape-thumb':''}`}><img key={item.metadata_revision ?? 0} src={artwork(item,item.poster_path?'poster':'thumbnail')} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}/></div>
        <div className="detail-copy">
          <h1>{item.title}</h1>
          <div className="detail-meta"><span>{item.year || '—'}</span>{item.height && <span>{item.height}p</span>}{item.video_codec && <span>{item.video_codec.toUpperCase()}</span>}{item.duration && <span>{formatDuration(item.duration)}</span>}</div>
          <p>{item.overview || 'No description available.'}</p>
          {item.genres && <div className="genre-line">{item.genres.split(',').map(g=><span key={g}>{g.trim()}</span>)}</div>}
          <div className="detail-actions"><Button size="lg" isDisabled={account?.permissions.play===false} onPress={()=>void navigate({to:'/watch/$mediaId',params:{mediaId}})}><Play weight="fill"/> {canResume(item) ? `Resume ${formatTime(item.progress_position || 0)}` : 'Play'}</Button><FavoriteButton item={item} />{settings?.externalMetadataEnabled && account?.permissions.manageMetadata && <Button size="lg" variant="secondary" isPending={refresh.isPending} onPress={()=>refresh.mutate()}><ArrowsClockwise/> Fetch metadata</Button>}</div>
          <div className="playlist-watch-actions"><SavePlaylist mediaIds={[item.id]}/></div>
          {refresh.error && <p className="error-copy">{refresh.error.message}</p>}
          <dl className="tech-meta"><div><dt>File</dt><dd>{item.filename}</dd></div><div><dt>Container</dt><dd>{item.container?.toUpperCase() || 'Unknown'}</dd></div><div><dt>Audio</dt><dd>{item.audio_codec?.toUpperCase() || 'Unknown'}</dd></div></dl>
        </div>
      </div>
      {related.data && <MediaRow title={item.series_title ? 'More episodes' : 'More in your library'} items={related.data.filter(x=>x.id!==item.id).slice(0,20)}/>} 
    </div>
  </article>;
}
function formatDuration(seconds:number){const h=Math.floor(seconds/3600);const m=Math.floor((seconds%3600)/60);return h?`${h}h ${m}m`:`${m}m`;}
function canResume(item:{progress_position?:number;progress_completed?:number}){return (item.progress_position || 0) > 10 && !item.progress_completed;}
function formatTime(value:number){const minutes=Math.floor(value/60);const seconds=Math.floor(value%60);return `${minutes}:${String(seconds).padStart(2,'0')}`;}
