import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as turn } from 'node:timers/promises';
import { MediaScheduler,MediaBusyError } from '../dist/media-work.js';

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
test('audio retains a slot while shared heavy work is full, and users alternate fairly',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred(),order=[];
  const first=scheduler.run(()=>a.promise,{kind:'video',owner:'A'}),second=scheduler.run(()=>b.promise,{kind:'probe',owner:'A'});
  const queuedA=scheduler.run(async()=>{order.push('A');},{kind:'video',owner:'A'});
  const queuedB=scheduler.run(async()=>{order.push('B');},{kind:'video',owner:'B'});
  const audio=scheduler.run(async()=>{order.push('audio');},{kind:'interactive',owner:'C'});
  await audio;assert.deepEqual(order,['audio']);
  a.resolve();await first;await turn();assert.deepEqual(order.slice(0,2),['audio','B']);
  b.resolve();await Promise.all([second,queuedA,queuedB]);
});
test('background jobs stay bounded, and pending interactive work wins the next heavy slot',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred(),order=[];
  const background=scheduler.run(()=>a.promise,{kind:'background',owner:'scan'});
  const nextBackground=scheduler.run(async()=>{order.push('background');},{kind:'background',owner:'scan'});
  const video=scheduler.run(()=>b.promise,{kind:'video',owner:'A'});
  const pending=scheduler.run(async()=>{order.push('video');},{kind:'video',owner:'B'});
  await turn();assert.deepEqual(order,[]);b.resolve();await video;await turn();assert.deepEqual(order,['video']);
  a.resolve();await Promise.all([background,nextBackground,pending]);assert.deepEqual(order,['video','background']);
});

test('round robin visits every waiting owner instead of alternating only the first two',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred(),order=[];
  const active=[scheduler.run(()=>a.promise,{kind:'video',owner:'A'}),scheduler.run(()=>b.promise,{kind:'video',owner:'A'})];
  const pending=['A','A','B','B','C','C'].map(owner=>scheduler.run(async()=>{order.push(owner);},{kind:'video',owner}));
  a.resolve();await active[0];await Promise.all(pending);
  assert.deepEqual(order,['B','C','A','B','C','A']);b.resolve();await active[1];
});
test('cancelled pending work never runs or consumes queue capacity',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred();let ran=false;
  const active=[scheduler.run(()=>a.promise,{kind:'video'}),scheduler.run(()=>b.promise,{kind:'video'})];
  for(let i=0;i<40;i++){
    const controller=new AbortController(),job=scheduler.run(async()=>{ran=true;},{kind:'video',owner:'A',signal:controller.signal});
    controller.abort();await assert.rejects(job,/cancelled/);
  }
  assert.equal(ran,false);a.resolve();b.resolve();await Promise.all(active);
  await scheduler.run(async()=>{ran=true;},{kind:'video'});assert.equal(ran,true);
});
test('a single owner cannot fill the queue; overload has retry information',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred(),release=deferred();
  const active=[scheduler.run(()=>a.promise,{kind:'video',owner:'A'}),scheduler.run(()=>b.promise,{kind:'video',owner:'A'})];
  const queued=Array.from({length:16},()=>scheduler.run(()=>release.promise,{kind:'video',owner:'A'}));
  await assert.rejects(scheduler.run(async()=>{}, {kind:'video',owner:'A'}),error=>error instanceof MediaBusyError&&error.statusCode===503&&error.headers['Retry-After']==='1');
  const other=scheduler.run(async()=>{}, {kind:'video',owner:'B'});
  await scheduler.run(async()=>{}, {kind:'interactive',owner:'A'});
  a.resolve();b.resolve();release.resolve();await Promise.all([...active,...queued,other]);
});
test('closing a scope cancels queued and active jobs without affecting another server',async()=>{
  const scheduler=new MediaScheduler(),started=deferred();
  const active=scheduler.run(signal=>new Promise((resolve,reject)=>{started.resolve();signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true});}),{kind:'video',scope:'one'});
  const observed=assert.rejects(active,/cancelled/);await started.promise;
  const other=scheduler.run(async()=>42,{kind:'video',scope:'two'});
  await scheduler.closeScope('one');await observed;assert.equal(await other,42);
  await assert.rejects(scheduler.run(async()=>{}, {kind:'video',scope:'one'}),/cancelled/);
  scheduler.openScope('one');assert.equal(await scheduler.run(async()=>1,{kind:'video',scope:'one'}),1);
});

test('global admission is bounded and reserves waiting capacity for audio',async()=>{
  const scheduler=new MediaScheduler(),release=deferred();
  const active=[scheduler.run(()=>release.promise,{kind:'video'}),scheduler.run(()=>release.promise,{kind:'video'}),scheduler.run(()=>release.promise,{kind:'interactive'})];
  const pending=Array.from({length:56},(_,i)=>scheduler.run(()=>release.promise,{kind:'video',owner:String(i%4)}));
  await assert.rejects(scheduler.run(async()=>{}, {kind:'video',owner:'another'}),MediaBusyError);
  const audio=Array.from({length:8},()=>scheduler.run(()=>release.promise,{kind:'interactive',owner:'listener'}));
  await assert.rejects(scheduler.run(async()=>{}, {kind:'interactive',owner:'another'}),MediaBusyError);
  release.resolve();await Promise.all([...active,...pending,...audio]);
});
test('foreground joins promote a shared pending scan probe',async()=>{
  const scheduler=new MediaScheduler(),a=deferred(),b=deferred(),order=[];
  const active=[scheduler.run(()=>a.promise,{kind:'video'}),scheduler.run(()=>b.promise,{kind:'video'})];
  const scan=scheduler.run(async()=>{order.push('probe');},{kind:'background',owner:'scan',key:'shared'});
  const video=scheduler.run(async()=>{order.push('video');},{kind:'video',owner:'viewer'});
  scheduler.promote('shared','viewer');a.resolve();await active[0];await turn();assert.equal(order[0],'probe');
  b.resolve();await Promise.all([active[1],scan,video]);
});
