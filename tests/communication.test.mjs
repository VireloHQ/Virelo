import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await readFile(new URL('../web/src/utils/'+file,import.meta.url),'utf8'))).toString('base64'));
const {shareLink}=await load('share.ts');
const {levelingGainDb,readLevelingPreference,saveLevelingPreference,supportsVolumeLeveling}=await load('volume-leveling.ts');
test('native WebKit HLS audio is never rerouted through unsupported processing',()=>{
  assert.equal(supportsVolumeLeveling('AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15'),false);
  assert.equal(supportsVolumeLeveling('iPhone AppleWebKit/605.1.15 CriOS/140.0 Mobile'),false);
  assert.equal(supportsVolumeLeveling('AppleWebKit/537.36 Chrome/140.0 Safari/537.36','MacIntel',5),false);
  assert.equal(supportsVolumeLeveling('AppleWebKit/537.36 Chrome/140.0 Safari/537.36'),true);
  assert.equal(supportsVolumeLeveling('Gecko/20100101 Firefox/142.0'),true);
});
test('share links never include account-local state or tokens',()=>{
  assert.equal(shareLink('https://example.test?token=secret#name','/watch/123'),'https://example.test/watch/123');
  assert.equal(shareLink('https://example.test','/title/123'),'https://example.test/title/123');
  for(const path of ['/settings','/playlists/12','/watch/not-a-number','//evil.test','/watch/1?token=private'])assert.equal(shareLink('https://example.test',path),'https://example.test/');
  assert.equal(shareLink('https://example.test','/watch/1',true),'https://example.test/app');
  for(const origin of ['javascript:alert(1)','file:///media/private','https://user:password@example.test'])assert.throws(()=>shareLink(origin,'/'));
});
test('leveling uses bounded gain, ignores silence and preserves manual volume',()=>{
  assert.equal(levelingGainDb(-30,-24),12);assert.equal(levelingGainDb(-6,-1),-12);
  assert.equal(levelingGainDb(-40,-2),-1,'peak headroom limits amplification');
  assert.equal(levelingGainDb(-70,-60),null);
  for(const value of [NaN,Infinity,-Infinity])assert.equal(levelingGainDb(value,-10),null);
  assert.equal(levelingGainDb(-6),-12);
  assert.equal(levelingGainDb(-30),12);
});
test('blocked storage keeps leveling disabled by default and preserves the session choice',()=>{
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readLevelingPreference(),false);saveLevelingPreference(true);assert.equal(readLevelingPreference(),true);saveLevelingPreference(false);assert.equal(readLevelingPreference(),false);
});

test('leveling binds before playback and no longer waits for main-thread polling or resets gain on seeks',async()=>{
  const hook=await readFile(new URL('../web/src/hooks/useVolumeLeveling.ts',import.meta.url),'utf8');
  const graph=await readFile(new URL('../web/src/utils/volume-leveler.ts',import.meta.url),'utf8');
  assert.match(hook,/useLayoutEffect/);
  assert.ok(hook.indexOf('leveler.bind(elements)')<hook.indexOf('const start'));
  assert.doesNotMatch(hook,/setInterval|\.tick\(/);
  assert.match(graph,/createDelay/);
  assert.match(graph,/smooth.type = 'lowpass'/);
  assert.match(graph,/control.connect\(gain.gain\)/);
  assert.doesNotMatch(graph,/recent|setTargetAtTime\(1/);
});
