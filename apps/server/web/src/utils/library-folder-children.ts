import type { FolderEntry, Library } from '../types';

export function folderDisplayName(library:Library|undefined, folder:string, fallback:string) {
  const names=library?.folderLabels;
  return names&&Object.hasOwn(names,folder)&&typeof names[folder]==='string'?names[folder]:fallback;
}

export function libraryFolderChildren(entries:FolderEntry[],libraries:Library[],selectedId:number|null,folder:string|null) {
  const prefix=folder?folder+'/':'',children=new Map<string,{libraryId:number;folder:string;name:string;count:number}>();
  const visible=new Set(libraries.map(library=>library.id));
  for(const entry of entries) {
    if(!visible.has(entry.library_id)||selectedId!==null&&entry.library_id!==selectedId||!entry.folder.startsWith(prefix))continue;
    const name=entry.folder.slice(prefix.length).split('/')[0];
    if(!name)continue;
    const path=prefix+name,key=entry.library_id+':'+path,current=children.get(key);
    if(current)current.count+=entry.count;
    else children.set(key,{libraryId:entry.library_id,folder:path,name,count:entry.count});
  }
  return [...children.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.libraryId-b.libraryId);
}

