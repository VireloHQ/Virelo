import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source=await readFile(new URL('../web/src/utils/playback-repeat.ts',import.meta.url),'utf8');
const {queueDestination,nextRepeatMode}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('transport repeat cycles without a menu and skips queue for a standalone video',()=>{
  assert.equal(nextRepeatMode('off',true),'one');
  assert.equal(nextRepeatMode('one',true),'queue');
  assert.equal(nextRepeatMode('queue',true),'off');
  assert.equal(nextRepeatMode('off',false),'one');
  assert.equal(nextRepeatMode('one',false),'off');
});
test('queue repeat advances then wraps in either direction',()=>{
  assert.equal(queueDestination(0,3,1,'queue',true),1);
  assert.equal(queueDestination(2,3,1,'queue',true),0);
  assert.equal(queueDestination(0,3,-1,'queue'),2);
  assert.equal(queueDestination(0,1,1,'queue',true),0);
});
test('repeat off stops at queue boundaries and respects manual playback',()=>{
  assert.equal(queueDestination(2,3,1,'off',true),null);
  assert.equal(queueDestination(0,3,-1,'off'),null);
  assert.equal(queueDestination(0,3,1,'off',true,false),null);
  assert.equal(queueDestination(0,3,1,'off',true),1);
  assert.equal(queueDestination(2,3,1,'queue',true,false),0);
});
test('repeat video never auto-advances but next still selects another video',()=>{
  assert.equal(queueDestination(0,3,1,'one',true),null);
  assert.equal(queueDestination(0,3,1,'one'),1);
  assert.equal(queueDestination(2,3,1,'one'),null);
});
test('empty or invalid queues have no destination',()=>{
  assert.equal(queueDestination(0,0,1,'queue'),null);
  assert.equal(queueDestination(-1,3,1,'queue'),null);
  assert.equal(queueDestination(3,3,1,'queue'),null);
});
