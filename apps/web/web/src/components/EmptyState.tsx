import { t, useLocale } from '../i18n';
import { Button } from '@heroui/react';
import { FolderOpen, Gear, ShieldCheck } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { api } from '../api';
import { ScanProgress } from '@virelo/web-ui/components/ScanProgress.tsx';
import { MediaEmptyState } from '@virelo/web-ui/components/MediaEmptyState.tsx';

export function EmptyState() {
  useLocale();
  const navigate = useNavigate();
  const client = useQueryClient();
  const scan = useQuery({ queryKey:['scan'], queryFn:api.scanStatus, refetchInterval:(query)=>query.state.data?.running ? 400 : 2_000 });
  const libraries = useQuery({ queryKey:['libraries'], queryFn:api.libraries });
  const add = useMutation({
    mutationFn: api.addLibrary,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey:['home'] }),
        client.invalidateQueries({ queryKey:['libraries'] }),
        client.invalidateQueries({ queryKey:['media'] }),
        client.invalidateQueries({ queryKey:['shorts'] }),
        client.invalidateQueries({ queryKey:['scan'] })
      ]);
    }
  });

  return <MediaEmptyState kind="folder" heading="h1" title={t(libraries.data?.length ? "No videos found" : "Choose your video folder")}>
    {scan.data?.running && <ScanProgress status={scan.data}/>}
    <div className="media-empty__actions">
      <Button isPending={add.isPending || scan.data?.running} onPress={()=>add.mutate()}><FolderOpen/> {t("Choose folder")}</Button>
      <Button variant="secondary" onPress={()=>void navigate({to:'/app/settings'})}><Gear/> {t("Settings")}</Button>
    </div>
    {add.error && add.error.name !== 'AbortError' && <p className="error-copy" role="alert">{t(add.error.message)}</p>}
    <div className="local-privacy-note"><ShieldCheck aria-hidden="true"/><span>{t("Files stay on this device")}</span></div>
  </MediaEmptyState>;
}
