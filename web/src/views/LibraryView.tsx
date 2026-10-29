import { t, useLocale } from '../i18n';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button, buttonVariants } from '@heroui/react';
import { CaretRight, FolderSimple, MagnifyingGlass, Play, Queue, SquaresFour, TreeStructure } from '@phosphor-icons/react';
import { api } from '../api';
import { useUIStore } from '../store';
import { MediaCard } from '../components/MediaCard';
import { Select } from '../components/Select';
import { useRowWheel } from '../hooks/useRowWheel';
import { LibraryFolderButton } from '../components/LibraryFolderButton';
import { libraryFolderChildren, folderDisplayName } from '../utils/library-folder-children';
import { LibraryExplorer } from '../components/LibraryExplorer';
import { explorerFolders, navigateLibraryHistory, type LibraryLocation } from '../utils/library-explorer';
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
  const [layout,setLayout]=useState<'grid'|'explorer'>(()=>{try{return localStorage.getItem('virelo.library-layout')==='explorer'?'explorer':'grid';}catch{return 'grid';}});
  const [history,setHistory]=useState<{items:LibraryLocation[];index:number}>({items:[{libraryId:null,folder:null}],index:0});
  const {libraryId,folder}=history.items[history.index];
  const goTo=(next:LibraryLocation)=>setHistory(current=>navigateLibraryHistory(current,next));
  const setFolder=(next:string|null)=>goTo({libraryId,folder:next});
  const [sort, setSort] = useState<SortKey>('title');
  const [sortSeed]=useState(()=>Math.floor(Math.random()*4294967296));
  const navigate = useNavigate();
  const session = useAccount();
  const canRename = Boolean(session?.user.permissions.manageLibraries);

  const librariesQ = useQuery({queryKey:['libraries'],queryFn:api.libraries});
  const foldersQ = useQuery({queryKey:['folders'],queryFn:api.folders});
  const libraries = librariesQ.data ?? [];
  const explorer=layout==='explorer';
  const activeLibraryId = libraryId ?? (!explorer&&libraries.length === 1 ? libraries[0].id : null);
  const mediaQ = useInfiniteQuery({
    queryKey:['media',search,libraryId,folder,sort,layout,sort==='random'?sortSeed:0],
    initialPageParam:0,
    queryFn:({pageParam})=>api.media({search,limit:200,offset:pageParam,libraryId:(explorer?activeLibraryId:libraryId) ?? undefined,folder:explorer?(folder??''):(folder??undefined),recursive:explorer?0:undefined,sort,seed:sort==='random'?sortSeed:undefined}),
    getNextPageParam:(last,pages)=>last.length===200?pages.length*200:undefined,
    enabled:!explorer||activeLibraryId!==null
  });
  const media = mediaQ.data?.pages.flat() ?? [];
  const folderEntries = foldersQ.data ?? [];

  const segments = folder ? folder.split('/') : [];
  const selected = folderEntries.filter((e)=>libraryId===null||e.library_id===libraryId);

  const tree=useMemo(()=>explorerFolders(librariesQ.data??[],foldersQ.data??[]),[librariesQ.data,foldersQ.data]);
  const currentLibrary = libraries.find(library => library.id === activeLibraryId);
  const rootCount = selected.filter(entry => entry.folder === '').reduce((total,entry) => total + entry.count,0);
  const childFolders = libraryFolderChildren(folderEntries,libraries,activeLibraryId,folder);
  const title = segments.length ? folderDisplayName(currentLibrary,folder!,segments[segments.length-1]) : (folder === ''&&!explorer ? t('Root') : currentLibrary?.label ?? t('Library'));

  const jumpTo = (depth:number) => {
    setFolder(depth === 0 ? null : segments.slice(0,depth).join('/'));
  };
  const playAll = () => {
    const first = media[0];
    if (!first) return;
    void navigate({to:'/watch/$mediaId',params:{mediaId:String(first.id)},search:{
      queue: true,
      folder: explorer?(folder??''):(folder??undefined),
      libraryId: (explorer?activeLibraryId:libraryId) ?? undefined,
      exactFolder: explorer||undefined,
      sort,
      search: search || undefined
    }});
  };

  const videos=<>
    {mediaQ.isError&&!mediaQ.data?<div className="search-empty" role="alert"><h2>{t('Could not load videos')}</h2><p>{t(mediaQ.error.message)}</p><Button onPress={()=>void mediaQ.refetch()}>{t('Try again')}</Button></div>:
      mediaQ.isLoading ? <div className="media-grid" role="status" aria-label={t("Loading videos")} aria-busy="true">{Array.from({length:12},(_,i)=><div className="skeleton grid-skeleton" key={i}/>)}</div> :
      media.length ? <div className="media-grid">{media.map(item=><MediaCard key={item.id} item={item}/>)}</div> : (!explorer||activeLibraryId!==null)&&!childFolders.length&&<div className="search-empty"><MagnifyingGlass/><h2>{t("No matches")}</h2><p>{t("Try another title, folder or file name.")}</p></div>}
    {mediaQ.isError&&mediaQ.data&&<p className="error-copy" role="alert">{t('Could not load videos')}</p>}
    {mediaQ.hasNextPage&&<div className="library-more"><Button variant="secondary" isPending={mediaQ.isFetchingNextPage} onPress={()=>void mediaQ.fetchNextPage()}>{t(mediaQ.isFetchNextPageError?'Try again':'Load more')}</Button></div>}
  </>;
  return <div className="content-view library-view" data-layout={layout}>
    <header className="content-heading">
      <div><h1>{title}</h1><p>{mediaQ.isLoading ? t("Loading…") : t('{count} items',{count:media.length+(explorer?(activeLibraryId===null?libraries.length:childFolders.length):0)})}</p></div>
      <div className="heading-controls library-actions">
        <div className="library-layout-switch" role="group" aria-label={t('Library view')}>
          {(['grid','explorer'] as const).map(value=><button key={value} type="button" aria-pressed={layout===value} onClick={()=>{if(value==='explorer'&&libraryId===null&&libraries.length===1)goTo({libraryId:libraries[0].id,folder:folder??''});setLayout(value);try{localStorage.setItem('virelo.library-layout',value);}catch{/* Keep the selection for this visit. */}}}>
            {value==='grid'?<SquaresFour/>:<TreeStructure/>}<span>{t(value==='grid'?'Grid view':'Explorer view')}</span>
          </button>)}
        </div>
        <Link to="/playlists" className={buttonVariants({variant:'secondary',className:'library-playlists-link'})}><Queue aria-hidden="true"/><span>{t("Playlists")}</span><CaretRight aria-hidden="true"/></Link>
        <Select label={t("Sort")} value={sort} options={SORT_OPTIONS.map(option=>({...option,label:t(option.label)}))} onChange={(v)=>setSort(v as SortKey)}/>
        {(explorer||folder !== null) && media.length > 0 && <Button className="play-all-btn" onPress={()=>playAll()}><Play weight="fill"/> {t("Play all")}</Button>}
      </div>
    </header>

    {(librariesQ.isError||foldersQ.isError)&&<div className="error-copy" role="alert"><p>{librariesQ.error?t('Could not load libraries. {value0}',{value0:t(librariesQ.error.message)}):t('Could not load folders. {value0}',{value0:t(foldersQ.error!.message)})}</p><Button variant="secondary" onPress={()=>void Promise.all([librariesQ.refetch(),foldersQ.refetch()])}>{t('Try again')}</Button></div>}
    {explorer?<LibraryExplorer roots={tree.roots} nodes={tree.nodes} location={{libraryId:activeLibraryId,folder}} canRename={canRename}
      canBack={history.index>0} canForward={history.index<history.items.length-1}
      onBack={()=>setHistory(current=>({...current,index:Math.max(0,current.index-1)}))}
      onForward={()=>setHistory(current=>({...current,index:Math.min(current.items.length-1,current.index+1)}))}
      onNavigate={goTo}>{videos}</LibraryExplorer>:<>
    {libraries.length > 0 && <nav className="folder-nav" aria-label={t("Library selection")}>
      <FolderRow>
        {libraries.length > 1 && <button className={`folder-chip ${libraryId===null ? 'active' : ''}`} onClick={()=>goTo({libraryId:null,folder:null})}>{t("All libraries")}</button>}
        {libraries.map((library:Library)=><LibraryFolderButton key={library.id} library={library} label={library.label} active={activeLibraryId===library.id} canRename={canRename}
          onClick={()=>goTo({libraryId:library.id,folder:null})}/>)}
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
            onClick={()=>goTo({libraryId:child.libraryId,folder:child.folder})}>
            <FolderSimple/><span>{activeLibraryId===null?library.label+' / ':''}{label}</span><em>{child.count}</em>
          </LibraryFolderButton>;
        })}
      </FolderRow>}
      {rootCount > 0 && folder === null && <FolderRow>
        <button className="folder-chip" onClick={()=>setFolder('')}><FolderSimple/> {t("Root")} <em>{rootCount}</em></button>
      </FolderRow>}
    </nav>

    {videos}</>}
  </div>;
}

function FolderRow({children,className=''}:{children:ReactNode;className?:string}){
  const ref=useRef<HTMLDivElement>(null);
  useRowWheel(ref);
  return <div ref={ref} className={`folder-row${className?` ${className}`:''}`}>{children}</div>;
}
