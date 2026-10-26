import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { CheckCircle, FolderOpen, FolderPlus, Trash } from '@phosphor-icons/react';
import { api } from '../api';
import { useAccount } from './AccountSession';
import { ScanProgress } from './ScanProgress';
import { scanMessage } from '../i18n/scan-status';
import type { Library } from '../types';

export function LibrarySettings() {
  useLocale();
  const session = useAccount(), client = useQueryClient();
  const canManage = Boolean(session?.user.permissions.manageLibraries);
  const [path, setPath] = useState('');
  const [showPrevious, setShowPrevious] = useState(false);
  const libraries = useQuery({queryKey:['libraries'],queryFn:api.libraries});
  const previous = useQuery({queryKey:['previous-libraries'],queryFn:api.previousLibraries,enabled:Boolean(session?.user.isAdmin)&&showPrevious});
  const scan = useQuery({queryKey:['scan'],queryFn:api.scanStatus,refetchInterval:q=>q.state.data?.running?1000:5000});
  const refresh = async () => {
    await client.invalidateQueries({predicate:q=>['libraries','account-libraries','previous-libraries','home','media','folders','favorites','watch-queue','scan'].includes(String(q.queryKey[0]))});
  };
  const save = useMutation({mutationFn:({path,label}:{path:string;label?:string})=>api.addLibrary(path,label),
    onSuccess:async()=>{setPath('');await refresh();}});
  const pick = useMutation({mutationFn:api.pickFolder,onSuccess:result=>{if(result.path)setPath(result.path);}});
  const remove = useMutation({mutationFn:api.removeLibrary,onSuccess:refresh});
  const startScan = useMutation({mutationFn:api.startScan,onSuccess:()=>client.invalidateQueries({queryKey:['scan']})});
  const temporary = libraries.data?.filter(library=>!library.persistent) ?? [];
  const saved = libraries.data?.filter(library=>library.persistent) ?? [];
  const saveLibrary = (library:Library) => save.mutate({path:library.path,label:library.label});
  const list = (items:Library[], temporary=false) => <div className="library-list">{items.map(library=><div key={library.id}>
    <div><strong>{library.label}</strong>{canManage&&<span>{library.path}</span>}</div>
    {canManage&&<div className="library-item-actions">
      {temporary&&<Button variant="secondary" isPending={save.isPending&&save.variables?.path===library.path} isDisabled={save.isPending} onPress={()=>saveLibrary(library)}>{t("Save library")}</Button>}
      <Button isIconOnly variant="ghost" isDisabled={remove.isPending} aria-label={t("Remove {value0}", { value0: library.label })} onPress={()=>remove.mutate(library.id)}><Trash/></Button>
    </div>}
  </div>)}</div>;
  return <>
    {canManage&&<form className="library-folder-form" onSubmit={event=>{
      event.preventDefault();
      if(path.trim()&&!save.isPending&&!pick.isPending)save.mutate({path});
    }}>
      <label htmlFor="library-folder-path">{t("Media folder path")}</label>
      <div className="add-library">
        <Input id="library-folder-path" aria-describedby="library-folder-help" placeholder={navigator.userAgent.includes('Windows')?'D:\\Videos':'/home/user/Videos'} value={path} onChange={event=>{setPath(event.target.value);if(pick.isError)pick.reset();}} disabled={save.isPending||pick.isPending}/>
        <div className="library-folder-actions">
          <Button type="button" variant="secondary" isPending={pick.isPending} isDisabled={!session?.localAccess||pick.isPending||save.isPending} onPress={()=>pick.mutate()}><FolderOpen/> {pick.isPending?t("Opening…"):t("Browse")}</Button>
          <Button type="submit" isPending={save.isPending} isDisabled={!path.trim()||save.isPending||pick.isPending}><FolderPlus/> {t("Add folder")}</Button>
        </div>
      </div>
      <p id="library-folder-help" className="account-help">{pick.isPending?t("Choose a folder in the window on this PC."):session?.localAccess?t("Browse for a folder on this PC, or enter its path. Then select Add folder."):t("Browsing is only available on localhost. Enter the folder path on the PC running Virelo, not on this device.")}</p>
    </form>}
    {(pick.error||save.error||remove.error)&&<p className="error-copy" role="alert">{t(pick.error?.message||save.error?.message||remove.error?.message||'')}</p>}
    {libraries.isError&&<p className="error-copy" role="alert"><Trans message="Could not load libraries. {value0}" values={{value0:<button onClick={()=>void libraries.refetch()}>{t("Try again")}</button>}}/></p>}
    {temporary.length>0&&<section className="library-group" aria-labelledby="temporary-libraries-title">
      <h3 id="temporary-libraries-title">{t("Temporary folders")}</h3><p>{t("Available for this run only. Save a folder to keep it when Virelo starts elsewhere.")}</p>{list(temporary,true)}
    </section>}
    <section className="library-group" aria-labelledby="saved-libraries-title">
      <h3 id="saved-libraries-title">{t("Saved libraries")}</h3><p>{t("Available every time this server starts, regardless of the startup folder.")}</p>
      {saved.length ? list(saved) : <p className="account-notice">{t("No saved libraries yet.")}</p>}
    </section>
    {session?.user.isAdmin&&<details className="library-previous" onToggle={event=>setShowPrevious(event.currentTarget.open)}>
      <summary>{t("Previously used folders")}</summary><p>{t("Folders from earlier runs are not active. Save one to add it back. Existing watch history and favorites are retained.")}</p>
      {previous.isPending&&showPrevious&&<p role="status">{t("Loading folders…")}</p>}
      {previous.isError&&<p role="alert"><Trans message="Could not load folders. {value0}" values={{value0:<button onClick={()=>void previous.refetch()}>{t("Try again")}</button>}}/></p>}
      <div className="library-list">{previous.data?.map(library=><div key={library.id}><div><strong>{library.label}</strong><span>{library.path}</span></div>
        <Button variant="secondary" isDisabled={save.isPending} onPress={()=>saveLibrary(library)}>{t("Save library")}</Button></div>)}</div>
      {previous.data?.length===0&&<p>{t("No previous folders.")}</p>}
    </details>}
    <div className="library-scan">
      <p>{t("Scan checks video files, fills in missing technical details and restores missing thumbnails. Missing downloaded artwork is fetched again when online metadata and images are enabled. Original video files are never changed.")}</p>
      <div className="scan-strip">{scan.data?.running ? <ScanProgress status={scan.data} compact/> : <div><CheckCircle/><span><strong>{scanMessage(scan.data)}</strong></span></div>}
        {session?.user.permissions.scanLibraries&&<Button variant="secondary" isDisabled={Boolean(scan.data?.running)||startScan.isPending} onPress={()=>startScan.mutate()}>{t("Scan")}</Button>}
      </div>
      {startScan.error&&<p className="error-copy" role="alert">{t(startScan.error.message)}</p>}
    </div>
  </>;
}
