import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { ArrowsClockwise, CheckCircle, FolderPlus, Trash } from '@phosphor-icons/react';
import { api } from '../api';
import { useAccount } from './AccountSession';
import { ScanProgress } from './ScanProgress';
import type { Library } from '../types';

export function LibrarySettings() {
  const session = useAccount(), client = useQueryClient();
  const canManage = Boolean(session?.user.permissions.manageLibraries);
  const [path, setPath] = useState(''), [showPrevious, setShowPrevious] = useState(false);
  const libraries = useQuery({queryKey:['libraries'],queryFn:api.libraries});
  const previous = useQuery({queryKey:['previous-libraries'],queryFn:api.previousLibraries,enabled:Boolean(session?.user.isAdmin)&&showPrevious});
  const scan = useQuery({queryKey:['scan'],queryFn:api.scanStatus,refetchInterval:q=>q.state.data?.running?1000:5000});
  const refresh = async () => {
    await client.invalidateQueries({predicate:q=>['libraries','account-libraries','previous-libraries','home','media','folders','favorites','watch-queue','scan'].includes(String(q.queryKey[0]))});
  };
  const save = useMutation({mutationFn:({path,label}:{path:string;label?:string})=>api.addLibrary(path,label),
    onSuccess:async()=>{setPath('');await refresh();}});
  const remove = useMutation({mutationFn:api.removeLibrary,onSuccess:refresh});
  const startScan = useMutation({mutationFn:api.startScan,onSuccess:()=>client.invalidateQueries({queryKey:['scan']})});
  const temporary = libraries.data?.filter(library=>!library.persistent) ?? [];
  const saved = libraries.data?.filter(library=>library.persistent) ?? [];
  const saveLibrary = (library:Library) => save.mutate({path:library.path,label:library.label});
  const list = (items:Library[], temporary=false) => <div className="library-list">{items.map(library=><div key={library.id}>
    <div><strong>{library.label}</strong>{canManage&&<span>{library.path}</span>}</div>
    {canManage&&<div className="library-item-actions">
      {temporary&&<Button variant="secondary" isPending={save.isPending&&save.variables?.path===library.path} isDisabled={save.isPending} onPress={()=>saveLibrary(library)}>Save library</Button>}
      <Button isIconOnly variant="ghost" isDisabled={remove.isPending} aria-label={'Remove '+library.label} onPress={()=>remove.mutate(library.id)}><Trash/></Button>
    </div>}
  </div>)}</div>;
  return <>
    {canManage&&<form className="add-library" onSubmit={event=>{event.preventDefault();if(path.trim()&&!save.isPending)save.mutate({path});}}>
      <Input aria-label="Media folder path" placeholder={navigator.userAgent.includes('Windows')?'D:\\Videos':'/home/user/Videos'} value={path} onChange={event=>setPath(event.target.value)}/>
      <Button type="submit" isPending={save.isPending} isDisabled={!path.trim()||save.isPending}><FolderPlus/> Add folder</Button>
    </form>}
    {(save.error||remove.error)&&<p className="error-copy" role="alert">{save.error?.message||remove.error?.message}</p>}
    {libraries.isError&&<p className="error-copy" role="alert">Could not load libraries. <button onClick={()=>void libraries.refetch()}>Try again</button></p>}
    {temporary.length>0&&<section className="library-group" aria-labelledby="temporary-libraries-title">
      <h3 id="temporary-libraries-title">Temporary folders</h3><p>Available for this run only. Save a folder to keep it when Virelo starts elsewhere.</p>{list(temporary,true)}
    </section>}
    <section className="library-group" aria-labelledby="saved-libraries-title">
      <h3 id="saved-libraries-title">Saved libraries</h3><p>Available every time this server starts, regardless of the startup folder.</p>
      {saved.length ? list(saved) : <p className="account-notice">No saved libraries yet.</p>}
    </section>
    {session?.user.isAdmin&&<details className="library-previous" onToggle={event=>setShowPrevious(event.currentTarget.open)}>
      <summary>Previously used folders</summary><p>Folders from earlier runs are not active. Save one to add it back. Existing watch history and favorites are retained.</p>
      {previous.isPending&&showPrevious&&<p role="status">Loading folders…</p>}
      {previous.isError&&<p role="alert">Could not load folders. <button onClick={()=>void previous.refetch()}>Try again</button></p>}
      <div className="library-list">{previous.data?.map(library=><div key={library.id}><div><strong>{library.label}</strong><span>{library.path}</span></div>
        <Button variant="secondary" isDisabled={save.isPending} onPress={()=>saveLibrary(library)}>Save library</Button></div>)}</div>
      {previous.data?.length===0&&<p>No previous folders.</p>}
    </details>}
    <div className="scan-strip"><div>{scan.data?.running?<ArrowsClockwise className="spin"/>:<CheckCircle/>}<span><strong>{scan.data?.message||'Idle'}</strong></span></div>
      {session?.user.permissions.scanLibraries&&<Button variant="secondary" isPending={Boolean(scan.data?.running)||startScan.isPending} onPress={()=>startScan.mutate()}>Scan</Button>}
    </div>
    {startScan.error&&<p className="error-copy" role="alert">{startScan.error.message}</p>}
    <ScanProgress status={scan.data} compact/>
  </>;
}
