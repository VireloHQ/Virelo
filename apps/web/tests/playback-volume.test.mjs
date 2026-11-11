import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../web/src/utils/playback-volume.ts',import.meta.url),'utf8');
const url='data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let serial=0;
const fresh=()=>import(url+'#'+(++serial));
function storage(value=null) {
  const entries=new Map(value===null?[]:[['virelo-playback-volume:v1',value]]);
  globalThis.window={localStorage:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)}};
  return entries;
}

test('volume and mute survive another video and a reload',async()=>{
  storage();let v=await fresh();
  assert.deepEqual(v.readPlaybackVolume(),{volume:1,muted:false});
  v.savePlaybackVolume({volume:.35});v.savePlaybackVolume({muted:true});
  assert.deepEqual(v.readPlaybackVolume(),{volume:.35,muted:true});
  v=await fresh();assert.deepEqual(v.readPlaybackVolume(),{volume:.35,muted:true});
  v.savePlaybackVolume({muted:false});
  assert.equal(v.readPlaybackVolume().volume,.35);
});

test('shorts and player subscribers share the same stable snapshot',async()=>{
  storage();const v=await fresh();let notifications=0;
  const unsubscribe=v.subscribePlaybackVolume(()=>notifications++);
  const before=v.readPlaybackVolume();assert.equal(before,v.readPlaybackVolume());
  v.savePlaybackVolume({volume:.5});v.savePlaybackVolume({volume:.5});
  assert.equal(notifications,1);unsubscribe();v.savePlaybackVolume({muted:true});
  assert.equal(notifications,1);
});

test('invalid storage, invalid volumes and blocked storage are safe',async()=>{
  for(const value of ['not JSON','null','{"volume":"bad","muted":false}']) {
    storage(value);const v=await fresh();assert.deepEqual(v.readPlaybackVolume(),{volume:1,muted:false});
  }
  storage();const v=await fresh();v.savePlaybackVolume({volume:NaN});assert.equal(v.readPlaybackVolume().volume,1);
  v.savePlaybackVolume({volume:-1});assert.equal(v.readPlaybackVolume().volume,0);
  v.savePlaybackVolume({volume:2});assert.equal(v.readPlaybackVolume().volume,1);
  globalThis.window={localStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}};
  const blocked=await fresh();blocked.savePlaybackVolume({volume:.2,muted:true});
  assert.deepEqual(blocked.readPlaybackVolume(),{volume:.2,muted:true});
});
