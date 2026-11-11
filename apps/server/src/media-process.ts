import { spawn } from 'node:child_process';
import { mediaScheduler, type MediaWorkOptions } from './media-work.js';

export function runMediaProcess(command:string,args:string[],options:MediaWorkOptions&{timeout:number;maxOutput?:number}){
  return mediaScheduler.run(signal=>runMediaProcessInSlot(command,args,{...options,signal}),options);
}

// Callers holding a scheduler slot can include file preparation/finalization in the same work unit.
export function runMediaProcessInSlot(command:string,args:string[],options:{signal:AbortSignal;timeout:number;maxOutput?:number}){
  const {signal}=options;
  return new Promise<{stdout:Buffer;stderr:string}>((resolve,reject)=>{
    if(signal.aborted){reject(new Error('Media work was cancelled.'));return;}
    const child=spawn(command,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
    const chunks:Buffer[]=[];let bytes=0,stderr='',failure:Error|undefined,finished=false;
    let force:NodeJS.Timeout|undefined;
    const stop=(reason:Error)=>{if(failure)return;failure=reason;child.kill('SIGTERM');force=setTimeout(()=>child.kill('SIGKILL'),1000);force.unref();};
    const abort=()=>stop(new Error('Media work was cancelled.'));
    const timer=setTimeout(()=>stop(new Error('Media processing timed out.')),options.timeout);timer.unref();
    const finish=(error?:Error)=>{
      if(finished)return;finished=true;clearTimeout(timer);clearTimeout(force);signal.removeEventListener('abort',abort);
      if(error||failure)reject(failure??error);else resolve({stdout:Buffer.concat(chunks),stderr});
    };
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>(options.maxOutput??2*1024*1024)){stop(new Error('Media processing output exceeds the size limit.'));return;}chunks.push(Buffer.from(chunk));});
    child.stderr.on('data',chunk=>{stderr=(stderr+String(chunk)).slice(-1000);});
    child.once('error',error=>finish(error));
    child.once('close',code=>finish(code===0?undefined:new Error(stderr.trim()||'Media processing failed.')));
  });
}
