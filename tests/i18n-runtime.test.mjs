import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const data=source=>'data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source)).toString('base64');
let localeSource=await readFile(new URL('../web/src/i18n/locale.ts',import.meta.url),'utf8');
if(localeSource.includes('../../../src/languages'))localeSource=localeSource.replaceAll("'../../../src/languages'",JSON.stringify(data(await readFile(new URL('../src/languages.ts',import.meta.url),'utf8'))));
test('locale changes reuse loads, ignore superseded failures and recover after a failed catalog',async()=>{
  const tasks=new Map(),calls=new Map();
  globalThis.__vireloLocaleLoader=locale=>{
    calls.set(locale,(calls.get(locale)??0)+1);
    return new Promise((resolve,reject)=>tasks.set(locale,{resolve:()=>resolve({Ready:locale}),reject}));
  };
  try{
    let source=await readFile(new URL('../web/src/i18n/runtime.ts',import.meta.url),'utf8');
    source=source.replace("import en from './messages/en.json';","const en={Ready:'Ready'};");
    source=source.replace("'./locale'",JSON.stringify(data(localeSource)));
    for(const locale of['ja','zh-CN','ko','ru'])source=source.replace("import('./messages/"+locale+".json').then(module => module.default)","globalThis.__vireloLocaleLoader('"+locale+"')");
    const runtime=await import(data(source)),events=[];
    const unsubscribe=runtime.subscribeLocale(()=>events.push(runtime.getLocale()));
    const first=runtime.setLocale('ja',false),newest=runtime.setLocale('ru',false);
    tasks.get('ru').resolve();await newest;tasks.get('ja').reject(Error('unavailable'));await first;
    assert.equal(runtime.getLocale(),'ru');assert.equal(runtime.t('Ready'),'ru');
    const failed=runtime.setLocale('ko',false);tasks.get('ko').reject(Error('offline'));await assert.rejects(failed,/offline/);
    assert.equal(runtime.getLocale(),'ru');
    const retry=runtime.setLocale('ko',false);assert.equal(calls.get('ko'),2);tasks.get('ko').resolve();await retry;
    const one=runtime.setLocale('ja',false),two=runtime.setLocale('ja',false);assert.equal(calls.get('ja'),2);tasks.get('ja').resolve();await Promise.all([one,two]);
    assert.deepEqual(events,['ru','ko','ja']);unsubscribe();
    await runtime.setLocale('en');assert.equal(runtime.getLocale(),'en');
    await assert.rejects(runtime.setLocale('bogus'),/supported language/);
  }finally{delete globalThis.__vireloLocaleLoader;}
});
