import { useEffect, useState } from 'react';
import { Button, Input, Modal } from '@heroui/react';
import { Check, Copy, ShareNetwork, X } from '@phosphor-icons/react';
import { Select } from './Select';
import { shareLink, shareQr } from '../utils/share';
import './ConfirmationDialog.css';
import './Communication.css';

interface ShareProps { webOnly?:boolean; addresses?:()=>Promise<Array<{url:string;name:string}>>; }
export function ShareButton({webOnly=false,addresses}:ShareProps) {
  const [open,setOpen]=useState(false),[options,setOptions]=useState<Array<{value:string;label:string}>>([]);
  const [origin,setOrigin]=useState(''),[qr,setQr]=useState(''),[error,setError]=useState(''),[copied,setCopied]=useState(false);
  const pathname=window.location.pathname;
  const url=origin?shareLink(origin,pathname,webOnly):'';
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;setOrigin(location.origin);setError('');setCopied(false);setOptions([]);
    if(addresses)void addresses().then(values=>{
      if(cancelled)return;
      setOptions([{value:location.origin,label:'This address'},...values.filter(item=>item.url!==location.origin).map(item=>({value:item.url,label:item.name+' · '+item.url}))]);
      if(['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&values[0])setOrigin(values[0].url);
    }).catch(()=>{if(!cancelled)setError('Network addresses could not be loaded. You can still copy this address.');});
    return()=>{cancelled=true;};
  },[open,addresses]);
  useEffect(()=>{
    let cancelled=false;setQr('');
    if(open&&url)void shareQr(url).then(value=>{if(!cancelled)setQr(value);}).catch(()=>{if(!cancelled)setError('The QR code could not be created. Copy the link instead.');});
    return()=>{cancelled=true;};
  },[open,url]);
  const local=origin&&['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname);
  return <Modal isOpen={open} onOpenChange={setOpen}>
    <Button className="icon-button communication-trigger" isIconOnly variant="ghost" aria-label="Share" onPress={()=>setOpen(true)}><ShareNetwork size={22}/></Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" isDismissable>
      <Modal.Container className="virelo-confirm-container" placement="center" size="sm" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog" aria-label="Share Virelo">
          <Modal.Header className="virelo-confirm-header communication-heading"><Modal.Heading className="virelo-confirm-title">Share Virelo</Modal.Heading><Button isIconOnly variant="ghost" aria-label="Close share" onPress={()=>setOpen(false)}><X/></Button></Modal.Header>
          <Modal.Body className="virelo-confirm-body communication-body">
            <p>{webOnly?'Open Virelo on another device. Local videos, playlists and folders are not transferred.':'Scan to open this server. Sign-in and library permissions still apply; this link does not grant access.'}</p>
            {options.length>1&&<Select label="Server address" value={origin} options={options} onChange={value=>{setOrigin(value);setCopied(false);}}/>}
            <div className="share-qr">{qr?<img src={qr} alt="QR code for the share link" width={256} height={256}/>:<p role="status">Creating QR code…</p>}</div>
            <Input aria-label="Share link" value={url} readOnly onFocus={event=>event.currentTarget.select()}/>
            {!webOnly&&<p className="communication-help">{local?'This localhost address works only on this PC. Start Virelo with --host 0.0.0.0 to allow LAN access.':'The other device must be able to reach this address. A QR code does not open ports or publish your server.'}</p>}
            {error&&<p className="error-copy" role="alert">{error}</p>}
          </Modal.Body>
          <Modal.Footer className="virelo-confirm-footer">
            {qr&&<a className="communication-download" href={qr} download="virelo-qr.gif">Save QR</a>}
            <Button onPress={async()=>{try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setError('Copy is unavailable here. Select and copy the link above.');}}}>{copied?<Check/>:<Copy/>}{copied?'Copied':'Copy link'}</Button>
          </Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}
