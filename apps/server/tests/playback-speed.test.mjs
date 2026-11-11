import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=await readFile(new URL('../web/src/utils/playback-speed.ts',import.meta.url),'utf8');
const {playbackSpeed,speedLabel,PLAYBACK_SPEEDS}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
test('only supported playback speeds are restored from storage',()=>{
  for(const speed of PLAYBACK_SPEEDS) { assert.equal(playbackSpeed(speed),speed); assert.equal(playbackSpeed(String(speed)),speed); }
  for(const value of [null,undefined,'',true,false,{},[],NaN,Infinity,-1,0,3,'garbage'])assert.equal(playbackSpeed(value),1);
});
test('speed labels distinguish the default without rounding fractional rates',()=>{
  assert.equal(speedLabel(1),'Normal (1×)');
  assert.equal(speedLabel(.25),'0.25×'); assert.equal(speedLabel(1.75),'1.75×');
});
