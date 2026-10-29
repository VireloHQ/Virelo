import type { FolderEntry, Library } from '../types';
import { folderDisplayName } from './library-folder-children';

export interface LibraryLocation { libraryId:number|null; folder:string|null; }
export interface ExplorerFolder {
  key:string; library:Library; folder:string; name:string; address:string; aliasAddress:string;
  parent:string|null; count:number; children:ExplorerFolder[];
}
export const folderKey=(id:number,folder:string)=>id+':'+folder;
const segment=(value:string)=>value==='.'||value==='..'?value.replaceAll('.','%2E'):value.replaceAll('%','%25').replaceAll('/','%2F').replaceAll('\\','%5C');
const folded=(value:string)=>value.toLowerCase();

export function explorerFolders(libraries:Library[],entries:FolderEntry[]) {
  const nodes=new Map<string,ExplorerFolder>(),roots:ExplorerFolder[]=[],used=new Set<string>();
  const labels=new Map<string,number>();
  for(const library of libraries)labels.set(folded(library.label),(labels.get(folded(library.label))??0)+1);
  for(const library of libraries) {
    let name=library.label;
    if((labels.get(folded(name))??0)>1)name+=' ['+library.id+']';
    while(used.has(folded(name))||name!==library.label&&labels.has(folded(name)))name+=' ['+library.id+']';
    used.add(folded(name));
    const root:ExplorerFolder={key:folderKey(library.id,''),library,folder:'',name:library.label,address:'/'+segment(name),aliasAddress:'/'+segment(name),parent:null,count:0,children:[]};
    nodes.set(root.key,root);roots.push(root);
  }
  for(const entry of entries) {
    const root=nodes.get(folderKey(entry.library_id,''));if(!root)continue;
    let parent=root;parent.count+=entry.count;
    const parts=entry.folder?entry.folder.split('/'):[];
    for(let i=0;i<parts.length;i++) {
      const path=parts.slice(0,i+1).join('/'),key=folderKey(entry.library_id,path);
      let node=nodes.get(key);
      if(!node) {
        const name=folderDisplayName(root.library,path,parts[i]);
        node={key,library:root.library,folder:path,name,address:parent.address+'/'+segment(parts[i]),aliasAddress:parent.aliasAddress+'/'+segment(name),parent:parent.key,count:0,children:[]};
        nodes.set(key,node);parent.children.push(node);
      }
      node.count+=entry.count;parent=node;
    }
  }
  for(const node of nodes.values())node.children.sort((a,b)=>a.name.localeCompare(b.name)||a.folder.localeCompare(b.folder));
  roots.sort((a,b)=>a.name.localeCompare(b.name)||a.library.id-b.library.id);
  return {roots,nodes};
}

function normalizeAddress(value:string,current:string) {
  const parts=value.trim().replaceAll('\\','/').startsWith('/')?[]:current.split('/').filter(Boolean);
  for(const part of value.trim().replaceAll('\\','/').split('/')) {
    if(!part||part==='.')continue;
    if(part==='..'){parts.pop();continue;}
    try {parts.push(segment(decodeURIComponent(part)));}catch{return null;}
  }
  return '/'+parts.join('/');
}

export function resolveLibraryAddress(value:string,current:string,nodes:Map<string,ExplorerFolder>):LibraryLocation|null {
  const address=normalizeAddress(value,current);
  if(address==='/')return {libraryId:null,folder:null};
  if(!address)return null;
  const all=[...nodes.values()];
  const exact=all.find(node=>node.address===address);
  const matches=exact?[exact]:all.filter(node=>folded(node.address)===folded(address)||folded(node.aliasAddress)===folded(address));
  return matches.length===1?{libraryId:matches[0].library.id,folder:matches[0].folder}:null;
}

export function libraryAddressSuggestions(value:string,current:string,nodes:Map<string,ExplorerFolder>) {
  const address=value.trim()?normalizeAddress(value,current):'/';
  if(!address)return [];
  const prefix=value.trim().endsWith('/')?address.replace(/\/$/,'')+'/':address;
  const matches=[...nodes.values()].filter(node=>{
    for(const path of [node.address,node.aliasAddress]) {
      if(!folded(path).startsWith(folded(prefix)))continue;
      if(!path.slice(prefix.length).includes('/')&&path!==address)return true;
    }
    return false;
  });
  return matches.sort((a,b)=>a.address.localeCompare(b.address));
}

export function navigateLibraryHistory(history:{items:LibraryLocation[];index:number},next:LibraryLocation) {
  const current=history.items[history.index];
  if(current.libraryId===next.libraryId&&current.folder===next.folder)return history;
  return {items:[...history.items.slice(0,history.index+1),next].slice(-100),index:Math.min(history.index+1,99)};
}
