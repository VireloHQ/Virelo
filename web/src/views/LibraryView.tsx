import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonVariants } from '@heroui/react';
import { CaretRight, FolderSimple, MagnifyingGlass, Play, Queue } from '@phosphor-icons/react';
import { api } from '../api';
import { useUIStore } from '../store';
import { MediaCard } from '../components/MediaCard';
import { Select } from '../components/Select';
import { useRowWheel } from '../hooks/useRowWheel';
import type { Library, SortKey } from '../types';

const SORT_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'newest', label: 'Newest' },
  { value: 'oldest', label: 'Oldest' },
  { value: 'year', label: 'Year' },
  { value: 'duration', label: 'Longest' },
  { value: 'random', label: 'Random' }
];

export function LibraryView() {
  const search = useUIStore((s)=>s.search);
  const [libraryId, setLibraryId] = useState<number|null>(null);
  const [folder, setFolder] = useState<string|null>(null);
  const [sort, setSort] = useState<SortKey>('title');
  const navigate = useNavigate();

  const librariesQ = useQuery({queryKey:['libraries'],queryFn:api.libraries});
  const foldersQ = useQuery({queryKey:['folders'],queryFn:api.folders});
  const mediaQ = useQuery({
    queryKey:['media',search,libraryId,folder,sort],
    queryFn:()=>api.media({search,limit:500,libraryId:libraryId ?? undefined,folder:folder ?? undefined,sort})
  });
  const media = mediaQ.data ?? [];
  const libraries = librariesQ.data ?? [];
  const folderEntries = foldersQ.data ?? [];

  const segments = folder ? folder.split('/') : [];
  const selected = folderEntries.filter((e)=>libraryId===null||e.library_id===libraryId);

  const children = new Map<string,number>();
  let rootCount = 0;
  for (const entry of selected) {
    if (entry.folder === '') { rootCount += entry.count; continue; }
    const parts = entry.folder.split('/');
    if (parts.length <= segments.length) continue;
    if (segments.length > 0 && !entry.folder.startsWith(`${folder}/`)) continue;
    const name = parts[segments.length];
    children.set(name, (children.get(name) ?? 0) + entry.count);
  }
  const childFolders = [...children.entries()]
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([name,count])=>({name,count}));

  const libraryLabel = libraries.find((l)=>l.id===libraryId)?.label;
  const title = segments.length ? segments[segments.length-1] : (folder === '' ? 'Root' : libraryLabel ?? 'Library');

  const jumpTo = (depth:number) => {
    setFolder(depth === 0 ? null : segments.slice(0,depth).join('/'));
  };
  const openChild = (name:string) => {
    setFolder(segments.length ? `${folder}/${name}` : name);
  };
  const playAll = () => {
    const first = media[0];
    if (!first) return;
    void navigate({to:'/watch/$mediaId',params:{mediaId:String(first.id)},search:{
      queue: true,
      folder: folder ?? undefined,
      libraryId: libraryId ?? undefined,
      sort,
      search: search || undefined
    }});
  };

  return <div className="content-view">
    <header className="content-heading">
      <div><h1>{title}</h1><p>{mediaQ.isLoading ? 'Loading…' : `${media.length} item${media.length === 1 ? '' : 's'}`}</p></div>
      <div className="heading-controls library-actions">
        <Link to="/playlists" className={buttonVariants({variant:'secondary',className:'library-playlists-link'})}><Queue aria-hidden="true"/><span>Playlists</span><CaretRight aria-hidden="true"/></Link>
        <Select label="Sort" value={sort} options={SORT_OPTIONS} onChange={(v)=>setSort(v as SortKey)}/>
        {folder !== null && media.length > 0 && <Button className="play-all-btn" onPress={()=>playAll()}><Play weight="fill"/> Play all</Button>}
      </div>
    </header>

    {libraries.length > 1 && <nav className="folder-nav" aria-label="Library selection">
      <FolderRow>
        <button className={`folder-chip ${libraryId===null ? 'active' : ''}`} onClick={()=>{setLibraryId(null);setFolder(null);}}>All libraries</button>
        {libraries.map((l:Library)=><button key={l.id} className={`folder-chip ${libraryId===l.id ? 'active' : ''}`} onClick={()=>{setLibraryId(l.id);setFolder(null);}}>{l.label}</button>)}
      </FolderRow>
    </nav>}

    <nav className="folder-nav" aria-label="Folder navigation">
      <FolderRow className="crumbs">
        <button className={`folder-chip crumb ${folder===null ? 'active' : ''}`} onClick={()=>jumpTo(0)}>All folders</button>
        {segments.map((segment,i)=><button key={i} className={`folder-chip crumb ${i===segments.length-1 ? 'active' : ''}`} onClick={()=>jumpTo(i+1)}>{segment}</button>)}
        {folder==='' && <span className="folder-chip crumb active">Root</span>}
      </FolderRow>
      {childFolders.length > 0 && <FolderRow>
        {childFolders.map((child)=><button key={child.name} className="folder-chip" onClick={()=>openChild(child.name)}><FolderSimple/> {child.name} <em>{child.count}</em></button>)}
      </FolderRow>}
      {rootCount > 0 && folder === null && <FolderRow>
        <button className="folder-chip" onClick={()=>setFolder('')}><FolderSimple/> Root <em>{rootCount}</em></button>
      </FolderRow>}
    </nav>

    {mediaQ.isLoading ? <div className="media-grid" role="status" aria-label="Loading videos" aria-busy="true">{Array.from({length:12},(_,i)=><div className="skeleton grid-skeleton" key={i}/>)}</div> :
      media.length ? <div className="media-grid">{media.map(item=><MediaCard key={item.id} item={item}/>)}</div> : <div className="search-empty"><MagnifyingGlass/><h2>No matches</h2><p>Try another title, folder or file name.</p></div>}
  </div>;
}

function FolderRow({children,className=''}:{children:ReactNode;className?:string}){
  const ref=useRef<HTMLDivElement>(null);
  useRowWheel(ref);
  return <div ref={ref} className={`folder-row${className?` ${className}`:''}`}>{children}</div>;
}
