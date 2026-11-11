import { Trans } from '../i18n/Trans';
import { formatDuration } from '../i18n/format';
import { t, useLocale } from '../i18n';
import { PageSkeleton } from '../components/PageSkeleton';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from '@tanstack/react-router';
import { Button } from '@heroui/react';
import { ArrowLeft, Play } from '@phosphor-icons/react';
import { api, artwork } from '../api';
import { FavoriteButton } from '../components/FavoriteButton';
import { SavePlaylist } from '../components/SavePlaylist';
import { ShareButton } from '../components/ShareButton';
import { MediaRow } from '../components/MediaRow';

export function DetailView() {
  useLocale();
  const {mediaId} = useParams({from:'/app/title/$mediaId'});
  const id = Number(mediaId);
  const navigate = useNavigate();
  const {data:item,isLoading,error:loadError,refetch} = useQuery({queryKey:['media',id],queryFn:()=>api.mediaById(id)});
  const thumbnail=useQuery({queryKey:['thumbnail',id,item?.size,item?.mtime],queryFn:()=>api.thumbnail(id),enabled:Boolean(item),staleTime:Infinity,retry:false});
  const related = useQuery({
    queryKey:['related',item?.series_title,item?.kind],
    queryFn:()=>api.media(item?.series_title ? {search:item.series_title,limit:50} : {kind:item?.kind,limit:24}),
    enabled:Boolean(item)
  });
  if (loadError) return <div className="watch-empty"><h1>{t("Video unavailable")}</h1><p>{t(loadError.message)}</p><Button variant="secondary" onPress={()=>void refetch()}>{t("Try again")}</Button></div>;
  if (isLoading || !item) return <PageSkeleton kind="detail" />;
  const isPortrait = Boolean(item.width && item.height && item.height > item.width);
  const landscapeThumb = !isPortrait && !(item.external_id && item.poster_path);
  const resolved={...item,thumbnail_path:thumbnail.data===undefined?item.thumbnail_path:thumbnail.data};
  const backdrop=artwork(resolved,item.backdrop_path?'backdrop':'thumbnail');
  const poster=artwork(resolved,item.poster_path?'poster':'thumbnail');
  return <article className="detail-view">
    <div className="detail-backdrop"><img key={backdrop} src={backdrop} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}/><div/></div>
    <div className="detail-wrap">
      <Button isIconOnly variant="secondary" aria-label={t("Back")} onPress={()=>history.back()} className="detail-back"><ArrowLeft/></Button>
      <div className="detail-main">
        <div className={`detail-poster ${landscapeThumb?'landscape-thumb':''}`}><img key={poster} src={poster} alt="" onError={(e)=>{e.currentTarget.style.display='none';}}/></div>
        <div className="detail-copy">
          <h1>{item.title}</h1>
          <div className="detail-meta"><span>{item.year || '—'}</span>{item.height && <span><Trans message="{value0}p" values={{value0:item.height}}/></span>}{item.video_codec && <span>{item.video_codec.toUpperCase()}</span>}{item.duration && <span>{formatDuration(item.duration)}</span>}</div>
          {item.overview && <p>{item.overview}</p>}
          {item.genres && <div className="genre-line">{item.genres.split(',').map(g=><span key={g}>{g.trim()}</span>)}</div>}
          <div className="detail-actions"><Button size="lg" onPress={()=>void navigate({to:'/app/watch/$mediaId',params:{mediaId}})}><Play weight="fill"/> {canResume(item) ? t("Resume {value0}", { value0: formatTime(item.progress_position || 0) }) : t("Play")}</Button><FavoriteButton item={item} /></div>
          <dl className="tech-meta"><div><dt>{t("File")}</dt><dd>{item.filename}</dd></div><div><dt>{t("Container")}</dt><dd>{item.container?.toUpperCase() || t("Unknown")}</dd></div><div><dt>{t("Size")}</dt><dd>{formatSize(item.size)}</dd></div></dl>
          <div className="playlist-watch-actions"><SavePlaylist mediaIds={[item.id]}/><ShareButton webOnly/></div>
        </div>
      </div>
      {related.data && <MediaRow title={item.series_title ? t("More episodes") : t("More in your library")} items={related.data.filter(x=>x.id!==item.id).slice(0,20)}/>}
    </div>
  </article>;
}
function canResume(item:{progress_position?:number;progress_completed?:number}){return (item.progress_position || 0) > 10 && !item.progress_completed;}
function formatTime(value:number){const minutes=Math.floor(value/60);const seconds=Math.floor(value%60);return `${minutes}:${String(seconds).padStart(2,'0')}`;}
function formatSize(bytes:number){if(bytes<1024*1024)return `${Math.max(1,Math.round(bytes/1024))} KB`;if(bytes<1024*1024*1024)return `${(bytes/1024/1024).toFixed(1)} MB`;return `${(bytes/1024/1024/1024).toFixed(1)} GB`;}
