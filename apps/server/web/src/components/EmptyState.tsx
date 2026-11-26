import { t, useLocale } from '../i18n';
import { Button } from '@heroui/react';
import { ArrowsClockwise, FolderOpen, Gear } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';
import { ScanProgress } from '@virelo/web-ui/components/ScanProgress.tsx';
import { MediaEmptyState } from '@virelo/web-ui/components/MediaEmptyState.tsx';
import { useAccount } from './AccountSession';

export function EmptyState() {
  useLocale();
  const account = useAccount()?.user;
  const navigate = useNavigate();
  const scan = useQuery({ queryKey:['scan'], queryFn:api.scanStatus, refetchInterval:(q)=>q.state.data?.running ? 500 : 5000 });
  const canManage = Boolean(account?.permissions.manageLibraries);
  const libraries = useQuery({ queryKey:['libraries'], queryFn:api.libraries, enabled:canManage });
  const hasFolders = Boolean(libraries.data?.length);
  const firstFolder = canManage && libraries.data?.length===0;
  const addFolder = () => void navigate({to:'/settings',hash:'libraries'});
  const startScan = async () => { await api.startScan(); await scan.refetch(); };
  return <MediaEmptyState kind="folder" heading="h1" title={t(firstFolder?"Choose your video folder":"No videos found")}>
    {scan.data?.running && !firstFolder ? <ScanProgress status={scan.data}/> :
      !canManage && <p>{t("No videos are available for this account. Ask an administrator to grant library access.")}</p>}
    {(canManage || account?.permissions.scanLibraries) && <div className="media-empty__actions">
      {hasFolders&&<Button onPress={()=>void navigate({to:'/library'})}><FolderOpen/> {t("Open library")}</Button>}
      {account?.permissions.scanLibraries&&(!canManage||hasFolders)&&<Button variant={hasFolders?'secondary':'primary'} isPending={scan.data?.running} onPress={()=>void startScan()}><ArrowsClockwise/> {t("Scan again")}</Button>}
      {canManage&&<Button variant={hasFolders?'secondary':'primary'} onPress={addFolder}><Gear/> {firstFolder?t("Add video folder"):t("Add folder")}</Button>}
    </div>}
  </MediaEmptyState>;
}
