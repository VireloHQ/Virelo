import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../web/src/utils/playback-quality.ts',import.meta.url),'utf8');
const url='data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let serial=0;
const fresh=()=>import(url+'#'+(++serial));
function storage(values={}) {
  const entries=new Map(Object.entries(values));
  globalThis.window={localStorage:{getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)}};
  return entries;
}
const qualities=(...heights)=>heights.map(height=>({height}));

test('Original Quality is stored separately from a fixed source-height selection',async()=>{
  const entries=storage();let q=await fresh();
  q.saveQualityPreference(1080);
  assert.equal(q.resolvePreferredQuality(qualities(2160,1080,720),q.readQualityPreference(false)),1080);
  q.saveQualityPreference('source');
  assert.equal(entries.get('virelo-playback-quality:v1'),'source');
  q=await fresh();
  for(const height of [2160,1440,1080,720,480]) {
    assert.equal(q.resolvePreferredQuality(qualities(height,360),q.readQualityPreference(false)),height);
  }
  assert.equal(q.readQualityPreference(true),'source');
});

test('manual resolution stays a ceiling across higher and lower resolution videos',async()=>{
  storage();const q=await fresh();q.saveQualityPreference(720);
  for(const heights of [[2160,1440,1080,720,480,360],[1440,1080,720,480],[720,480,360],[480,360]]){
    assert.equal(q.resolvePreferredQuality(qualities(...heights),q.readQualityPreference(false)),Math.min(720,heights[0]));
  }
  assert.equal(q.readQualityPreference(true),720);
});
test('using a lower resolution source does not overwrite the saved ceiling',async()=>{
  storage();const q=await fresh();q.saveQualityPreference(1080);
  assert.equal(q.resolvePreferredQuality(qualities(720,480,360),q.readQualityPreference(false)),720);
  assert.equal(q.resolvePreferredQuality(qualities(1440,1080,720),q.readQualityPreference(false)),1080);
});
test('manual choice persists across reloads and migrates existing npm preferences',async()=>{
  const entries=storage({'virelo-playback-quality':'720'});let q=await fresh();
  assert.equal(q.readQualityPreference(false),720);q.saveQualityPreference(480);
  assert.equal(entries.get('virelo-playback-quality:v1'),'480');
  q=await fresh();assert.equal(q.readQualityPreference(true),480);
});
test('defaults use Original Quality on local and network connections',async()=>{
  storage();const q=await fresh();
  assert.equal(q.readQualityPreference(false),'source');assert.equal(q.readQualityPreference(true),'source');
  assert.equal(q.resolvePreferredQuality(qualities(1080,720),q.readQualityPreference(false)),1080);
  assert.equal(q.resolvePreferredQuality(qualities(1080,720),'auto'),null);
});
test('saved Auto is ignored locally without destroying the network preference',async()=>{
  storage();const q=await fresh();q.saveQualityPreference(null);
  assert.equal(q.readQualityPreference(false),'source');assert.equal(q.readQualityPreference(true),'auto');
});
test('blocked storage retains a manual selection for the current tab',async()=>{
  globalThis.window={get localStorage(){throw new Error('Storage is disabled');}};
  const q=await fresh();assert.equal(q.readQualityPreference(false),'source');
  q.saveQualityPreference(720);assert.equal(q.readQualityPreference(true),720);assert.equal(q.readQualityPreference(false),720);
});
test('missing or unknown bounded resolutions never select a higher original',async()=>{
  storage();const q=await fresh();
  assert.throws(()=>q.resolvePreferredQuality(qualities(1080),720),/No quality at or below 720p/);
  assert.throws(()=>q.resolvePreferredQuality([],720),/No quality at or below 720p/);
  assert.equal(q.resolvePreferredQuality([],'source'),null);
});
test('unsorted and invalid ladders use the best permitted resolution without mutation',async()=>{
  const q=await fresh(),list=qualities(360,1080,NaN,480,720);const before=list.slice();
  assert.equal(q.resolvePreferredQuality(list,720),720);assert.deepEqual(list,before);
});
test('portrait HLS levels respect the same short-side ceiling as landscape videos',async()=>{
  const q=await fresh();
  assert.equal(q.boundedQualityLevel([{width:1920,height:1080},{width:1280,height:720},{width:640,height:360}],720),1);
  assert.equal(q.boundedQualityLevel([{width:1080,height:1920},{width:720,height:1280},{width:360,height:640}],720),1);
  assert.throws(()=>q.boundedQualityLevel([{width:1920,height:1080}],720),/No stream at or below 720p/);
});
test('malformed stored values are not treated as an Auto or manual selection',async()=>{
  for(const value of ['', '-720','NaN','Infinity','720.5','garbage']){
    storage({'virelo-playback-quality:v1':value});const q=await fresh();
    assert.equal(q.readQualityPreference(false),'source');assert.equal(q.readQualityPreference(true),'source');
  }
});
