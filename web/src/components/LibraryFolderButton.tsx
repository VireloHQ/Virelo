import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@heroui/react';
import { PencilSimple } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { api } from '../api';
import type { Library } from '../types';
import type { ContextMenuPosition } from '../utils/context-menu';
import { libraryName } from '../utils/library-names';
import { ConfirmationDialog } from './ConfirmationDialog';
import { PlayerActionMenu } from './PlayerActionMenu';
import './LibraryFolderButton.css';

export function LibraryFolderButton({library,folder='',label,active=false,crumb=false,canRename,onClick,children}:{
  library:Library;folder?:string;label:string;active?:boolean;crumb?:boolean;canRename:boolean;onClick:()=>void;children?:ReactNode;
}) {
  useLocale();
  const targetName=folder?library.label+' / '+label:label;
  const returnFocus=useRef<HTMLElement|null>(null);
  const [menu,setMenu]=useState<{position:ContextMenuPosition;trigger:HTMLElement}|null>(null);
  const [editing,setEditing]=useState<'pointer'|'keyboard'>();
  const [holding,setHolding]=useState(false);
  const press=useRef<{id:number;x:number;y:number;timer:number}|null>(null);
  const suppressClick=useRef(false);
  const releaseGuard=useRef<(()=>void)|null>(null);
  const stopPress=useCallback(()=>{if(press.current)window.clearTimeout(press.current.timer);press.current=null;setHolding(false);},[]);
  useEffect(()=>()=>{if(press.current)window.clearTimeout(press.current.timer);releaseGuard.current?.();},[]);
  // Releasing a touch can click the menu that just appeared beneath the finger.
  const guardRelease=()=>{
    releaseGuard.current?.();
    const clear=()=>{window.removeEventListener('click',swallow,true);window.removeEventListener('pointerdown',clear,true);window.removeEventListener('keydown',clear,true);releaseGuard.current=null;};
    const swallow=(event:MouseEvent)=>{if(event.detail===0)return;event.preventDefault();event.stopImmediatePropagation();clear();};
    releaseGuard.current=clear;
    window.addEventListener('click',swallow,true);window.addEventListener('pointerdown',clear,true);window.addEventListener('keydown',clear,true);
  };
  useEffect(()=>{
    if(!holding)return;
    const cancel=()=>{suppressClick.current=true;stopPress();};
    const anotherPointer=(event:PointerEvent)=>{if(!event.isPrimary)cancel();};
    window.addEventListener('scroll',cancel,true);window.addEventListener('blur',cancel);window.addEventListener('pointerdown',anotherPointer);
    return()=>{window.removeEventListener('scroll',cancel,true);window.removeEventListener('blur',cancel);window.removeEventListener('pointerdown',anotherPointer);};
  },[holding,stopPress]);
  const open=(trigger:HTMLElement,position?:ContextMenuPosition,keyboard=false)=>{
    const rect=trigger.getBoundingClientRect();returnFocus.current=trigger;
    setMenu({trigger,position:position??{x:rect.right,y:rect.top+rect.height/2,keyboard}});
  };
  const close=()=>{
    setEditing(undefined);
    requestAnimationFrame(()=>{if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});});
  };
  return <>
    <span className="folder-control" data-rename={canRename||undefined}>
      <button type="button" className={'folder-chip'+(active?' active':'')+(crumb?' crumb':'')} data-holding={holding||undefined}
        aria-haspopup={canRename?'menu':undefined} aria-expanded={canRename?Boolean(menu):undefined}
        onClick={event=>{if(suppressClick.current&&event.detail!==0){event.preventDefault();suppressClick.current=false;return;}suppressClick.current=false;onClick();}}
        onPointerDown={event=>{
          if(!event.isPrimary){suppressClick.current=true;stopPress();return;}
          suppressClick.current=false;
          stopPress();
          if(!canRename||event.pointerType!=='touch'&&event.pointerType!=='pen')return;
          if(event.button!==0)return;
          const trigger=event.currentTarget,x=event.clientX,y=event.clientY;
          press.current={id:event.pointerId,x,y,timer:window.setTimeout(()=>{suppressClick.current=true;guardRelease();stopPress();open(trigger,{x,y});},520)};
          setHolding(true);
        }}
        onPointerMove={event=>{const start=press.current;if(start&&start.id===event.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>8){suppressClick.current=true;stopPress();}}}
        onPointerUp={stopPress}
        onPointerCancel={()=>{if(press.current)suppressClick.current=true;stopPress();}}
        onPointerLeave={()=>{if(press.current){suppressClick.current=true;stopPress();}}}
        onContextMenu={canRename?event=>{event.preventDefault();event.stopPropagation();if(menu)return;if(press.current){suppressClick.current=true;guardRelease();}stopPress();const keyboard=event.clientX===0&&event.clientY===0;open(event.currentTarget,keyboard?undefined:{x:event.clientX,y:event.clientY},keyboard);}:undefined}
        onKeyDown={canRename?event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();open(event.currentTarget,undefined,true);}}:undefined}>
        {children??label}
      </button>
    </span>
    {menu&&<PlayerActionMenu position={menu.position} label={t('{value0} actions',{value0:targetName})} returnFocus={menu.trigger} onClose={()=>setMenu(null)}
      actions={[{label:t('Rename'),icon:<PencilSimple/>,action:()=>setEditing(menu.position.keyboard?'keyboard':'pointer')}]}/>}
    {editing&&<LibraryNameDialog library={library} folder={folder} label={label} mode={editing} onClose={close}/>}
  </>;
}

function LibraryNameDialog({library,folder,label,mode,onClose}:{library:Library;folder:string;label:string;mode:'pointer'|'keyboard';onClose:()=>void}) {
  useLocale();
  const [name,setName]=useState(label),client=useQueryClient();
  const rename=useMutation({mutationFn:()=>api.renameLibrary(library.id,libraryName(name),folder),
    onSuccess:()=>client.invalidateQueries({predicate:query=>['libraries','account-libraries','previous-libraries'].includes(String(query.queryKey[0]))})});
  return <ConfirmationDialog triggerLabel={t('Rename')} title={t(folder?'Rename folder':'Rename library')} confirmLabel={t('Save')} confirmVariant="primary" initialOpen={mode} onAfterClose={onClose} onConfirm={()=>rename.mutateAsync()}>
    <label className="library-name-field"><span>{t('Display name')}</span><Input autoFocus aria-label={t('Display name')} maxLength={200} value={name} disabled={rename.isPending} onChange={event=>setName(event.target.value)}/></label>
  </ConfirmationDialog>;
}

