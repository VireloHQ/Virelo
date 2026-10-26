import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const load=async file=>import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(await readFile(new URL('../web/src/utils/'+file,import.meta.url),'utf8'))).toString('base64'));
const {shareLink}=await load('share.ts');
const {levelingGainDb,signalLevel,readLevelingPreference,saveLevelingPreference,supportsVolumeLeveling}=await load('volume-leveling.ts');
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
  const loud=signalLevel([new Float32Array([.2,-.2]),new Float32Array([.2,-.2])]);
  const lowerManual=signalLevel([new Float32Array([.1,-.1]),new Float32Array([.1,-.1])],.5);
  assert.ok(Math.abs(loud.level-lowerManual.level)<.001);assert.ok(Math.abs(loud.peak-lowerManual.peak)<.001);
  const antiphase=signalLevel([new Float32Array([.2,-.2]),new Float32Array([-.2,.2])]);assert.equal(antiphase.level,loud.level);
  assert.equal(levelingGainDb(signalLevel([new Float32Array(4)]).level,-Infinity),null);
});
test('blocked storage keeps leveling disabled by default and preserves the session choice',()=>{
  globalThis.localStorage={getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}};
  assert.equal(readLevelingPreference(),false);saveLevelingPreference(true);assert.equal(readLevelingPreference(),true);saveLevelingPreference(false);assert.equal(readLevelingPreference(),false);
});
