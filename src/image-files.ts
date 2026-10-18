import { access, lstat, mkdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';

export async function imageFileExists(path:string|null|undefined){
  if(!path)return false;
  try{
    const info=await stat(path);
    if(!info.isFile()||info.size===0)return false;
    await access(path,constants.R_OK);
    return true;
  }catch{return false;}
}

export async function prepareImageDirectory(target:string){
  const directory=dirname(target);
  await mkdir(directory,{recursive:true});
  if((await lstat(directory)).isSymbolicLink())throw Error('Generated image folders must not be filesystem links.');
  const info=await lstat(target).catch(reason=>{
    if((reason as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw reason;
  });
  if(info&&(info.isSymbolicLink()||!info.isFile()))throw Error('Invalid generated image target.');
}
