import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {seekWindowPlaylist,seekWindowStart} from '../dist/hls-seek.js';
const source=await readFile(new URL('../web/src/utils/playback-seek.ts',import.meta.url),'utf8');
const {needsSeekWindow}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
const ranges=(...entries)=>({length:entries.length,start:i=>entries[i][0],end:i=>entries[i][1]});
const playlist='#EXTM3U\n#EXT-X-VERSION:6\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:0\n#EXT-X-PLAYLIST-TYPE:EVENT\n#EXTINF:2.000000,\nsegment-00000.ts\n#EXTINF:2.000000,\nsegment-00001.ts\n';

test('ordinary native/buffered seeking does not prepare a new window',()=>{
  assert.equal(needsSeekWindow(2844,0,ranges([0,7041])),false);
  assert.equal(needsSeekWindow(5,0,ranges([0,10])),false);
});
test('an unencoded target, a growing edge, or a gap before the current window needs a fresh seek',()=>{
  assert.equal(needsSeekWindow(2844,0,ranges([0,896])),true);
  assert.equal(needsSeekWindow(10,0,ranges([0,10])),true);
  assert.equal(needsSeekWindow(800,2844,ranges([0,2860])),true);
  assert.equal(needsSeekWindow(2846,2844,ranges([0,2860])),false);
  assert.equal(needsSeekWindow(5,0,ranges()),true);
});
test('seek-window manifests preserve absolute timestamps and mark only the skipped prefix as GAP',()=>{
  assert.equal(seekWindowPlaylist(playlist,0),playlist);
  const result=seekWindowPlaylist(playlist,47);
  assert.ok(result.includes('#EXT-X-START:TIME-OFFSET=47,PRECISE=YES'));
  const durations=[...result.matchAll(/#EXTINF:([\d.]+)/g)].map(match=>Number(match[1]));
  assert.equal(durations.slice(0,-2).reduce((sum,value)=>sum+value,0),47);
  assert.equal(durations.reduce((sum,value)=>sum+value,0),51);
  assert.equal((result.match(/#EXT-X-GAP/g)||[]).length,24);
  assert.equal(result.includes('segment-00000.ts'),true);
  assert.equal(result.includes('#EXT-X-ENDLIST'),false);
  assert.equal(seekWindowPlaylist(playlist+'#EXT-X-ENDLIST\n',47).includes('#EXT-X-ENDLIST'),true);
  assert.equal(seekWindowStart(47.9),47);
  for(const invalid of [-1,NaN,Infinity,1e20])assert.throws(()=>seekWindowStart(invalid),RangeError);
});
