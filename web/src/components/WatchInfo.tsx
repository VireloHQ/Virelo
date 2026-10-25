import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CaretDown, FileVideo, Folder } from '@phosphor-icons/react';
import { api } from '../api';
import type { MediaItem } from '../types';
import { FavoriteButton } from './FavoriteButton';
import { MediaRow } from './MediaRow';
import './WatchInfo.css';

export function WatchInfo({ item, actions, children }: { item: MediaItem; actions: ReactNode; children?: ReactNode }) {
  const overview=item.overview?.trim();
  const genres=Array.from(new Set((item.genres??'').split(',').map(value=>value.trim()).filter(Boolean)));
  const episode = [item.season != null ? 'Season '+item.season : '', item.episode != null ? 'Episode '+item.episode : ''].filter(Boolean);
  const facts = [
    ['Format',item.container?.toUpperCase()],
    ['Video',item.video_codec?.toUpperCase()],
    ['Audio',item.audio_codec?.toUpperCase()],
    ['Size',item.size > 0 ? fileSize(item.size) : null]
  ].filter((fact): fact is [string,string] => Boolean(fact[1]));
  return <section className="watch-copy watch-info" aria-label="Video information">
      <div className="watch-info-heading">
        <div className="watch-info-identity">
          {item.series_title && item.series_title!==item.title && <p className="watch-series">{item.series_title}</p>}
          <h1>{item.title}</h1>
          <ul className="watch-facts" aria-label="Video details">
            {item.year != null && <li>{item.year}</li>}
            {episode.map(value=><li key={value}>{value}</li>)}
            {item.duration != null && item.duration > 0 && <li>{runtime(item.duration)}</li>}
            {item.height != null && item.height > 0 && <li>{item.height>=2160?'4K':item.height+'p'}</li>}
          </ul>
        </div>
        <div className="watch-info-actions"><FavoriteButton item={item}/>{actions}</div>
      </div>
      <div className="watch-info-body">
        {(overview || genres.length>0) && <div className="watch-editorial">
          {overview && <p className="watch-overview">{overview}</p>}
          {genres.length>0 && <ul className="watch-genres" aria-label="Genres">{genres.map(genre=><li key={genre}>{genre}</li>)}</ul>}
        </div>}
        <details key={item.id} className="watch-file-details" open={!overview}>
          <summary><FileVideo aria-hidden="true"/><span>File details</span><CaretDown aria-hidden="true"/></summary>
          <dl><div className="watch-source-file"><dt>File</dt><dd>{item.filename}</dd></div>{facts.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
          {item.folder && <p className="watch-source-folder"><Folder aria-hidden="true"/>{item.folder}</p>}
        </details>
      </div>
      {children}
    </section>;
}

export function WatchRecommendations({item}:{item:MediaItem}) {
  const related=useQuery({queryKey:['related',item.series_title,item.kind],
    queryFn:()=>api.media(item.series_title?{search:item.series_title,limit:50}:{kind:item.kind,limit:24})});
  const suggestions=related.data?.filter(media=>media.id!==item.id).slice(0,12)??[];
  return suggestions.length>0?<div className="watch-related"><MediaRow title={item.series_title?'More episodes':'More in your library'} items={suggestions}/></div>:null;
}

function runtime(seconds:number) {
  const total=Math.floor(seconds),hours=Math.floor(total/3600),minutes=Math.floor(total%3600/60);
  return hours ? hours+'h '+minutes+'m' : minutes ? minutes+'m' : total+'s';
}
function fileSize(bytes:number) {
  return bytes>=1_000_000_000 ? (bytes/1_000_000_000).toFixed(1)+' GB' : bytes>=1_000_000 ? (bytes/1_000_000).toFixed(1)+' MB' : Math.ceil(bytes/1000)+' KB';
}
