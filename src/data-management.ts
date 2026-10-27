import { lstat, readdir, realpath } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { DataCategory, DataUsage } from './types.js';

async function inspect(path:string){
  try{return await lstat(path);}
  catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')return null;throw reason;}
}

export async function dataUsage(dataDir:string,cacheLimitBytes:number):Promise<DataUsage>{
  const root=await realpath(dataDir);
  const result:DataUsage={dataDir:resolve(dataDir),totalBytes:0,cacheLimitBytes,skippedLinks:0,
    categories:{database:{bytes:0,files:0},thumbnails:{bytes:0,files:0},artwork:{bytes:0,files:0},cache:{bytes:0,files:0}}};
  const measure=async(path:string,category:DataCategory):Promise<void>=>{
    const info=await inspect(path);
    if(!info)return;
    if(info.isSymbolicLink()){result.skippedLinks++;return;}
    if(info.isFile()){
      result.categories[category].bytes+=info.size;result.categories[category].files++;result.totalBytes+=info.size;
    }else if(info.isDirectory()){
      let children;
      try{children=await readdir(path);}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')return;throw reason;}
      for(const name of children)await measure(join(path,name),category);
    }
  };
  await Promise.all([
    ...['virelo.db','virelo.db-wal','virelo.db-shm'].map(name=>measure(join(root,name),'database')),
    ...(['thumbnails','artwork','cache'] as const).map(category=>measure(join(root,category),category))
  ]);
  return result;
}

const contains=(parent:string,path:string)=>{
  const rest=relative(parent,path);
  return rest!=='..'&&!rest.startsWith('..'+sep)&&!isAbsolute(rest);
};

export function assertSeparateCache(dataDir:string,libraryPaths:string[]){
  const cache=realpathSync.native(join(dataDir,'cache'));
  for(const path of libraryPaths){
    let library;
    try{library=realpathSync.native(path);}catch(reason){
      if((reason as NodeJS.ErrnoException).code==='ENOENT')library=resolve(path);
      else throw reason;
    }
    if(contains(cache,library)||contains(library,cache))throw Object.assign(
      Error('Cache cleanup is unavailable because the cache folder overlaps a media library. Use a separate data directory.'),{statusCode:409});
  }
}
