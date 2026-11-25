import { lookup } from 'node:dns/promises';
import { Agent, get } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { AccountError } from './accounts.js';
import { iptvUrl } from './iptv-parser.js';

const ipv4Excluded=new BlockList();
for(const [address,bits] of [
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],
  ['192.0.0.0',24],['192.0.2.0',24],['192.168.0.0',16],['192.88.99.0',24],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
] as const)ipv4Excluded.addSubnet(address,bits);
const global6=new BlockList(),excluded6=new BlockList();
global6.addSubnet('2000::',3,'ipv6');
for(const [address,bits] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]] as const)
  excluded6.addSubnet(address,bits,'ipv6');

export function publicIptvAddress(address:string) {
  const family=isIP(address);
  return family===4?!ipv4Excluded.check(address):family===6&&global6.check(address,'ipv6')&&!excluded6.check(address,'ipv6');
}

function isHostname(url:URL) {
  return url.hostname.includes('.')&&!isIP(url.hostname)&&!url.hostname.endsWith('.');
}

export function approvedIptvUrl(input:string,origins:ReadonlySet<string>,base?:string) {
  const url=iptvUrl(input,base);
  if(!url||!isHostname(url)||!origins.has(url.origin))
    throw new AccountError('This Live TV source is not allowed by the server.',403);
  return url;
}

export function readIptvOrigins(input:unknown) {
  if(!Array.isArray(input)||input.length>32)throw new AccountError('Enter valid HTTPS origins.');
  return [...new Set(input.map(value=>{
    const url=typeof value==='string'?iptvUrl(value):null;
    if(!url||!isHostname(url)||url.pathname!=='/'||url.search||value.includes('#'))
      throw new AccountError('Enter valid HTTPS origins.');
    return url.origin;
  }))];
}

export function createIptvUpstream(origins:()=>ReadonlySet<string>) {
  const agent=new Agent({
    keepAlive:true,maxSockets:6,maxTotalSockets:24,maxFreeSockets:4,timeout:15000,
    lookup(hostname,options,callback){
      // This lookup supplies the verified addresses to the TLS socket, without a second lookup.
      void lookup(hostname,{all:true}).then(addresses=>{
        if(!addresses.length||addresses.some(value=>!publicIptvAddress(value.address)))throw new Error();
        const first=addresses[0];
        callback(null,options.all?addresses:first.address,first.family);
      }).catch(()=>callback(new Error('Could not reach the Live TV source.'),'',0));
    }
  });
  let active=0;
  async function open(url:URL,signal:AbortSignal,range?:string) {
    if(active>=32)throw new AccountError('Live TV is busy. Try again shortly.',503);
    active++;
    try{
      const response=await new Promise<IncomingMessage>((resolve,reject)=>{
        const request=get(url,{agent,signal,headers:{
          'Accept-Encoding':'identity',
          ...(range&&/^bytes=(?:\d{1,14}-\d{0,14}|-\d{1,14})$/.test(range)?{Range:range}:{})
        }},resolve);
        request.once('error',reject);
      });
      response.once('close',()=>{active--;});
      return response;
    }catch{
      active--;
      throw new AccountError('Could not reach the Live TV source.',502);
    }
  }
  return {
    async fetch(input:string,signal:AbortSignal,range?:string) {
      let url=approvedIptvUrl(input,origins());
      for(let count=0;count<=4;count++){
        const response=await open(url,signal,range);
        if([301,302,303,307,308].includes(response.statusCode??0)&&response.headers.location){
          response.destroy();
          url=approvedIptvUrl(response.headers.location,origins(),url.href);
          continue;
        }
        if((response.statusCode===200||response.statusCode===206)&&
          (!response.headers['content-encoding']||response.headers['content-encoding']==='identity'))return {response,url};
        response.destroy();
        break;
      }
      throw new AccountError('Could not reach the Live TV source.',502);
    },
    close:()=>agent.destroy()
  };
}
