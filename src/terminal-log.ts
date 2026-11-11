import { open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { stripVTControlCharacters } from 'node:util';

export function terminalText(value: string): string {
  return stripVTControlCharacters(value).replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,' ');
}

export interface LogEntry { text: string; level: number }

export function logEntry(raw: string): LogEntry {
  let text=raw,level=0;
  try {
    const record=JSON.parse(raw);
    if(record&&typeof record==='object'){
      level=typeof record.level==='number'?record.level:0;
      const date=typeof record.time==='number'?new Date(record.time):null;
      const time=date&&Number.isFinite(date.getTime())?date.toISOString().slice(11,19)+' ':'';
      const label=level>=50?'ERROR':level>=40?'WARN':level>=30?'INFO':level>=20?'DEBUG':'LOG';
      const details=[record.req?.method,record.req?.url,record.res?.statusCode,record.err?.message].filter(value=>typeof value==='string'||typeof value==='number');
      text=time+label.padEnd(6)+(typeof record.msg==='string'?record.msg:raw)+(details.length?'  '+details.join(' '):'');
    }
  }catch { /* Plain output shares the same live log. */ }
  return {text:terminalText(text).slice(0,8192),level};
}

export class TerminalLog {
  readonly entries: LogEntry[]=[];
  private identity='';
  private previous='';
  private reading=false;
  constructor(private readonly path: string,private readonly limit=1000){}

  async update(): Promise<number> {
    if(this.reading)return 0;
    this.reading=true;
    let handle;
    try {
      handle=await open(this.path,'r');
      const info=await handle.stat(),identity=info.dev+':'+info.ino+':'+info.birthtimeMs;
      const start=Math.max(0,info.size-65536);
      const buffer=Buffer.alloc(Math.min(65536,info.size));
      const {bytesRead}=await handle.read(buffer,0,buffer.length,start);
      let bytes=buffer.subarray(0,bytesRead);
      if(start>0){const end=bytes.indexOf(10);if(end>=0)bytes=bytes.subarray(end+1);}
      const text=new StringDecoder('utf8').write(bytes);
      if(text===this.previous&&identity===this.identity)return 0;
      const last=this.entries.at(-1)?.text;
      const next=text.split(/\r?\n/).filter(line=>line.trim()).slice(-this.limit).map(line=>logEntry(line.length>8192?'… '+line.slice(-8190):line));
      const prior=last&&identity===this.identity?next.findLastIndex(entry=>entry.text===last):-1;
      const added=prior===-1?next.length:next.length-prior-1;
      this.identity=identity;this.previous=text;this.entries.splice(0,this.entries.length,...next);
      return added;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return 0;throw error;}
    finally{await handle?.close();this.reading=false;}
  }
}
