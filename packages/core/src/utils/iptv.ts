// M3U parsing adapted from Riyoway/iptv-player (6aec6d8), MIT.
// Copyright (c) 2026 IPTV Player contributors. See IPTV-PLAYER-MIT.txt.
export const IPTV_MAX_BYTES=8*1024*1024;
export const IPTV_MAX_SOURCES=12;
export const IPTV_CHECK_TIMEOUT_MS=4500;
const maxChannels=20000;

export type IptvChannel={name:string;groups:string[];url:string};
export type IptvChannelInfo=Omit<IptvChannel,'url'>;
export type IptvSourceInfo={id:string;name:string};
export type IptvSource=IptvSourceInfo&{channels:IptvChannel[]};
export type IptvImport={name:string;url?:string;text?:string};
export type IptvCheckResult=({status:'responding';milliseconds:number}|{status:'unavailable'|'unconfirmed'|'not-allowed'})&{checkedAt?:number};
export type IptvCachedCheck=IptvCheckResult&{index:number;checkedAt:number};
export type IptvGuide={channels:IptvChannelInfo[];checks:IptvCachedCheck[]};

export function iptvUrl(value:string,base?:string):URL|null {
  if(!value||value.length>4096)return null;
  try{
    const url=new URL(value,base);
    if(url.protocol!=='https:'||url.username||url.password)return null;
    url.hash='';
    return url;
  }catch{return null;}
}

export function isHlsManifest(content:string) {
  return content.trimStart().startsWith('#EXTM3U')&&
    /^#EXT-X-(?:TARGETDURATION|MEDIA-SEQUENCE|STREAM-INF|I-FRAME-STREAM-INF|PLAYLIST-TYPE|ENDLIST|MAP|PART|SERVER-CONTROL)[:\r]?/m.test(content);
}

// A connection check only identifies the entry playlist, never its variants or segments.
export async function sniffIptvManifest(read:()=>Promise<Uint8Array|undefined>) {
  const decoder=new TextDecoder();
  let text='',remaining=16*1024;
  while(remaining>0){
    const chunk=await read();
    if(!chunk)break;
    text+=decoder.decode(chunk.subarray(0,remaining),{stream:true});
    remaining-=chunk.byteLength;
    const start=text.trimStart();
    if(start.length>=7&&!start.startsWith('#EXTM3U'))return false;
    if(isHlsManifest(text))return true;
  }
  return false;
}

function attributes(line:string) {
  return new Map([...line.matchAll(/([\w-]+)=(?:"([^"]*)"|'([^']*)'|([^\s,]*))/g)]
    .map(match=>[match[1].toLowerCase(),match[2]??match[3]??match[4]??'']));
}
function title(line:string) {
  let quote='';
  for(let index=0;index<line.length;index++){
    const char=line[index];
    if((char==='"'||char==="'")&&line[index-1]!=='\\')quote=quote===char?'':quote||char;
    else if(char===','&&!quote)return line.slice(index+1).trim();
  }
  return '';
}
const groups=(value:string)=>[...new Set(value.split(';').map(group=>group.trim().slice(0,90)).filter(Boolean))].slice(0,12);

export function parseIptvChannels(content:string, name:string, from?:string):IptvChannel[] {
  if(content.length>IPTV_MAX_BYTES||new TextEncoder().encode(content).length>IPTV_MAX_BYTES)
    throw new Error('This playlist is too large.');
  const lines=content.replace(/^\uFEFF/,'').split(/\r?\n/);
  if(isHlsManifest(content)){
    const url=from&&iptvUrl(from);
    if(!url)throw new Error('Use an HTTPS link for a single HLS stream.');
    return [{name,groups:[],url:url.href}];
  }
  if(!content.trimStart().startsWith('#EXTM3U')&&!/^#EXTINF:/m.test(content))
    throw new Error('This is not an M3U playlist.');
  const channels:IptvChannel[]=[];
  let label='',tags:string[]=[];
  for(const raw of lines){
    const line=raw.trim();
    if(!line)continue;
    if(line.startsWith('#EXTINF:')){
      const attrs=attributes(line);
      label=attrs.get('tvg-name')||title(line);
      tags=groups(attrs.get('group-title')||'');
      continue;
    }
    if(line.startsWith('#EXTGRP:')){
      if(!tags.length)tags=groups(line.slice(8));
      continue;
    }
    if(line.startsWith('#'))continue;
    const url=iptvUrl(line,from);
    if(url)channels.push({name:label.slice(0,160),groups:tags,url:url.href});
    if(channels.length>maxChannels)throw new Error('This playlist is too large.');
    label='';tags=[];
  }
  if(!channels.length)throw new Error('No HTTPS channels were found.');
  return channels;
}
