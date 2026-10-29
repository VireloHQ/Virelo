import { useState } from 'react';
import { Queue } from '@phosphor-icons/react';
import type { PlaylistSummary } from '../types';

export function PlaylistArtwork({playlist}:{playlist:PlaylistSummary}) {
  const url=playlist.cover?.url;
  const [failed,setFailed]=useState<string|null>(null);
  return <span className="playlist-artwork" aria-hidden="true">
    <Queue/>
    {url&&failed!==url&&<img src={url} alt="" loading="lazy" decoding="async" onError={()=>setFailed(url)}/>}
  </span>;
}

