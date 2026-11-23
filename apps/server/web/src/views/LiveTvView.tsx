import { useState } from 'react';
import { Button } from '@heroui/react';
import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query';
import { LiveTv } from '@virelo/web-ui/components/LiveTv.tsx';
import { useAccount } from '../components/AccountSession';
import { t,useLocale } from '../i18n';
import { api } from '../api';

export function LiveTvView(){
  const admin=useAccount()?.user.isAdmin;
  return <LiveTv service={api.liveTv} admin={admin?<AllowedOrigins/>:undefined}/>;
}

function AllowedOrigins(){
  useLocale();
  const client=useQueryClient(),[open,setOpen]=useState(false);
  const settings=useQuery({queryKey:['iptv-origins'],queryFn:api.liveTv.origins,enabled:open});
  const save=useMutation({mutationFn:api.liveTv.saveOrigins,onSuccess:result=>{client.setQueryData(['iptv-origins'],result);}});
  return <details className="live-tv-admin" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>{t("Allowed Live TV sources")}</summary>
    <p id="iptv-origins-help">{t("Enter one HTTPS origin per line. Include any separate origins that serve playlists or video segments.")}</p>
    {settings.data&&<form onSubmit={event=>{
      event.preventDefault();
      const field=new FormData(event.currentTarget).get('origins');
      if(typeof field==='string')save.mutate(field.split(/\r?\n/).map(value=>value.trim()).filter(Boolean));
    }}>
      <textarea key={settings.data.origins.join('\n')} name="origins" aria-label={t("Allowed Live TV sources")} aria-describedby="iptv-origins-help" rows={4}
        maxLength={16384} defaultValue={settings.data.origins.join('\n')} spellCheck={false}/>
      <Button type="submit" variant="secondary" isPending={save.isPending}>{t("Save settings")}</Button>
      {save.isSuccess&&<p role="status">{t("Saved")}</p>}
    </form>}
    {(save.error||settings.error)&&<p className="error-copy" role="alert">{t((save.error||settings.error)!.message)}</p>}
  </details>;
}
