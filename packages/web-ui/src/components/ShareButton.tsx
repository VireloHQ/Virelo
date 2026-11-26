import { t, useLocale } from '@edition/i18n';
import { useEffect, useState } from 'react';
import { Button, Input, Modal } from '@heroui/react';
import { Check, Copy, ShareNetwork, X } from '@phosphor-icons/react';
import { Select } from './Select';
import { shareLink, shareQr } from '@edition/utils/share';
import './ConfirmationDialog.css';
import '@edition/components/Communication.css';

interface ShareProps { webOnly?:boolean; addresses?:()=>Promise<Array<{url:string;name:string}>>; onSetup?:()=>void; label?:string; path?:string; }
function localAddress(origin:string) {
  const host=new URL(origin).hostname.toLowerCase();
  return ['localhost','[::1]','[::]','0.0.0.0'].includes(host)||host.endsWith('.localhost')||/^127(?:\.\d+){3}$/.test(host);
}
export function ShareButton({webOnly=false,addresses,onSetup,label='Share Virelo',path}:ShareProps) {
  const locale=useLocale();
  const [open,setOpen]=useState(false),[options,setOptions]=useState<Array<{value:string;label:string}>>([]);
  const [origin,setOrigin]=useState(location.origin),[qrImage,setQrImage]=useState({url:'',data:''}),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const [checking,setChecking]=useState(false);
  const pathname=path??window.location.pathname;
  const localOnly=!webOnly&&localAddress(origin);
  const url=localOnly?'':shareLink(origin,pathname,webOnly);
  const qr=qrImage.url===url?qrImage.data:'';
  const changeOpen=(value:boolean)=>{
    if(value){setOrigin(location.origin);setOptions([]);setError('');setCopied(false);setChecking(Boolean(addresses));}
    setOpen(value);
  };
  useEffect(()=>{
    if(!open||!addresses)return;
    let cancelled=false;
    void addresses().then(values=>{
      if(cancelled)return;
      const network=values.filter(item=>item.url!==location.origin&&!localAddress(item.url)).map(item=>({value:item.url,label:item.name+' · '+item.url}));
      if(localAddress(location.origin)){setOptions(network);if(network[0])setOrigin(network[0].value);}
      else setOptions([{value:location.origin,label:t("This address")},...network]);
    }).catch(()=>{if(!cancelled)setError('Could not load network addresses.');})
      .finally(()=>{if(!cancelled)setChecking(false);});
    return()=>{cancelled=true;};
  },[open,addresses]);
  useEffect(()=>{
    let cancelled=false;
    if(open&&url)void shareQr(url).then(value=>{if(!cancelled)setQrImage({url,data:value});}).catch(()=>{if(!cancelled)setError('The QR code could not be created. Copy the link instead.');});
    return()=>{cancelled=true;};
  },[open,url]);
  return <Modal isOpen={open} onOpenChange={changeOpen}>
    <Button className="share-trigger" variant="secondary"><ShareNetwork aria-hidden="true"/>{t(label)}</Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" isDismissable>
      <Modal.Container className="virelo-confirm-container" placement="center" size="sm" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog" aria-label={t(label)}>
          <Modal.Header className="virelo-confirm-header communication-heading"><Modal.Heading className="virelo-confirm-title">{t(label)}</Modal.Heading><Button isIconOnly variant="ghost" aria-label={t("Close share")} onPress={()=>setOpen(false)}><X/></Button></Modal.Header>
          <Modal.Body className="virelo-confirm-body communication-body">
            {localOnly ? <p>{checking?t("Checking network addresses…"):t("This address only works on this PC. To watch on another device, set up access on your local network.")}</p> : <>
            <p>{webOnly?t("Share the app. Your videos stay on this device."):t("Sign-in and library access are required.")}</p>
            {options.length>1&&<Select label={t("Server address")} value={origin} options={options} onChange={value=>{setOrigin(value);setCopied(false);}}/>}
            <div className="share-qr">{qr?<img src={qr} alt={t("QR code for the share link")} width={256} height={256}/>:<p role="status">{t("Creating QR code…")}</p>}</div>
            <Input aria-label={t("Share link")} value={url} readOnly onFocus={event=>event.currentTarget.select()}/>
            </>}
            {error&&<p className="error-copy" role="alert">{t(error)}</p>}
          </Modal.Body>
          {localOnly ? !checking && <Modal.Footer className="virelo-confirm-footer">
            {onSetup ? <Button onPress={()=>{setOpen(false);onSetup();}}>{t("Set up access from another device")}</Button>
              : <a className="button button--primary" href={`https://virelo.dev${locale==='en'?'':'/'+locale}/setup#network`} target="_blank" rel="noopener noreferrer">{t("Set up access from another device")}</a>}
          </Modal.Footer> : <Modal.Footer className="virelo-confirm-footer">
            {qr&&<a className="communication-download" href={qr} download="virelo-qr.png">{t("Save QR")}</a>}
            <Button onPress={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setError('Copy is unavailable here. Select and copy the link above.');}}}>{copied?<Check/>:<Copy/>}{copied?t("Copied"):t("Copy link")}</Button>
          </Modal.Footer>}
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}

export function SharingSettings({webOnly=false,addresses,onSetup}:ShareProps){
  useLocale();
  return <section id="settings-panel-sharing" className="settings-card settings-section" aria-labelledby="settings-title-sharing">
    <div className="settings-card-head"><div><h2 id="settings-title-sharing" tabIndex={-1}>{t("Sharing")}</h2><p>{webOnly?t("Share the Virelo app with a link or QR code. Your local videos and libraries stay on this device."):t("Open this server on another device with a link or QR code. Existing sign-in and library permissions still apply.")}</p></div></div>
    <ShareButton webOnly={webOnly} addresses={addresses} onSetup={onSetup}/>
  </section>;
}
