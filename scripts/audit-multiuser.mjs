// Isolated HTTP/media regression: synthetic files, private accounts, ephemeral port.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, link, stat, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import childProcess, { execFileSync, fork } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { performance } from 'node:perf_hooks';

if(process.argv[2]==='server'){
  process.env.VIRELO_LOG_LEVEL='silent';
  const root=process.argv[3],spawn=childProcess.spawn;
  let heavy=0,fast=0,metrics;
  const reset=()=>{metrics={segments:0,encoders:[],maxHeavy:heavy,maxTools:heavy+fast};};reset();
  childProcess.spawn=function(command,args,...rest){
    const child=spawn.call(this,command,args,...rest);
    const segment=args.includes('-output_ts_offset'),codec=args.includes('-c:v')?args[args.indexOf('-c:v')+1]:'audio-only';
    const interactive=segment&&(codec==='audio-only'||codec==='copy');
    if(interactive)fast++;else heavy++;
    metrics.maxHeavy=Math.max(metrics.maxHeavy,heavy);metrics.maxTools=Math.max(metrics.maxTools,heavy+fast);
    if(segment){metrics.segments++;metrics.encoders.push(codec);}
    child.once('close',()=>{if(interactive)fast--;else heavy--;});return child;
  };syncBuiltinESMExports();
  const {createVireloServer}=await import('../dist/server.js'),{hashPassword}=await import('../dist/accounts.js');
  const {hasFfmpeg,hasFfprobe}=await import('../dist/ffmpeg.js');
  assert.ok(await hasFfmpeg());assert.ok(await hasFfprobe());
  const server=await createVireloServer({dataDir:join(root,'data'),mediaPaths:[],host:'127.0.0.1',port:0});
  server.db.updateSettings({libraryWatchEnabled:false,externalMetadataEnabled:false});
  const library=server.db.addLibrary(join(root,'media'),'Synthetic media'),ids=[];
  for(let i=0;i<8;i++){
    const path=join(root,'media',i+'.mp4'),info=await stat(path);
    ids.push(server.db.upsertMedia({library_id:library.id,path,filename:i+'.mp4',title:'Clip '+i,sort_title:String(i),kind:'video',folder:'',
      size:info.size,mtime:Math.trunc(info.mtimeMs),duration:12,width:1280,height:720,video_codec:'h264',audio_codec:'aac',container:'mp4',
      series_title:null,season:null,episode:null,year:null,thumbnail_path:null,poster_path:null,backdrop_path:null,overview:null,genres:null,external_id:null}).id);
  }
  const hash=await hashPassword('1'),cookies=[];
  for(let i=0;i<16;i++){
    const user=server.accounts.save({username:'test-'+i,allLibraries:true},hash,undefined,i===0);
    cookies.push('virelo_session='+server.accounts.createSession(user));
  }
  await server.app.listen({host:'127.0.0.1',port:0});
  process.on('message',async message=>{
    if(message.kind==='reset'){reset();process.send({rpc:message.rpc});}
    if(message.kind==='stats')process.send({rpc:message.rpc,...metrics});
    if(message.kind==='close'){await server.app.close();process.exit(0);}
  });
  process.send({ready:true,base:'http://127.0.0.1:'+server.app.server.address().port,ids,cookies});
}else{
  const root=await mkdtemp(join(tmpdir(),'virelo-multiuser-')),results=[];
  let child,exited;
  try{
    await mkdir(join(root,'media'));
    execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-y',
      '-f','lavfi','-i','testsrc2=s=1280x720:r=24','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','12',
      '-c:v','libx264','-preset','ultrafast','-threads','2','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-movflags','+faststart',join(root,'media','0.mp4')],{windowsHide:true,timeout:60000});
    for(let i=1;i<8;i++)await link(join(root,'media','0.mp4'),join(root,'media',i+'.mp4'));
    const original=await readFile(join(root,'media','0.mp4'));
    child=fork(fileURLToPath(import.meta.url),['server',root],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});
    exited=new Promise(done=>child.once('exit',done));child.stderr.on('data',chunk=>process.stderr.write(chunk));
    const pending=new Map();let sequence=0;
    child.on('message',message=>pending.get(message.rpc)?.resolve(message));
    child.on('exit',()=>{for(const request of pending.values())request.reject(new Error('Test server exited.'));});
    const ready=await new Promise((done,fail)=>{
      const timer=setTimeout(()=>fail(new Error('Test server startup timed out.')),30000);
      const failed=error=>{clearTimeout(timer);fail(error);};
      child.once('error',failed);child.once('exit',()=>failed(new Error('Test server exited during startup.')));
      child.on('message',message=>{if(message.ready){clearTimeout(timer);done(message);}});
    });
    const rpc=kind=>new Promise((done,fail)=>{
      const id=++sequence,timer=setTimeout(()=>{pending.delete(id);fail(new Error('Test server did not reply.'));},30000);
      pending.set(id,{resolve:value=>{clearTimeout(timer);pending.delete(id);done(value);},reject:error=>{clearTimeout(timer);pending.delete(id);fail(error);}});
      child.send({kind,rpc:id});
    });
    const get=async(path,user=0,options={})=>{
      const start=performance.now(),response=await fetch(ready.base+path,{...options,
        headers:{cookie:ready.cookies[user],...options.headers},signal:AbortSignal.timeout(30000)});
      return {status:response.status,body:Buffer.from(await response.arrayBuffer()),ms:performance.now()-start};
    };
    const post=async(path,user=0,body={},record=()=>{})=>{
      const reply=await get(path,user,{method:'POST',headers:{'content-type':'application/json','x-virelo-request':'1'},body:JSON.stringify(body)});
      record(reply);assert.equal(reply.status,200);const state=JSON.parse(reply.body);assert.equal(state.status,'ready');return state;
    };
    const p95=values=>Math.round([...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]??0);
    const measure=async(name,work)=>{
      await rpc('reset');const times=[],health=[];let finished=false;
      const ping=(async()=>{while(!finished){const reply=await get('/api/health');assert.equal(reply.status,200);health.push(reply.ms);await new Promise(done=>setTimeout(done,25));}})();
      const record=reply=>{if(reply.status!==200)assert.fail(`${name}: HTTP ${reply.status}: ${reply.body.toString('utf8',0,2048)}`);times.push(reply.ms);return reply;};
      let detail;
      try{detail=await work(record);}finally{finished=true;await ping;}
      const stats=await rpc('stats');assert.ok(stats.maxHeavy<=2);assert.ok(stats.maxTools<=3);
      const result={name,requests:times.length,requestP95Ms:p95(times),healthP95Ms:p95(health),...stats,...detail};
      results.push(result);return result;
    };
    const direct=await measure('original-range-16',async record=>{
      await Promise.all(Array.from({length:16},async(_,user)=>{
        for(let n=0;n<4;n++){
          const size=512*1024,start=((user+n)%Math.floor(original.length/size))*size;
          const reply=await get('/api/media/'+ready.ids[user%8]+'/stream',user,{headers:{range:`bytes=${start}-${start+size-1}`}});
          assert.equal(reply.status,206);assert.ok(reply.body.equals(original.subarray(start,start+size)));
          record({...reply,status:200});
        }
      }));
    });assert.equal(direct.maxTools,0);
    let states;
    await measure('prepare-8-distinct',async record=>{states=await Promise.all(ready.ids.map((id,i)=>post('/api/media/'+id+'/quality/start',i,{},record)));});
    const segment=(i,index=0,height=720)=>states[i].playlist.replace('/master.m3u8','')+`/${height}/segment-${index}.ts`;
    const cold=await measure('same-cold-8',async record=>{await Promise.all(Array.from({length:8},async(_,i)=>record(await get(segment(0),i))));});
    assert.equal(cold.segments,1,'same segment is encoded once for all viewers');
    const warm=await measure('same-warm-8',async record=>{await Promise.all(Array.from({length:8},async(_,i)=>record(await get(segment(0),i))));});assert.equal(warm.segments,0);
    const audioState=await post('/api/media/'+ready.ids[0]+'/audio/start',0,{audioStream:1});
    const audio=audioState.playlist.replace('/index.m3u8','')+'/segment-1.ts';
    const mixed=await measure('audio-behind-8-videos',async record=>{
      const videos=Promise.allSettled(Array.from({length:8},async(_,i)=>record(await get(segment(i,2),i))));
      const deadline=performance.now()+10000;
      while((await rpc('stats')).maxHeavy<2){assert.ok(performance.now()<deadline,'video jobs must start');await new Promise(done=>setTimeout(done,5));}
      const reply=record(await get(audio));
      for(const result of await videos)assert.equal(result.status,'fulfilled',result.status==='rejected'?String(result.reason):undefined);
      return {audioWaitMs:Math.round(reply.ms)};
    });assert.ok(mixed.encoders.indexOf('audio-only')<8,'audio starts without waiting for the video backlog');
    const burst=await measure('burst-cold-20',async record=>{
      await Promise.all(Array.from({length:20},async(_,i)=>record(await get(segment(2+Math.floor(i/4),2+i%4,360),i%16))));
    });assert.equal(burst.segments,20);
    assert.ok((await readFile(join(root,'media','0.mp4'))).equals(original),'source bytes are unchanged');
    console.log(JSON.stringify({results},null,2));child.send({kind:'close'});await exited;
  }finally{
    if(child?.exitCode===null&&child.signalCode===null){child.kill();await exited;}
    const rel=relative(resolve(tmpdir()),resolve(root));assert.ok(rel.startsWith('virelo-multiuser-')&&!rel.includes(sep)&&!rel.includes('..'));
    await rm(root,{recursive:true,force:true});
  }
}
