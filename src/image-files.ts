import { lstat, mkdir, open } from 'node:fs/promises';
import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

function generatedLocation(target:string,root:string){
  root=resolve(root);target=resolve(target);
  const info=lstatSync(root,{throwIfNoEntry:false});
  if(!info?.isDirectory()||info.isSymbolicLink())throw Error('Generated folders must not be filesystem links.');
  const actualRoot=realpathSync.native(root),within=(rest:string)=>rest&&rest!=='..'&&!rest.startsWith('..'+sep)&&!isAbsolute(rest);
  let rest=relative(root,target);
  if(!within(rest))rest=relative(actualRoot,target);
  if(!within(rest)){
    let parent=dirname(target),anchor:string|undefined;
    for(;;){
      try{if(!relative(actualRoot,realpathSync.native(parent)))anchor=parent;}catch{}
      const next=dirname(parent);if(next===parent)break;parent=next;
    }
    // Use the outermost matching ancestor so links inside the generated tree remain visible.
    if(!anchor||lstatSync(anchor).isSymbolicLink())throw Error('Invalid generated file path.');
    rest=relative(anchor,target);
  }
  if(!within(rest))throw Error('Invalid generated file path.');
  return {root:actualRoot,target:resolve(actualRoot,rest)};
}

export function generatedFileInfo(target:string,root:string){
  ({target,root}=generatedLocation(target,root));const rest=relative(root,target);
  let parent=root;
  for(const part of rest.split(sep)){
    const info=lstatSync(parent,{throwIfNoEntry:false});
    if(!info?.isDirectory()||info.isSymbolicLink())throw Error('Generated folders must not be filesystem links.');
    parent=join(parent,part);
  }
  const info=lstatSync(target,{throwIfNoEntry:false});
  if(!info?.isFile()||info.isSymbolicLink()||info.nlink>1)throw Error('Invalid generated file target.');
  return info;
}

export async function imageFileExists(path:string|null|undefined){
  if(!path)return false;
  let file;
  try{
    file=await open(path,'r');const info=await file.stat();
    if(!info.isFile()||info.size<24)return false;
    const head=Buffer.alloc(32),tail=Buffer.alloc(12);
    await file.read(head,0,head.length,0);await file.read(tail,0,tail.length,info.size-tail.length);
    // shortcut: container checks do not decode pixels; use a decoder for damaged image payloads.
    if(head[0]===0xff&&head[1]===0xd8&&head[2]===0xff)return tail[10]===0xff&&tail[11]===0xd9;
    if(head.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
      return head.toString('ascii',12,16)==='IHDR'&&head.readUInt32BE(16)>0&&head.readUInt32BE(20)>0&&tail.equals(Buffer.from('0000000049454e44ae426082','hex'));
    if(head.toString('ascii',0,4)==='RIFF'&&head.toString('ascii',8,12)==='WEBP')return head.readUInt32LE(4)+8===info.size;
    if(['GIF87a','GIF89a'].includes(head.toString('ascii',0,6)))return head.readUInt16LE(6)>0&&head.readUInt16LE(8)>0&&tail[11]===0x3b;
    return head.toString('ascii',4,8)==='ftyp'&&/(?:avif|avis)/.test(head.toString('ascii',8));
  }catch{return false;}
  finally{await file?.close();}
}

export async function prepareGeneratedFile(target:string,root=dirname(target)){
  await mkdir(root,{recursive:true});
  ({target,root}=generatedLocation(target,root));
  let directory=root;
  for(const part of ['',...relative(root,dirname(target)).split(sep).filter(Boolean)]){
    directory=join(directory,part);await mkdir(directory).catch(reason=>{if((reason as NodeJS.ErrnoException).code!=='EEXIST')throw reason;});
    const info=await lstat(directory);
    if(info.isSymbolicLink()||!info.isDirectory())throw Error('Generated folders must not be filesystem links.');
  }
  const info=await lstat(target).catch(reason=>{
    if((reason as NodeJS.ErrnoException).code==='ENOENT')return null;
    throw reason;
  });
  if(info&&(info.isSymbolicLink()||!info.isFile()||info.nlink>1))throw Error('Invalid generated file target.');
}
