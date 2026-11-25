import { createHash,randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { Transform } from 'node:stream';
import type { FastifyInstance,FastifyReply,FastifyRequest } from 'fastify';
import { AccountError } from './accounts.js';
import type { Account } from './auth-types.js';
import { approvedIptvUrl,createIptvUpstream,readIptvOrigins } from './iptv-network.js';
import { relayIptvManifest,type IptvResourceKind } from './iptv-manifest.js';
import { IPTV_CHECK_TIMEOUT_MS,IPTV_MAX_BYTES,IPTV_MAX_SOURCES,iptvStreamChannel,parseIptvChannels,sniffIptvManifest,type IptvCachedCheck,type IptvChannel,type IptvCheckResult,type IptvImport,type IptvSourceInfo } from './iptv-parser.js';

const root='/api/iptv';
const expiry=15*60_000;
const maxSegment=64*1024*1024;
const maxReferences=4096,maxReferenceChars=1024*1024;
type Resource={url:string;kind:IptvResourceKind};
type Session={user:number;source:string;at:number;resources:Map<string,Resource>;referenceChars:number;stop:AbortController};

function requestSignal(reply:FastifyReply,session?:AbortSignal,timeout=25000) {
  const controller=new AbortController();
  reply.raw.once('close',()=>controller.abort());
  return AbortSignal.any([controller.signal,AbortSignal.timeout(timeout),...(session?[session]:[])]);
}

async function readText(response:IncomingMessage) {
  const chunks:Buffer[]=[];
  let size=0;
  for await(const chunk of response){
    if((size+=chunk.length)>IPTV_MAX_BYTES)throw new AccountError('This playlist is too large.',413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function registerIptv(app:FastifyInstance,db:DatabaseSync,fresh:(request:FastifyRequest,admin?:boolean)=>Account) {
  db.exec(`CREATE TABLE IF NOT EXISTS iptv_sources (
    id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,channels TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS iptv_sources_owner ON iptv_sources(user_id);
    CREATE TABLE IF NOT EXISTS iptv_checks (
      source_id TEXT NOT NULL REFERENCES iptv_sources(id) ON DELETE CASCADE,
      channel INTEGER NOT NULL,result TEXT NOT NULL,PRIMARY KEY(source_id,channel));`);
  const readChecks=db.prepare('SELECT result FROM iptv_checks WHERE source_id=?');
  const saveCheck=db.prepare(`INSERT INTO iptv_checks(source_id,channel,result)
    SELECT id,?,? FROM iptv_sources WHERE id=? AND user_id=?
    ON CONFLICT(source_id,channel) DO UPDATE SET result=excluded.result`);
  const readOrigins=db.prepare("SELECT value FROM settings WHERE key='iptvAllowedOrigins'");
  const stored=readOrigins.get() as {value:string}|undefined;
  let origins=new Set<string>();
  try{if(stored)origins=new Set(readIptvOrigins(JSON.parse(stored.value)));}
  catch{ /* A damaged allowlist must fail closed without disabling the video library. */ }
  const upstream=createIptvUpstream(()=>origins);
  const sessions=new Map<string,Session>();
  const checksByUser=new Map<number,number>();
  let activeChecks=0;
  let checkPolicy=new AbortController();
  const stop=(id:string)=>{sessions.get(id)?.stop.abort();sessions.delete(id);};
  const sweep=()=>{for(const [id,session] of sessions)if(Date.now()-session.at>=expiry)stop(id);};
  app.addHook('onClose',async()=>{checkPolicy.abort();for(const id of sessions.keys())stop(id);upstream.close();});

  const viewer=(request:FastifyRequest)=>{
    const user=fresh(request);
    if(!user.permissions.play)throw new AccountError('Your account does not have permission for this action.',403);
    return user.id;
  };
  const source=(id:string,user:number)=>{
    const row=db.prepare('SELECT name,channels FROM iptv_sources WHERE id=? AND user_id=?').get(id,user) as {name:string;channels:string}|undefined;
    if(!row)throw new AccountError('Playlist not found.',404);
    return {id,name:row.name,channels:JSON.parse(row.channels) as IptvChannel[]};
  };
  const channelFor=db.prepare('SELECT json_extract(channels, ?) AS channel FROM iptv_sources WHERE id=? AND user_id=?');
  const storedChannel=(body:{sourceId:string;channel:number}|undefined,user:number):IptvChannel=>{
    if(typeof body?.sourceId!=='string'||!Number.isSafeInteger(body.channel)||body.channel<0)
      throw new AccountError('Playlist not found.',404);
    const row=channelFor.get(`$[${body.channel}]`,body.sourceId,user) as {channel:string|null}|undefined;
    if(!row?.channel)throw new AccountError('Playlist not found.',404);
    return JSON.parse(row.channel) as IptvChannel;
  };
  app.get(root+'/origins',async request=>{fresh(request,true);return {origins:[...origins]};});
  app.put<{Body:{origins?:unknown}}>(root+'/origins',async request=>{
    fresh(request,true);
    const updated=readIptvOrigins(request.body?.origins);
    db.prepare("INSERT INTO settings(key,value) VALUES ('iptvAllowedOrigins',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(updated));
    if(updated.length!==origins.size||updated.some(origin=>!origins.has(origin)))db.exec('DELETE FROM iptv_checks');
    origins=new Set(updated);
    checkPolicy.abort();
    checkPolicy=new AbortController();
    for(const id of sessions.keys())stop(id);
    return {origins:updated};
  });
  app.get(root+'/sources',async request=>db.prepare('SELECT id,name FROM iptv_sources WHERE user_id=? ORDER BY rowid').all(viewer(request)));
  app.get<{Params:{id:string}}>(root+'/sources/:id',async request=>{
    const result=source(request.params.id,viewer(request));
    const checks=readChecks.all(result.id).map(row=>JSON.parse(row.result as string) as IptvCachedCheck);
    return {...result,channels:result.channels.map(({name,groups})=>({name,groups})),checks};
  });
  app.post<{Body:IptvImport}>(root+'/sources',{bodyLimit:IPTV_MAX_BYTES*2+8192},async(request,reply)=>{
    const owner=viewer(request),input=request.body;
    const name=typeof input?.name==='string'?input.name.trim().slice(0,120):'';
    const url=typeof input?.url==='string'?input.url.trim():'';
    const streamUrl=typeof input?.streamUrl==='string'?input.streamUrl.trim():'';
    let text=typeof input?.text==='string'?input.text:'';
    if(!name||[url,text,streamUrl].filter(Boolean).length!==1)
      throw new AccountError('Choose a playlist file, paste its contents or enter a URL.');
    let from:string|undefined;
    if(url){
      const result=await upstream.fetch(url,requestSignal(reply));
      from=result.url.href;
      text=await readText(result.response);
    }
    const channels=(()=>{try{return streamUrl?[iptvStreamChannel(name,streamUrl)]:parseIptvChannels(text,name,from);}
      catch(error){throw new AccountError((error as Error).message);}})();
    if(streamUrl)approvedIptvUrl(channels[0].url,origins);
    if(viewer(request)!==owner)throw new AccountError('Please sign in again.',401);
    const count=db.prepare('SELECT COUNT(*) AS count FROM iptv_sources WHERE user_id=?').get(owner) as {count:number};
    if(count.count>=IPTV_MAX_SOURCES)throw new AccountError('Remove a playlist before adding another.');
    const id=randomUUID();
    db.prepare('INSERT INTO iptv_sources(id,user_id,name,channels) VALUES (?,?,?,?)').run(id,owner,name,JSON.stringify(channels));
    return reply.code(201).send({id,name} satisfies IptvSourceInfo);
  });
  app.delete<{Params:{id:string}}>(root+'/sources/:id',async request=>{
    const owner=viewer(request),{id}=request.params;
    db.prepare('DELETE FROM iptv_sources WHERE id=? AND user_id=?').run(id,owner);
    for(const [key,session] of sessions)if(session.user===owner&&session.source===id)stop(key);
    return {ok:true};
  });
  app.post<{Body:{sourceId:string;channel:number}}>(root+'/check',{bodyLimit:2048},async(request,reply):Promise<IptvCheckResult>=>{
    const user=viewer(request);
    const {url}=storedChannel(request.body,user);
    if(activeChecks>=6||(checksByUser.get(user)??0)>=3)return {status:'unconfirmed'};
    activeChecks++;
    checksByUser.set(user,(checksByUser.get(user)??0)+1);
    const policy=checkPolicy.signal;
    const signal=requestSignal(reply,policy,IPTV_CHECK_TIMEOUT_MS);
    const started=performance.now();
    let body:IncomingMessage|undefined;
    let result:IptvCheckResult;
    try{
      body=(await upstream.fetch(url,signal)).response;
      const chunks=body[Symbol.asyncIterator]();
      result=await sniffIptvManifest(async()=>(await chunks.next()).value as Uint8Array|undefined)
        ? {status:'responding',milliseconds:Math.max(1,Math.round(performance.now()-started))} : {status:'unavailable'};
    }catch(error){
      result={status:error instanceof AccountError&&error.statusCode===403?'not-allowed':
        signal.aborted||!(error instanceof AccountError)||error.statusCode===503?'unconfirmed':'unavailable'};
    }finally{
      body?.destroy();
      activeChecks--;
      const remaining=(checksByUser.get(user)??1)-1;
      if(remaining)checksByUser.set(user,remaining);
      else checksByUser.delete(user);
    }
    if(policy.aborted||reply.raw.destroyed)return {status:'unconfirmed'};
    if(viewer(request)!==user)throw new AccountError('Please sign in again.',401);
    const checked={...result,checkedAt:Date.now()};
    saveCheck.run(request.body.channel,JSON.stringify({...checked,index:request.body.channel}),request.body.sourceId,user);
    return checked;
  });
  app.post<{Body:{sourceId:string;channel:number}}>(root+'/sessions',async(request,reply)=>{
    const user=viewer(request),body=request.body;
    const channel=storedChannel(body,user);
    const url=approvedIptvUrl(channel.url,origins).href;
    sweep();
    const owned=[...sessions].filter(([,session])=>session.user===user);
    if(owned.length>=3)stop(owned[0][0]);
    if(sessions.size>=48)throw new AccountError('Live TV is busy. Try again shortly.',503);
    const id=randomUUID();
    sessions.set(id,{user,source:body.sourceId,at:Date.now(),stop:new AbortController(),referenceChars:url.length,
      resources:new Map([['playlist',{url,kind:'manifest'}]])});
    return reply.code(201).send({id,url:`${root}/stream/${id}/playlist`});
  });
  app.delete<{Params:{id:string}}>(root+'/sessions/:id',async request=>{
    if(sessions.get(request.params.id)?.user===viewer(request))stop(request.params.id);
    return {ok:true};
  });
  app.get<{Params:{id:string;key:string}}>(root+'/stream/:id/:key',{exposeHeadRoute:false},async(request,reply)=>{
    const user=viewer(request),{id,key}=request.params;
    sweep();
    const session=sessions.get(id),resource=session?.resources.get(key);
    if(!session||session.user!==user||!resource)throw new AccountError('This Live TV session has ended.',404);
    session.at=Date.now();
    const manifest=resource.kind==='manifest';
    const {response,url}=await upstream.fetch(resource.url,requestSignal(reply,session.stop.signal),manifest?undefined:request.headers.range);
    if(manifest){
      const text=await readText(response);
      if(viewer(request)!==user||sessions.get(id)!==session)throw new AccountError('This Live TV session has ended.',404);
      const next=new Map<string,Resource>();
      let chars=0;
      const body=relayIptvManifest(text,(reference,kind)=>{
        const address=approvedIptvUrl(reference,origins,url.href).href;
        const key=createHash('sha256').update(kind+' '+address).digest('base64url').slice(0,24);
        if(!next.has(key)){
          chars+=address.length;
          if(chars>maxReferenceChars/2||next.size>=maxReferences/2)throw new AccountError('This playlist is too large.',413);
          next.set(key,{url:address,kind});
        }
        return `${root}/stream/${id}/${key}`;
      });
      for(const [key,entry] of next){
        session.referenceChars-=session.resources.get(key)?.url.length??0;
        session.resources.delete(key);
        session.resources.set(key,entry);
        session.referenceChars+=entry.url.length;
      }
      for(const [key,entry] of session.resources){
        if(session.referenceChars<=maxReferenceChars&&session.resources.size<=maxReferences)break;
        if(key==='playlist'||key===request.params.key||next.has(key))continue;
        session.resources.delete(key);
        session.referenceChars-=entry.url.length;
      }
      return reply.type('application/vnd.apple.mpegurl').send(body);
    }
    const {headers}=response;
    const length=headers['content-length']===undefined?undefined:Number(headers['content-length']);
    const range=headers['content-range'];
    if(length!==undefined&&(!Number.isSafeInteger(length)||length<0||length>maxSegment)
      ||response.statusCode===206&&(!range||!/^bytes \d+-\d+\/(?:\d+|\*)$/.test(range))){
      response.destroy();
      throw new AccountError('Could not reach the Live TV source.',502);
    }
    const mime=headers['content-type']?.split(';')[0];
    reply.type(mime&&/^(?:(?:audio|video)\/[\w.+-]+|text\/vtt)$/i.test(mime)?mime:'application/octet-stream');
    if(length!==undefined)reply.header('Content-Length',length);
    if(response.statusCode===206)reply.code(206).header('Content-Range',range);
    let bytes=0;
    const limit=new Transform({transform(chunk:Buffer,_encoding,done){
      bytes+=chunk.length;
      if(bytes>maxSegment)done(new Error('Could not reach the Live TV source.'));
      else done(null,chunk);
    }});
    response.once('error',()=>limit.destroy(new Error('Could not reach the Live TV source.')));
    limit.once('close',()=>response.destroy());
    return reply.send(response.pipe(limit));
  });
}
