import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, appendFile, rename, rm, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import { TerminalLog, logEntry, terminalText } from '../dist/terminal-log.js';
import { TerminalCanvas, fitTerminal, terminalInputWindow } from '../dist/terminal-canvas.js';
import { renderConsole } from '../dist/terminal-view.js';
import { terminalPort, terminalBrowserUrl, saveTerminalPort, ensureTerminalPortAvailable } from '../dist/terminal-server.js';
import { controlProfile, createControlServer } from '../dist/server-control.js';
import { openTerminalUI } from '../dist/terminal-ui.js';
import { writeServerSettings, readServerSettings } from '../dist/server-settings.js';
import { createServer } from 'node:net';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn){for(let i=0;i<150;i++){if(fn())return;await pause(10);}throw Error('Console update did not arrive');}
const status=dataDir=>({pid:1234,url:'http://127.0.0.1:41777',host:'127.0.0.1',port:41777,dataDir,version:'test',startedAt:Date.now()-60000,libraries:0,media:0,scanRunning:false,restartSupported:true});
const state=()=>({view:'overview',navigation:0,focus:'navigation',selection:0,status:status('C:/Videos/映画'),connected:true,busy:'',notice:'',error:false,desiredPort:41777,restartRequired:false,libraries:[],libraryOffset:0,logs:[],logPaused:false,logOffset:0,logFilter:0,search:'',modal:null});

test('terminal text strips OSC, CSI, C1 and bidirectional controls; Unicode fits in cells',()=>{
  assert.equal(terminalText('\x1b[31mred\x1b[0m\x1b]52;c;YQ==\x07\u202e\x9b'), 'red  ');
  assert.equal(logEntry('{"level":50,"time":0,"msg":"Failed","req":{"method":"GET","url":"/video"}}').text,'00:00:00 ERROR Failed  GET /video');
  for(const text of ['映画のフォルダ','A👩‍💻B','e\u0301abcdef'])for(const width of [1,3,7,12])assert.ok(stringWidth(fitTerminal(text,width))<=width);
  const canvas=new TerminalCanvas(20,3);canvas.text(1,1,'映画👩‍💻');
  assert.equal(stringWidth(canvas.lines(false)[1]),20);
  const input=terminalInputWindow('映画のフォルダ',8,7);assert.ok(stringWidth(input.text)<=7);assert.ok(input.cursor<7);
});

