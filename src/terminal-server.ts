import { isIP, createServer } from 'node:net';
import { readServerSettings, writeServerSettings } from './server-settings.js';
import { sendControl, type ControlProfile, type ServerSnapshot } from './server-control.js';
import { serverUrl } from './network-urls.js';

export function terminalBrowserUrl(status:ServerSnapshot):string{
  if(!Number.isInteger(status.port)||status.port<1||status.port>65535||!isIP(status.host))throw new Error('Invalid local server address.');
  return serverUrl(status.host==='0.0.0.0'?'127.0.0.1':status.host==='::'?'::1':status.host,status.port);
}
export function terminalPort(value:string):number{
  if(!/^\d{1,5}$/.test(value)||Number(value)>65535)throw new Error('Enter a port from 0 to 65535.');
  return Number(value);
}
export async function saveTerminalPort(profile:ControlProfile,status:ServerSnapshot,value:string){
  const port=terminalPort(value),saved=await readServerSettings(profile.dataDir);
  return writeServerSettings(profile.dataDir,{host:saved?.host??status.host,port});
}
export async function ensureTerminalPortAvailable(profile:ControlProfile,status:ServerSnapshot):Promise<void>{
  const desired=await readServerSettings(profile.dataDir);
  if(!desired||desired.port===0||(desired.port===status.port&&desired.host===status.host))return;
  const listener=createServer();
  try{await new Promise<void>((resolve,reject)=>{listener.once('error',reject);listener.listen({port:desired.port,host:desired.host,exclusive:true},resolve);});}
  catch(error){if((error as NodeJS.ErrnoException).code==='EADDRINUSE')throw new Error('That port is already in use. Choose another port.');throw error;}
  finally{if(listener.listening)await new Promise<void>(resolve=>listener.close(()=>resolve()));}
}
export async function waitForTerminalRestart(profile:ControlProfile,pid:number,timeout=40000):Promise<ServerSnapshot>{
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
    const reply=await sendControl(profile,{action:'status'}).catch(()=>null);
    if(reply?.ok&&reply.status.pid!==pid)return reply.status;
    await new Promise(resolve=>setTimeout(resolve,200));
  }
  throw new Error('Restart was not confirmed. Check Live logs or start Virelo again.');
}
