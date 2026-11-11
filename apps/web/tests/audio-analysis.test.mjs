import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLoudnorm } from '../web/src/utils/audio-analysis.ts';

test('loudnorm input LUFS and true peak are read, never output measurements or RMS', () => {
  const log = 'progress\n' + JSON.stringify({ input_i: '-10.25', input_tp: '-0.14', output_i: '-18', output_tp: '-3' });
  assert.deepEqual(parseLoudnorm(log), { integratedLufs: -10.25, truePeakDb: -0.14 });
});

test('gated silence is safe and invalid or missing measurements cannot become gain', () => {
  for (const input_tp of ['-inf', '-90.00']) assert.equal(parseLoudnorm(JSON.stringify({input_i:'-inf',input_tp})), null);
  for (const data of [{}, {input_i:'NaN',input_tp:'0'}, {input_i:'-12',input_tp:'inf'}, {input_i:0,input_tp:'0'},
    {input_i:'',input_tp:'0'}, {input_i:'-12',input_tp:'30'}, {input_i:'-101',input_tp:'-10'}, {input_i:'-inf',input_tp:null}, {input_i:'-inf',input_tp:''},
    {input_i:'0x10',input_tp:'0'}, {input_i:'-inf',input_tp:'0xA'}, {input_i:'-inf',input_tp:'100'}]) {
    assert.throws(() => parseLoudnorm(JSON.stringify(data)));
  }
  assert.throws(() => parseLoudnorm('loudnorm failed'));
  assert.throws(() => parseLoudnorm('{"input_i":'));
});
