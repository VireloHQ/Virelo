import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {limitMediaProcess} from '../dist/ffmpeg.js';
test('stalled media tools are killed at the deadline',{timeout:5000},async t=>{
  const child=limitMediaProcess(spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}),100);
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const [code]=await once(child,'close');assert.notEqual(code,0);assert.equal(child.killed,true);
});
