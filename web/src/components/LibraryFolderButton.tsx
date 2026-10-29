import { useRef, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Input } from '@heroui/react';
import { DotsThree, PencilSimple } from '@phosphor-icons/react';
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
      <button type="button" className={'folder-chip'+(active?' active':'')+(crumb?' crumb':'')} onClick={onClick}
        onContextMenu={canRename?event=>{event.preventDefault();event.stopPropagation();const keyboard=event.clientX===0&&event.clientY===0;open(event.currentTarget,keyboard?undefined:{x:event.clientX,y:event.clientY},keyboard);}:undefined}
        onKeyDown={canRename?event=>{if(event.key==='ContextMenu'||event.shiftKey&&event.key==='F10'){event.preventDefault();event.stopPropagation();open(event.currentTarget,undefined,true);}}:undefined}>
        {children??label}
      </button>
      {canRename&&<button type="button" className="folder-options" aria-label={t('Options for {value0}',{value0:targetName})} title={t('Options for {value0}',{value0:targetName})} aria-haspopup="menu" aria-expanded={Boolean(menu)}
        onClick={event=>open(event.currentTarget,undefined,event.detail===0)}><DotsThree weight="bold" aria-hidden="true"/></button>}
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

