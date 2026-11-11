import { t, useLocale } from '../i18n';
import { Button } from '@heroui/react';
import { ArrowsClockwise, FolderOpen, Gear } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';
import { ScanProgress } from './ScanProgress';
import { useAccount } from './AccountSession';

export function EmptyState() {
  useLocale();
  const account = useAccount()?.user;
  const navigate = useNavigate();
  const scan = useQuery({ queryKey:['scan'], queryFn:api.scanStatus, refetchInterval:(q)=>q.state.data?.running ? 500 : 5000 });
  const startScan = async () => { await api.startScan(); await scan.refetch(); };
  return <div className="empty-state">
    <div className="empty-icon"><FolderOpen/></div>
    <h2>{t("No videos found")}</h2>
    {scan.data?.running ? <ScanProgress status={scan.data}/> : <p>{account?.permissions.manageLibraries ? t("Add video files to this folder, then scan again. You can add other folders in Settings.") : t("No videos are available for this account. Ask an administrator to grant library access.")}</p>}
    <div className="empty-actions">
      {account?.permissions.scanLibraries&&<Button isPending={scan.data?.running} onPress={()=>void startScan()}><ArrowsClockwise/> {t("Scan again")}</Button>}
      {account?.permissions.manageLibraries&&<Button variant="secondary" onPress={()=>void navigate({to:'/settings',hash:'libraries'})}><Gear/> {t("Add folder")}</Button>}
    </div>
  </div>;
}
