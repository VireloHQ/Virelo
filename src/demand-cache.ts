import { lstat, readdir } from 'node:fs/promises';
import { lstatSync, unlinkSync, utimesSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

export const SEGMENT_MAX_BYTES=32*1024*1024;
export class DemandCache {
  readonly root:string;
  private entries=new Map<string,{size:number;used:number}>();
  private pins=new Map<string,number>();
  private reserved=0;
  private safetyCheck:()=>void=()=>{};
  private initialized:Promise<void>|undefined;
  private serial:Promise<void>=Promise.resolve();
  constructor(dataDir:string,readonly limit=512*1024*1024){this.root=resolve(dataDir,'cache');}
  setSafetyCheck(check:()=>void){this.safetyCheck=check;}
  private safe(path:string){const rel=relative(this.root,resolve(path));if(!rel||rel.startsWith('..')||isAbsolute(rel))throw Error('Invalid cache path');}
  private async scan(dir:string){
    let children;
    try{children=await readdir(dir,{withFileTypes:true});}catch(reason){if((reason as NodeJS.ErrnoException).code==='ENOENT')return;throw reason;}
    for(const entry of children){
      const path=join(dir,entry.name),info=await lstat(path).catch(reason=>{
        if((reason as NodeJS.ErrnoException).code==='ENOENT')return null;
        throw reason;
      });
      if(!info)continue;
      if(info.isSymbolicLink())throw Error('Playback cache must not contain filesystem links.');
      if(info.isDirectory())await this.scan(path);
      else if(info.isFile()&&/^(?:segment-\d+\.ts(?:\.part|\.tmp)?|(?:index|master)\.m3u8(?:\.tmp)?|\d+\.vtt)$/.test(entry.name))this.entries.set(path,{size:info.size,used:info.mtimeMs});
    }
  }
  private async discover(){
      const inspect=(path:string)=>lstat(path).catch(reason=>{
        if((reason as NodeJS.ErrnoException).code==='ENOENT')return null;
        throw reason;
      });
      const rootInfo=await inspect(this.root);
      if(rootInfo?.isSymbolicLink())throw Error('Playback cache root must not be a filesystem link.');
      for(const directory of ['hls','audio','segments-v1','segments-v2']){
        const path=join(this.root,directory),info=await inspect(path);
        if(info?.isSymbolicLink())throw Error('Playback cache must not contain filesystem links.');
        if(info?.isDirectory())await this.scan(path);
      }
  }
  async init(){
    await(this.initialized??=this.discover());
  }
  pin(path:string){this.safe(path);this.pins.set(path,(this.pins.get(path)??0)+1);let released=false;return()=>{if(released)return;released=true;const count=(this.pins.get(path)??1)-1;if(count)this.pins.set(path,count);else this.pins.delete(path);};}
  private locked<T>(work:()=>T|Promise<T>):Promise<T>{const next=this.serial.then(work);this.serial=next.then(()=>{},()=>{});return next;}
  async prune(reserve=0){
    this.safetyCheck();
    await this.init();
    await this.locked(()=>this.pruneEntries(reserve));
  }
  private pruneEntries(reserve:number){
    this.safetyCheck();
    let total=this.bytes+this.reserved;
    for(const [path,entry] of [...this.entries].sort((a,b)=>a[1].used-b[1].used)){
      if(total+reserve<=this.limit)break;
      if(this.isPinned(path))continue;
      this.removeFile(path);this.entries.delete(path);total-=entry.size;
    }
    if(total+reserve>this.limit)throw Error('Playback cache is busy. Try again after another stream finishes.');
  }
  async reserve(bytes:number){
    this.safetyCheck();
    await this.init();
    await this.locked(()=>{this.pruneEntries(bytes);this.reserved+=bytes;});
    let released=false;
    return ()=>{if(!released){released=true;this.reserved-=bytes;}};
  }
  private fileInfo(path:string){
    this.safe(path);
    // Recheck every parent: a directory may have become a junction since initialization.
    let parent=this.root;
    for(const part of relative(this.root,path).split(sep)){
      const info=lstatSync(parent,{throwIfNoEntry:false});
      if(!info)return null;
      if(info.isSymbolicLink()||!info.isDirectory())throw Error('Playback cache must not contain filesystem links.');
      parent=join(parent,part);
    }
    const info=lstatSync(path,{throwIfNoEntry:false});
    if(!info)return null;
    if(info.isSymbolicLink()||!info.isFile())throw Error('Invalid playback cache file.');
    if(info.nlink>1)throw Error('Playback cache files must not be hard links.');
    return info;
  }
  private removeFile(path:string){
    this.safetyCheck();
    const info=this.fileInfo(path);
    if(!info)return null;
    unlinkSync(path);return info.size;
  }
  discard(path:string){
    this.removeFile(path);this.entries.delete(path);
  }
  async clearUnused(authorize:()=>void=()=>{}){
    this.safetyCheck();
    await this.init();
    return this.locked(async()=>{
      this.entries.clear();await this.discover();
      authorize();
      let deletedFiles=0,freedBytes=0,inspected=0;
      for(const [path] of [...this.entries]){
        if(++inspected%100===0){await setImmediate();authorize();}
        if(this.isPinned(path)||path.endsWith('.vtt'))continue;
        try{
          // No await between the pin check and unlink: a new request cannot lose its segment.
          const bytes=this.removeFile(path);
          if(bytes!==null){deletedFiles++;freedBytes+=bytes;}
          this.entries.delete(path);
        }catch(reason){
          if(!['EBUSY','EPERM','EACCES'].includes((reason as NodeJS.ErrnoException).code??''))throw reason;
        }
      }
      return {deletedFiles,freedBytes,retainedFiles:this.entries.size,retainedBytes:this.bytes};
    });
  }
  async lookup(path:string){
    this.safetyCheck();
    await this.init();this.safe(path);const entry=this.entries.get(path);if(!entry)return false;
    const info=this.fileInfo(path);
    if(!info){this.entries.delete(path);return false;}
    entry.used=Date.now();try{utimesSync(path,new Date(),new Date());}catch{}return true;
  }
  async record(path:string){this.safetyCheck();const info=this.fileInfo(path);if(!info)throw Error('Playback cache file is unavailable.');this.entries.set(path,{size:info.size,used:Date.now()});}
  get bytes(){return [...this.entries.values()].reduce((sum,entry)=>sum+entry.size,0);}
  isPinned(path:string){return this.pins.has(path)||this.pins.has(path.replace(/\.(?:part|tmp)$/, ''));}
}
