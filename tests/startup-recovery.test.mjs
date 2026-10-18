import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../web/public/startup.js',import.meta.url),'utf8');
function boot(){
  let mounted=false,mutate,timeout,timeoutCleared=false,reloads=0,click;
  const fallback={hidden:true},detail={textContent:''},listeners=new Map();
  class Script {constructor(src){this.src=src;}}
  runInNewContext(source,{
    document:{getElementById:id=>({'root':{hasChildNodes:()=>mounted},'startup-error':fallback,'startup-error-detail':detail,'startup-reload':{addEventListener:(_,handler)=>click=handler}})[id]},
    window:{addEventListener:(name,handler)=>listeners.set(name,handler)},HTMLScriptElement:Script,
    MutationObserver:class{constructor(handler){mutate=handler;}observe(){}},
    setTimeout:handler=>{timeout=handler;return 1;},clearTimeout:()=>{timeoutCleared=true;},location:{reload:()=>reloads++},Error
  });
  return {fallback,detail,timeout:()=>timeout(),mount(value){mounted=value;mutate();},cleared:()=>timeoutCleared,reloads:()=>reloads,
    click:()=>click(),error:message=>listeners.get('error')({message}),scriptError:src=>listeners.get('error')({target:new Script(src)}),reject:reason=>listeners.get('unhandledrejection')({reason})};
}
test('startup recovery survives a missing entry script, preserves text safely, and offers an explicit retry',()=>{
  const app=boot();app.scriptError('/assets/index-missing.js');
  assert.equal(app.fallback.hidden,false);assert.equal(app.detail.textContent,'Could not load /assets/index-missing.js');
  app.click();assert.equal(app.reloads(),1);
  app.error('<img onerror="bad()">');assert.equal(app.detail.textContent,'<img onerror="bad()">');
});
test('startup timeout and rejected modules show recovery without interrupting mounted playback',()=>{
  const slow=boot();slow.timeout();assert.equal(slow.fallback.hidden,false);
  const app=boot();app.reject(new Error('Module evaluation failed'));assert.equal(app.detail.textContent,'Module evaluation failed');
  app.mount(true);assert.equal(app.fallback.hidden,true);assert.equal(app.cleared(),true);
  app.error('A recoverable route error');app.scriptError('/assets/optional.js');app.timeout();assert.equal(app.fallback.hidden,true);
});
test('a fatal render that empties the root also exposes recovery',()=>{
  const app=boot();app.mount(true);app.error('Rendering failed');app.mount(false);
  assert.equal(app.fallback.hidden,false);assert.equal(app.detail.textContent,'Rendering failed');
});
