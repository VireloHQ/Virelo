import { t, useLocale } from '../i18n';
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
import { LibraryFolderButton } from '../components/LibraryFolderButton';
import { libraryFolderChildren, folderDisplayName } from '../utils/library-folder-children';
import { useAccount } from '../components/AccountSession';
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
  useLocale();
  const search = useUIStore((s)=>s.search);
  const [libraryId, setLibraryId] = useState<number|null>(null);
  const [folder, setFolder] = useState<string|null>(null);
  const [sort, setSort] = useState<SortKey>('title');
  const navigate = useNavigate();
  const session = useAccount();
  const canRename = Boolean(session?.user.permissions.manageLibraries);

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

  const activeLibraryId = libraryId ?? (libraries.length === 1 ? libraries[0].id : null);
  const currentLibrary = libraries.find(library => library.id === activeLibraryId);
  const rootCount = selected.filter(entry => entry.folder === '').reduce((total,entry) => total + entry.count,0);
  const childFolders = libraryFolderChildren(folderEntries,libraries,activeLibraryId,folder);
  const title = segments.length ? folderDisplayName(currentLibrary,folder!,segments[segments.length-1]) : (folder === '' ? t('Root') : currentLibrary?.label ?? t('Library'));

  const jumpTo = (depth:number) => {
    setFolder(depth === 0 ? null : segments.slice(0,depth).join('/'));
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
      <div><h1>{title}</h1><p>{mediaQ.isLoading ? t("Loading…") : t('{count} items',{count:media.length})}</p></div>
      <div className="heading-controls library-actions">
        <Link to="/playlists" className={buttonVariants({variant:'secondary',className:'library-playlists-link'})}><Queue aria-hidden="true"/><span>{t("Playlists")}</span><CaretRight aria-hidden="true"/></Link>
        <Select label={t("Sort")} value={sort} options={SORT_OPTIONS.map(option=>({...option,label:t(option.label)}))} onChange={(v)=>setSort(v as SortKey)}/>
        {folder !== null && media.length > 0 && <Button className="play-all-btn" onPress={()=>playAll()}><Play weight="fill"/> {t("Play all")}</Button>}
      </div>
    </header>

    {libraries.length > 0 && <nav className="folder-nav" aria-label={t("Library selection")}>
      <FolderRow>
        {libraries.length > 1 && <button className={`folder-chip ${libraryId===null ? 'active' : ''}`} onClick={()=>{setLibraryId(null);setFolder(null);}}>{t("All libraries")}</button>}
        {libraries.map((library:Library)=><LibraryFolderButton key={library.id} library={library} label={library.label} active={activeLibraryId===library.id} canRename={canRename}
          onClick={()=>{setLibraryId(library.id);setFolder(null);}}/>)}
      </FolderRow>
    </nav>}

    <nav className="folder-nav" aria-label={t("Folder navigation")}>
      <FolderRow className="crumbs">
        <button className={`folder-chip crumb ${folder===null ? 'active' : ''}`} onClick={()=>jumpTo(0)}>{t("All folders")}</button>
        {segments.map((segment,i)=>{
          const path=segments.slice(0,i+1).join('/'),label=folderDisplayName(currentLibrary,path,segment);
          return currentLibrary?<LibraryFolderButton key={path} library={currentLibrary} folder={path} label={label} active={i===segments.length-1} crumb canRename={canRename} onClick={()=>jumpTo(i+1)}/>
            :<button key={path} className="folder-chip crumb" onClick={()=>jumpTo(i+1)}>{label}</button>;
        })}
        {folder==='' && <span className="folder-chip crumb active">{t("Root")}</span>}
      </FolderRow>
      {childFolders.length > 0 && <FolderRow>
        {childFolders.map(child=>{
          const library=libraries.find(item=>item.id===child.libraryId)!,label=folderDisplayName(library,child.folder,child.name);
          return <LibraryFolderButton key={child.libraryId+':'+child.folder} library={library} folder={child.folder} label={label} canRename={canRename}
            onClick={()=>{setLibraryId(child.libraryId);setFolder(child.folder);}}>
            <FolderSimple/><span>{activeLibraryId===null?library.label+' / ':''}{label}</span><em>{child.count}</em>
          </LibraryFolderButton>;
        })}
      </FolderRow>}
      {rootCount > 0 && folder === null && <FolderRow>
        <button className="folder-chip" onClick={()=>setFolder('')}><FolderSimple/> {t("Root")} <em>{rootCount}</em></button>
      </FolderRow>}
    </nav>

    {mediaQ.isLoading ? <div className="media-grid" role="status" aria-label={t("Loading videos")} aria-busy="true">{Array.from({length:12},(_,i)=><div className="skeleton grid-skeleton" key={i}/>)}</div> :
      media.length ? <div className="media-grid">{media.map(item=><MediaCard key={item.id} item={item}/>)}</div> : <div className="search-empty"><MagnifyingGlass/><h2>{t("No matches")}</h2><p>{t("Try another title, folder or file name.")}</p></div>}
  </div>;
}

function FolderRow({children,className=''}:{children:ReactNode;className?:string}){
  const ref=useRef<HTMLDivElement>(null);
  useRowWheel(ref);
  return <div ref={ref} className={`folder-row${className?` ${className}`:''}`}>{children}</div>;
}
