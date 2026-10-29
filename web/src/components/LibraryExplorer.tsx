import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { ArrowLeft, ArrowRight, ArrowUp, CaretDown, CaretRight, FolderSimple, FolderOpen, House, List } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import { LibraryFolderButton } from './LibraryFolderButton';
import { ExplorerDivider } from './ExplorerDivider';
import { folderKey, libraryAddressSuggestions, resolveLibraryAddress, type ExplorerFolder, type LibraryLocation } from '../utils/library-explorer';
import './LibraryExplorer.css';

interface Props {
  roots:ExplorerFolder[]; nodes:Map<string,ExplorerFolder>; location:LibraryLocation; canRename:boolean;
  canBack:boolean; canForward:boolean; onBack:()=>void; onForward:()=>void; onNavigate:(next:LibraryLocation)=>void;
  children:ReactNode;
}
export function LibraryExplorer({roots,nodes,location,canRename,canBack,canForward,onBack,onForward,onNavigate,children}:Props) {
  useLocale();
  const current=location.libraryId===null?undefined:nodes.get(folderKey(location.libraryId,location.folder??''));
  const address=current?.address??'/';
  const [expanded,setExpanded]=useState<Set<string>>(()=>new Set());
  const [showFolders,setShowFolders]=useState(false);
  const addressInput=useRef<HTMLInputElement>(null);
  useEffect(()=>{
    setExpanded(previous=>{
      const next=new Set(previous);let ancestor=current?.parent;
      while(ancestor){next.add(ancestor);ancestor=nodes.get(ancestor)?.parent;}
      if(current?.folder==='')next.add(current.key);
      return next;
    });
  },[current?.key,nodes]);
  const open=(node:ExplorerFolder)=>{onNavigate({libraryId:node.library.id,folder:node.folder});setShowFolders(false);};
  const parent=()=>onNavigate(current?.parent?{libraryId:current.library.id,folder:nodes.get(current.parent)!.folder}:{libraryId:null,folder:null});
  const toggle=(key:string)=>setExpanded(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});
  return <section className="library-explorer" aria-label={t('Explorer view')} onKeyDown={event=>{
    if(event.altKey&&event.key==='ArrowLeft'&&canBack){event.preventDefault();onBack();}
    else if(event.altKey&&event.key==='ArrowRight'&&canForward){event.preventDefault();onForward();}
    else if(event.altKey&&event.key==='ArrowUp'&&current){event.preventDefault();parent();}
    else if(event.altKey&&event.key.toLowerCase()==='d'){event.preventDefault();addressInput.current?.focus();addressInput.current?.select();}
  }}>
    <div className="explorer-toolbar">
      <div className="explorer-travel">
        <button type="button" aria-label={t('Back')} title={t('Back')} disabled={!canBack} onClick={onBack}><ArrowLeft/></button>
        <button type="button" aria-label={t('Forward')} title={t('Forward')} disabled={!canForward} onClick={onForward}><ArrowRight/></button>
        <button type="button" aria-label={t('Parent folder')} title={t('Parent folder')} disabled={!current} onClick={parent}><ArrowUp/></button>
      </div>
      <LibraryAddress address={address} nodes={nodes} inputRef={addressInput} onNavigate={onNavigate}/>
      <button type="button" className="explorer-folders-toggle" aria-expanded={showFolders} aria-controls="library-explorer-folders" onClick={()=>setShowFolders(value=>!value)}><List/><span>{t('Folders')}</span></button>
    </div>
    <div className="explorer-panes">
      <nav id="library-explorer-folders" className="explorer-sidebar" data-open={showFolders} aria-label={t('Folders')}>
        <button type="button" className={'explorer-home'+(!current?' active':'')} aria-current={!current?'location':undefined} onClick={()=>{onNavigate({libraryId:null,folder:null});setShowFolders(false);}}><House/><span>{t('All libraries')}</span></button>
        <ul>{roots.map(node=><FolderBranch key={node.key} node={node} selected={current?.key} expanded={expanded} onToggle={toggle} onOpen={open} canRename={canRename}/>)}</ul>
      </nav>
      <ExplorerDivider/>
      <div className="explorer-content">
        <div className="explorer-folder-grid">
          {(current?.children??roots).map(node=><LibraryFolderButton key={node.key} library={node.library} folder={node.folder} label={node.name} canRename={canRename} onClick={()=>open(node)}>
            <FolderSimple/><span>{node.name}</span><em>{node.count}</em>
          </LibraryFolderButton>)}
        </div>
        {children}
      </div>
    </div>
  </section>;
}

