import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { catalogIssues,duplicateKeys,checkI18n } from '../scripts/check-i18n.mjs';
const data=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let source=await readFile(new URL('../web/src/i18n/locale.ts',import.meta.url),'utf8');
if(source.includes('../../../src/languages')){
  const shared=data(await readFile(new URL('../src/languages.ts',import.meta.url),'utf8'));
  source=source.replaceAll("'../../../src/languages'",JSON.stringify(shared));
}
const {translate,resolveLocale,isLocale,languages}=await import(data(source));
const catalogs=Object.fromEntries(await Promise.all(languages.map(async language=>[language.value,JSON.parse(await readFile(new URL('../web/src/i18n/messages/'+language.value+'.json',import.meta.url),'utf8'))])));
test('all five locale catalogs cover UI source with matching placeholders and no duplicate or untranslated messages',async()=>{
  const result=await checkI18n(fileURLToPath(new URL('../',import.meta.url)));
  assert.deepEqual(result.issues,[]);assert.deepEqual(result.languages.sort(),languages.map(language=>language.value).sort());assert.ok(result.messages>800);
});
test('explicit language wins and browser preferences resolve without treating Traditional Chinese as Simplified Chinese',()=>{
  assert.equal(resolveLocale('ru',['ja-JP']),'ru');
  for(const[preferred,expected]of[[['ja-JP'],'ja'],[['ko-KR'],'ko'],[['ru-RU'],'ru'],[['en-GB','ja'],'en'],[['zh-Hans-SG'],'zh-CN'],[['zh'],'zh-CN'],[['zh-TW','ko'],'ko'],[['zh-Hant','en'],'en'],[['fr-FR'],'en'],[[],'en']])assert.equal(resolveLocale(null,preferred),expected);
  for(const bad of[null,{},false,'ja-JP','<script>','__proto__'])assert.equal(isLocale(bad),false);
});
test('interpolation preserves filenames and safely ignores object-prototype properties',()=>{
  for(const locale of Object.keys(catalogs)){
    const filename='<img src=x onerror=alert(1)> Settings.mp4';
    const value=translate(catalogs[locale],locale,'Play {value0}',{value0:filename});
    assert.ok(value.includes(filename));if(locale!=='en')assert.notEqual(value,'Play '+filename);
    assert.equal(translate(catalogs[locale],locale,'an unknown diagnostic'),'an unknown diagnostic');
    assert.equal(translate({},locale,'{constructor} {name}',{name:'Sample'}),'{constructor} Sample');
  }
});
test('legacy server messages interpolate at bounded cost, including empty segments and regex punctuation',()=>{
  const catalog={'Restoring thumbnail · {value0}':'復元中 · {value0}','Failure ({value0}) [{value1}]':'失敗 [{value1}]（{value0}）'};
  assert.equal(translate(catalog,'ja','Restoring thumbnail · folder/Test.mp4'),'復元中 · folder/Test.mp4');
  assert.equal(translate(catalog,'ja','Failure () [a+b]'),'失敗 [a+b]（）');
  assert.equal(translate(catalog,'ja','Restoring thumbnail · '+'x'.repeat(9000)),'Restoring thumbnail · '+'x'.repeat(9000));
  assert.equal(translate({'{value0} is required.':'{value0}を入力してください。','Username':'ユーザー名'},'ja','Username is required.'),'ユーザー名を入力してください。');
});
test('Russian plural forms select correctly without English suffix interpolation',()=>{
  const catalog={'{count} videos':{one:'{count} видео',few:'{count} ролика',many:'{count} роликов',other:'{count} видео'}};
  for(const[count,expected]of[[1,'1 видео'],[2,'2 ролика'],[5,'5 роликов'],[21,'21 видео'],[22,'22 ролика'],[1.5,'1.5 видео']])assert.equal(translate(catalog,'ru','{count} videos',{count}),expected);
  for(const count of[1,2,5,21])assert.ok(translate(catalogs.ru,'ru','{count} users',{count}).includes(String(count)));
});
test('catalog gate rejects omissions, empty values, bad plurals, duplicates and lost tokens',()=>{
  const base={'Hello {name}':'Hello {name}'};
  assert.ok(catalogIssues(base,{}).length);assert.ok(catalogIssues(base,{'Hello {name}':'こんにちは'}).length);
  assert.ok(catalogIssues(base,{'Hello {name}':{one:'{name}'}}).length);assert.ok(catalogIssues(base,{'Hello {name}':''}).length);
  assert.deepEqual(duplicateKeys('{"a":"first","a":"second"}'),['a']);
  assert.deepEqual(catalogIssues(base,{'Hello {name}':'こんにちは、{name}'}),[]);
});