test('live log snapshots replace partial lines and handle split Unicode, truncation, rotation and caps',async()=>{
  const root=await mkdtemp(join(tmpdir(),'virelo-tui-log-')),path=join(root,'server.log'),tail=new TerminalLog(path,3);
  try{
    assert.equal(await tail.update(),0);
    const utf8=Buffer.from('one\n映画');await writeFile(path,utf8.subarray(0,utf8.length-1));await tail.update();
    assert.ok(!tail.entries.some(entry=>entry.text.includes('�')));
    await appendFile(path,utf8.subarray(utf8.length-1));await appendFile(path,'\r\nlast');await tail.update();
    assert.deepEqual(tail.entries.map(entry=>entry.text),['one','映画','last']);
    await appendFile(path,' line\n');await tail.update();assert.equal(tail.entries.at(-1).text,'last line');assert.equal(tail.entries.length,3);
    await writeFile(path,'new first\nnew second\nnew third\nnew fourth\n');await tail.update();assert.deepEqual(tail.entries.map(entry=>entry.text),['new second','new third','new fourth']);
    await rename(path,path+'.old');await writeFile(path,'rotated\n');await tail.update();assert.deepEqual(tail.entries.map(entry=>entry.text),['rotated']);
    await writeFile(path,'x'.repeat(100000));await tail.update();assert.ok(tail.entries.length<=3);assert.ok(tail.entries[0].text.length<=8192);
    await writeFile(path,Array.from({length:2000},(_,i)=>i+'\n').join(''));await tail.update();assert.deepEqual(tail.entries.map(entry=>entry.text),['1997','1998','1999']);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('console panels, dialogs and CJK fields remain bounded at desktop and compact sizes',()=>{
  assert.ok(renderConsole({...state(),view:'settings'},80,24,false).hits.some(hit=>hit.action==='restart'),'Standard 80×24 Settings exposes restart');
  for(const columns of [30,46,60,90,120,200])for(const rows of [12,18,24,36])for(const view of ['overview','libraries','logs','settings']){
    const current={...state(),view,modal:columns>45&&rows>=18?{type:'folder',value:'C:/動画/お気に入り',cursor:12}:null};
    const frame=renderConsole(current,columns,rows,false);
    assert.equal(frame.lines.length,rows);for(const row of frame.lines)assert.equal(stringWidth(row),columns-1,'Cell width '+columns+' '+rows+' '+view);
    assert.doesNotMatch(frame.lines.join(''),/[╭╮╰╯─│]/,'Panels use background surfaces instead of box-drawing characters');
    if(frame.cursor){assert.ok(frame.cursor.x>=0&&frame.cursor.x<columns-1);assert.ok(frame.cursor.y>=0&&frame.cursor.y<rows);}
  }
});

test('port validation preserves pending host settings and detects occupied ports before restart',async()=>{
  for(const value of ['',' ','-1','12x','65536','1e3'])assert.throws(()=>terminalPort(value));
  assert.equal(terminalPort('0'),0);assert.equal(terminalPort('65535'),65535);
  const root=await mkdtemp(join(tmpdir(),'virelo-tui-port-')),profile=await controlProfile(root),listener=createServer();
  try{
    await writeServerSettings(root,{host:'0.0.0.0',port:12345});
    await saveTerminalPort(profile,status(root),'45123');assert.deepEqual(await readServerSettings(root),{host:'0.0.0.0',port:45123});
    await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;
    await writeServerSettings(root,{host:'127.0.0.1',port});
    await assert.rejects(ensureTerminalPortAvailable(profile,status(root)),/already in use/);
    const fake={...status(root),url:'file:///C:/fake.exe'};assert.equal(terminalBrowserUrl(fake),'http://127.0.0.1:41777');
    assert.throws(()=>terminalBrowserUrl({...fake,host:'file:///fake'}));
  }finally{await new Promise(resolve=>listener.close(resolve));await rm(root,{recursive:true,force:true});}
});

async function fakeConsole(run){
  const oldTerm=process.env.TERM;process.env.TERM='xterm-256color';
  const root=await mkdtemp(join(tmpdir(),'virelo-tui-input-')),profile=await controlProfile(root),calls=[];
  const initial=status(root);let rejectStop=false;
  const control=await createControlServer(profile,async request=>{calls.push(request);return request.action==='stop'&&rejectStop?{ok:false,error:'Stop refused'}:{ok:true,status:initial,libraries:[]};});
  const input=new PassThrough();input.isTTY=true;input.isRaw=false;input.setRawMode=mode=>{input.isRaw=mode;};
  let output='';const terminal=new Writable({write(chunk,_encoding,callback){output+=chunk;callback();}});terminal.isTTY=true;terminal.columns=120;terminal.rows=36;
  const finished=openTerminalUI(profile,initial,false,undefined,{input,output:terminal,statusInterval:30,logInterval:20,openBrowser:async()=>{}});
  const key=(name,value='',extra={})=>input.emit('keypress',value,{name,sequence:value,...extra});
  try{await until(()=>output.includes('Server console'));await run({root,profile,input,terminal,key,calls,text:()=>stripVTControlCharacters(output),finished,rejectStop:()=>{rejectStop=true;}});}
  finally{key('c','',{ctrl:true});await finished;await control.close();await rm(root,{recursive:true,force:true});if(oldTerm===undefined)delete process.env.TERM;else process.env.TERM=oldTerm;
    assert.equal(input.isRaw,false);assert.equal(input.listenerCount('keypress'),0);assert.ok(output.includes('\x1b[?1000l'));}
}

test('Q and Ctrl+C close only the console; a rejected Stop keeps the UI alive',async()=>{
  await fakeConsole(async io=>{io.key('q','q');await io.finished;assert.ok(!io.calls.some(call=>call.action==='stop'));assert.match(io.text(),/Virelo keeps running/);});
  await fakeConsole(async io=>{io.rejectStop();io.key('x','x');io.key('return');await until(()=>io.text().includes('Stop refused'));assert.equal(io.input.isRaw,true);io.key('escape');io.key('c','',{ctrl:true});await io.finished;assert.equal(io.calls.filter(call=>call.action==='stop').length,1);});
});

test('inline port edits survive status refresh; bracketed paste cannot fire Q or stop shortcuts',async()=>{
  await fakeConsole(async io=>{
    for(let i=0;i<3;i++)io.key('down');io.key('return');io.key('return');await until(()=>io.text().includes('Change port'));
    io.key('u','',{ctrl:true});for(const char of '45123')io.key(char,char);await pause(110);
    io.key('return');await until(()=>io.text().includes('Port saved'));
    assert.equal((await readServerSettings(io.root)).port,45123);
    io.key('escape');io.key('up');io.key('up');io.key('return');await until(()=>io.text().includes('active folders'));
    io.key('return');io.key('paste-start');for(const char of 'qxx')io.key(char,char);io.key('paste-end');
    assert.equal(io.input.isRaw,true);assert.ok(!io.calls.some(call=>call.action==='stop'));io.key('escape');
    io.input.write('\x1b[<0;4;7M');await pause(10);assert.equal(io.input.isRaw,true);
  });
});

test('Live logs refresh without reopening, support pause and never receive unrelated file writes',async()=>{
  await fakeConsole(async io=>{
    await mkdir(io.profile.controlDir,{recursive:true});const path=join(io.profile.controlDir,'server.log');await writeFile(path,'first line\n');
    io.key('down');io.key('down');io.key('return');await until(()=>io.text().includes('first line'));
    await appendFile(path,'next line\n');await until(()=>io.text().includes('next line'));
    io.key('space',' ');await appendFile(path,'while paused\n');await pause(80);
    io.key('space',' ');await until(()=>io.text().includes('while paused'));
    assert.equal(await readFile(path,'utf8'),'first line\nnext line\nwhile paused\n');
  });
});
