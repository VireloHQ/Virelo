import test from 'node:test';
import assert from 'node:assert/strict';
import { runMediaProcess } from '../dist/media-process.js';
import { mediaScheduler } from '../dist/media-work.js';
test('media tools have bounded output, deadlines, cancellation and reusable process slots',{timeout:10000},async()=>{
  const options={kind:'video',timeout:3000,scope:'process-test'};
  await assert.rejects(runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,timeout:100}),/timed out/);
  await assert.rejects(runMediaProcess(process.execPath,['-e','process.stdout.write("x".repeat(65536))'],{...options,maxOutput:1000}),/size limit/);
  const controller=new AbortController();
  const pending=runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{...options,signal:controller.signal});
  setTimeout(()=>controller.abort(),100);
  await assert.rejects(pending,/cancelled/);
  const result=await runMediaProcess(process.execPath,['-e','console.log("reused")'],options);assert.equal(result.stdout.toString().trim(),'reused');
  await assert.rejects(runMediaProcess('virelo-nonexistent-executable',[],options),/ENOENT/);
  const closing=assert.rejects(runMediaProcess(process.execPath,['-e','setInterval(()=>{},1000)'],options),/cancelled/);
  await new Promise(resolve=>setTimeout(resolve,100));
  await mediaScheduler.closeScope(options.scope);await closing;
  await mediaScheduler.closeScope(options.scope);mediaScheduler.openScope(options.scope);
});
