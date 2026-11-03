import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../web/src/utils/volume-leveling.ts',import.meta.url),'utf8');
const {audioMeasurement,readAudioAnalysis,measuredLevelingGainDb,levelingGainDb}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('live and measured leveling only attenuate, including peak headroom',()=>{
  for(let level=-54;level<=20;level+=.25)assert.ok(levelingGainDb(level)<=0);
  assert.equal(measuredLevelingGainDb({integratedLufs:-30,truePeakDb:-12}),0);
  assert.equal(measuredLevelingGainDb({integratedLufs:-10,truePeakDb:-1}),-8);
  assert.equal(measuredLevelingGainDb({integratedLufs:-22,truePeakDb:1}),-4);
  for(const value of [undefined,null,{integratedLufs:NaN,truePeakDb:0},{integratedLufs:-12,truePeakDb:Infinity},{integratedLufs:-101,truePeakDb:-1}])
    assert.equal(measuredLevelingGainDb(value),null);
});

test('cached measurements are fingerprinted and selected by audio stream, not video position',()=>{
  const first={integratedLufs:-10,truePeakDb:-1},second={integratedLufs:-27,truePeakDb:-8};
  const data={version:1,size:100,mtime:234,defaultAudioStream:4,tracks:[{index:1,loudness:first},{index:4,loudness:second}]};
  const raw=JSON.stringify(data);
  assert.deepEqual(audioMeasurement(raw,100,234),second);
  assert.deepEqual(audioMeasurement(raw,100,234,1),first);
  assert.equal(audioMeasurement(raw,100,234,99),null);
  assert.equal(audioMeasurement(raw,101,234,1),null);
  assert.equal(audioMeasurement(raw,100,235,1),null);
  for(const patch of [{version:2},{tracks:[{index:1,loudness:{integratedLufs:'-10',truePeakDb:-1}}]},
    {defaultAudioStream:20},{defaultAudioStream:null},{tracks:[data.tracks[0],data.tracks[0]]},{tracks:[null]}])
    assert.equal(readAudioAnalysis(JSON.stringify({...data,...patch}),100,234),null);
  for(const bad of [null,{},'null','{}','bad JSON','x'.repeat(65537)])assert.equal(readAudioAnalysis(bad,100,234),null);
  assert.deepEqual(readAudioAnalysis(JSON.stringify({...data,defaultAudioStream:null,tracks:[]}),100,234)?.tracks,[]);
});