function FolderBranch({node,selected,expanded,onToggle,onOpen,canRename}:{
  node:ExplorerFolder;selected?:string;expanded:Set<string>;onToggle:(key:string)=>void;onOpen:(node:ExplorerFolder)=>void;canRename:boolean;
}) {
  const open=expanded.has(node.key),active=node.key===selected;
  return <li>
    <div className="explorer-tree-row">
      {node.children.length>0?<button type="button" className="explorer-disclosure" aria-label={t(open?'Collapse {value0}':'Expand {value0}',{value0:node.name})} aria-expanded={open} onClick={()=>onToggle(node.key)}>{open?<CaretDown/>:<CaretRight/>}</button>:<span className="explorer-disclosure"/>}
      <LibraryFolderButton library={node.library} folder={node.folder} label={node.name} active={active} canRename={canRename} onClick={()=>onOpen(node)}>
        {active?<FolderOpen/>:<FolderSimple/>}<span>{node.name}</span>
      </LibraryFolderButton>
    </div>
    {open&&node.children.length>0&&<ul>{node.children.map(child=><FolderBranch key={child.key} node={child} selected={selected} expanded={expanded} onToggle={onToggle} onOpen={onOpen} canRename={canRename}/>)}</ul>}
  </li>;
}

function LibraryAddress({address,nodes,inputRef,onNavigate}:{
  address:string;nodes:Map<string,ExplorerFolder>;inputRef:RefObject<HTMLInputElement|null>;onNavigate:(next:LibraryLocation)=>void;
}) {
  const id=useId(),[draft,setDraft]=useState(address),[focused,setFocused]=useState(false),[selected,setSelected]=useState(-1),[error,setError]=useState(false);
  const cycle=useRef<{options:ExplorerFolder[];index:number;value:string}|null>(null);
  useEffect(()=>{setDraft(address);setError(false);setSelected(-1);cycle.current=null;},[address]);
  const suggestions=focused&&!cycle.current?libraryAddressSuggestions(draft,address,nodes):[];
  const options=suggestions.slice(0,12),visible=focused&&options.length>0;
  const go=(value:string)=>{
    const target=resolveLibraryAddress(value,address,nodes);
    if(!target){setError(true);return;}
    setError(false);setFocused(false);setSelected(-1);cycle.current=null;onNavigate(target);
  };
  return <div className="explorer-address">
    <FolderSimple aria-hidden="true"/>
    <input ref={inputRef} role="combobox" aria-label={t('Path')} aria-autocomplete="list" aria-expanded={visible} aria-controls={id} aria-activedescendant={selected>=0&&visible?id+'-'+selected:undefined} aria-invalid={error||undefined} aria-describedby={error?id+'-error':undefined}
      autoComplete="off" spellCheck={false} value={draft} onFocus={()=>setFocused(true)} onBlur={()=>{setFocused(false);setSelected(-1);}}
      onChange={event=>{setDraft(event.target.value);setFocused(true);setSelected(-1);setError(false);cycle.current=null;}}
      onKeyDown={event=>{
        if(event.nativeEvent.isComposing)return;
        if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(address);setError(false);setFocused(false);setSelected(-1);cycle.current=null;return;}
        if(event.key==='Enter'){event.preventDefault();go(selected>=0&&visible?options[selected].address:draft);return;}
        if((event.key==='ArrowDown'||event.key==='ArrowUp')&&options.length){event.preventDefault();setSelected(index=>(index+(event.key==='ArrowDown'?1:options.length-1)+options.length)%options.length);return;}
        if(event.key==='Tab'&&!event.ctrlKey&&!event.altKey&&!event.metaKey) {
          let completion=cycle.current;
          if(completion?.value!==draft)completion=null;
          if(!completion&&event.shiftKey)return;
          if(!completion){const matches=libraryAddressSuggestions(draft,address,nodes);if(!matches.length)return;completion={options:matches,index:-1,value:draft};}
          event.preventDefault();
          completion.index=(completion.index+(event.shiftKey?completion.options.length-1:1)+completion.options.length)%completion.options.length;
          completion.value=completion.options[completion.index].address+'/';cycle.current=completion;
          setDraft(completion.value);setSelected(-1);setError(false);
        }
      }}/>
    {error&&<span id={id+'-error'} className="explorer-path-error" role="alert">{t('Folder not found.')}</span>}
    {visible&&<ul id={id} role="listbox" aria-label={t('Folder suggestions')}>
      {options.map((node,index)=><li key={node.key} role="presentation"><button type="button" id={id+'-'+index} role="option" aria-selected={selected===index} tabIndex={-1} onMouseDown={event=>event.preventDefault()} onClick={()=>go(node.address)}><FolderSimple/><span>{node.name}<small>{node.address}</small></span></button></li>)}
    </ul>}
  </div>;
}
