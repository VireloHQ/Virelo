import { buttonVariants } from '@heroui/react';
import { DownloadSimple } from '@phosphor-icons/react';
import type { Account } from '../../../src/auth-types';
import { t, useLocale } from '../i18n';
import { useAccount } from './AccountSession';

export const canDownloadOriginal=(user:Account|undefined)=>user?.permissions.download===true&&user.permissions.play;
const downloadPath=(id:number)=>`/api/media/${id}/download`;

export function startOriginalDownload(id:number) {
  const anchor=document.createElement('a');
  anchor.href=downloadPath(id);
  anchor.download='';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function DownloadOriginal({id}:{id:number}) {
  useLocale();
  const user=useAccount()?.user;
  if(!canDownloadOriginal(user))return null;
  const standalone=window.matchMedia('(display-mode: standalone)').matches||(navigator as Navigator&{standalone?:boolean}).standalone;
  return <>
    <a className={buttonVariants({variant:'secondary'})} href={downloadPath(id)} download><DownloadSimple aria-hidden="true"/>{t("Download original")}</a>
    {standalone&&<div className="account-help download-standalone-help">{t("If saving does not start, open this video in your browser and try again.")}{' '}
      <a href={'/title/'+id} target="_blank" rel="noopener">{t("Open in browser")}</a></div>}
  </>;
}
