import { useId, useState } from 'react';
import { Button, TextArea } from '@heroui/react';
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
  const client=useQueryClient(),[open,setOpen]=useState(false),id=useId();
  const settings=useQuery({queryKey:['iptv-origins'],queryFn:api.liveTv.origins,enabled:open});
  const save=useMutation({mutationFn:api.liveTv.saveOrigins,onSuccess:result=>{client.setQueryData(['iptv-origins'],result);}});
  return <div className="live-tv-admin">
    <Button variant="secondary" aria-expanded={open} aria-controls={open?id:undefined} onPress={()=>setOpen(value=>!value)}>{t("Allowed Live TV sources")}</Button>
    {open&&<form id={id} className="live-tv-origins" onSubmit={event=>{
      event.preventDefault();
      const field=new FormData(event.currentTarget).get('origins');
      if(typeof field==='string')save.mutate(field.split(/\r?\n/).map(value=>value.trim()).filter(Boolean));
    }}>
      <p id={id+'-help'}>{t("Enter one HTTPS origin per line. Include any separate origins that serve playlists or video segments.")}</p>
      {settings.isPending&&<p role="status">{t("Loading…")}</p>}
      {settings.data&&<>
        <TextArea key={settings.data.origins.join('\n')} name="origins" aria-label={t("Allowed Live TV sources")} aria-describedby={id+'-help'} rows={4}
          maxLength={16384} defaultValue={settings.data.origins.join('\n')} spellCheck={false}/>
        <Button type="submit" variant="secondary" isPending={save.isPending}>{t("Save settings")}</Button>
        {save.isSuccess&&<p role="status">{t("Saved")}</p>}
      </>}
      {(save.error||settings.error)&&<p className="error-copy" role="alert">{t((save.error||settings.error)!.message)}</p>}
    </form>}
  </div>;
}
