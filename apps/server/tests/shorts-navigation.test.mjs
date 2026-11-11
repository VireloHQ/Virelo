import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
const source=await readFile(new URL('../web/src/utils/shorts-navigation.ts',import.meta.url),'utf8');
const {validateShortsSearch}=await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('Shorts accepts an explicit clip id from card navigation and direct URLs',()=>{
  assert.deepEqual(validateShortsSearch({startId:95}),{startId:95});
  assert.deepEqual(validateShortsSearch({startId:'95'}),{startId:95});
  assert.deepEqual(validateShortsSearch({startId:'00095'}),{startId:95});
});
test('plain Shorts navigation has no pinned video',()=>{
  assert.deepEqual(validateShortsSearch({}),{});
  assert.deepEqual(validateShortsSearch({seed:95,mediaId:95}),{});
});
test('invalid ids cannot become fractional, negative, infinite or unsafe media ids',()=>{
  for(const startId of [undefined,null,true,false,0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,
    '', ' ', 'NaN', 'Infinity', '-1','1.5','1e2','0x10','95abc',[],{},'9007199254740992']){
    assert.deepEqual(validateShortsSearch({startId}),{});
  }
});
