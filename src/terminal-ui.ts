import { emitKeypressEvents } from 'node:readline';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ReadStream, WriteStream } from 'node:tty';
import open from 'open';
import { sendControl, type ControlProfile, type ServerSnapshot } from './server-control.js';
import { readServerSettings } from './server-settings.js';
import { waitForStop } from './server-process.js';
import { TerminalLog, terminalText } from './terminal-log.js';
import { terminalBrowserUrl, saveTerminalPort, ensureTerminalPortAvailable, waitForTerminalRestart } from './terminal-server.js';
import { consoleActions, renderConsole, visibleLogs, type ConsoleAction, type ConsoleModal, type ConsoleState, type ConsoleView } from './terminal-view.js';

export function terminalMediaPath(value: string, cwd = process.cwd()): string | null {
  let raw=value.trim();
  if((raw.startsWith('"')&&raw.endsWith('"'))||(raw.startsWith("'")&&raw.endsWith("'")))raw=raw.slice(1,-1).trim();
  if(!raw)return null;
  return resolve(cwd,raw==='~'?homedir():raw.startsWith('~/')||raw.startsWith('~\\')?join(homedir(),raw.slice(2)):raw);
}

interface ConsoleIO {input?:ReadStream;output?:WriteStream;statusInterval?:number;logInterval?:number;openBrowser?:(url:string)=>Promise<unknown>}
interface Key {name?:string;ctrl?:boolean;meta?:boolean;shift?:boolean;sequence?:string;code?:string}
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function snapshot(value:ServerSnapshot):ServerSnapshot{
  if(!value||typeof value.url!=='string'||typeof value.host!=='string'||typeof value.dataDir!=='string'||typeof value.version!=='string'
    ||!Number.isSafeInteger(value.pid)||value.pid<1||!Number.isInteger(value.port)||value.port<1||value.port>65535
    ||!Number.isFinite(value.startedAt)||!Number.isSafeInteger(value.libraries)||value.libraries<0||typeof value.scanRunning!=='boolean')throw new Error('Invalid server status.');
  return value;
}

export async function openTerminalUI(profile:ControlProfile,initial:ServerSnapshot,upgradeNotice=false,acknowledgeUpgrade?:()=>Promise<void>,io:ConsoleIO={}):Promise<void>{
  const stdin=io.input??process.stdin,stdout=io.output??process.stdout;
  if(!stdin.isTTY||!stdout.isTTY||process.env.TERM==='dumb'){
    stdout.write(`Virelo running: ${terminalText(initial.url)}\nUse "virelo status" to check and "virelo stop" to stop it.\n`);return;
  }
  const colors=!process.env.NO_COLOR&&process.env.FORCE_COLOR!=='0',ascii=(process.env.LC_ALL||process.env.LANG||'').toUpperCase().includes('ASCII');
  const state:ConsoleState={view:'overview',navigation:0,focus:'navigation',selection:0,status:snapshot(initial),connected:true,busy:'',notice:'',error:false,
    desiredPort:initial.port,restartRequired:false,libraries:[],libraryOffset:0,logs:[],logPaused:false,logOffset:0,logFilter:0,search:'',
    modal:upgradeNotice?{type:'upgrade',value:'',cursor:0}:null};
  const log=new TerminalLog(join(profile.controlDir,'server.log'));
  const wasRaw=stdin.isRaw;
  let closed=false,statusReading=false,logReading=false,connectionError=false,outputBlocked=false,outputBroken=false;
  let previous:string[]=[],lastWidth=0,lastHeight=0,mouse='',legacyMouse=0,paste:string|null=null;
  let statusTimer:ReturnType<typeof setInterval>|undefined,logTimer:ReturnType<typeof setInterval>|undefined;
  let lastFrame=renderConsole(state,stdout.columns||100,stdout.rows||32,colors,ascii);
  let resolveClosed!:()=>void;
  const completed=new Promise<void>(resolve=>{resolveClosed=resolve;});
  const message=(text:string,error=false)=>{state.notice=text;state.error=error;};
  const paint=()=>{
    if(closed||outputBlocked||outputBroken)return;
    const width=stdout.columns||100,height=stdout.rows||32;
    lastFrame=renderConsole(state,width,height,colors,ascii);
    let output='';
    if(width!==lastWidth||height!==lastHeight){output+='\x1b[2J';previous=[];lastWidth=width;lastHeight=height;}
    for(const [row,line] of lastFrame.lines.entries())if(previous[row]!==line)output+=`\x1b[${row+1};1H`+line;
    previous=lastFrame.lines;
    output+=lastFrame.cursor?`\x1b[${lastFrame.cursor.y+1};${lastFrame.cursor.x+1}H\x1b[?25h`:'\x1b[?25l';
    if(!stdout.write(output))outputBlocked=true;
  };
  const finish=(stopped=false)=>{
    if(closed)return;closed=true;
    clearInterval(statusTimer);clearInterval(logTimer);
    stdin.off('keypress',keyHandler);stdin.off('end',onInputEnd);stdout.off('resize',paint);stdout.off('drain',onDrain);stdout.off('error',onOutputError);
    process.off('SIGTERM',onInputEnd);process.off('SIGHUP',onInputEnd);
    try{stdin.setRawMode(wasRaw);}catch{/* A disconnected terminal may no longer accept mode changes. */}
    stdin.pause();
    if(!outputBroken)stdout.write('\x1b[?1000l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m\x1b[?1049l'+
      (stopped?'Virelo stopped.':state.busy?'Console closed. The requested server operation continues.':state.connected?'Console closed. Virelo keeps running at '+terminalText(state.status.url)+'.':'Console closed. Check the server with "virelo status".')+'\n');
    resolveClosed();
  };
  const onInputEnd=()=>finish(),onOutputError=()=>{outputBroken=true;finish();},onDrain=()=>{outputBlocked=false;paint();};
  const updateLibraries=async()=>{
    const reply=await sendControl(profile,{action:'libraries'});
    if(!reply?.ok||!Array.isArray(reply.libraries))throw new Error(reply&&!reply.ok?reply.error:'Could not read libraries. Restart Virelo with the updated CLI.');
    if(reply.libraries.some(library=>typeof library.label!=='string'||typeof library.path!=='string'||!Number.isSafeInteger(library.id)||![0,1].includes(library.persistent)))throw new Error('Invalid library response.');
    state.libraries=reply.libraries;
  };
  const updateStatus=async()=>{
    if(closed||statusReading||state.busy)return;
    statusReading=true;
    const requestedPid=state.status.pid;let received=false;
    try{
      const reply=await sendControl(profile,{action:'status'});
      if(!reply?.ok)throw new Error(reply&&!reply.ok?reply.error:'Server disconnected.');
      if(closed||state.busy||state.status.pid!==requestedPid)return;
      received=true;
      state.status=snapshot(reply.status);state.connected=true;
      if(connectionError){message('Reconnected.');connectionError=false;}
      if(state.view==='libraries')await updateLibraries();
      const saved=await readServerSettings(profile.dataDir);
      if(saved&&state.modal?.type!=='port'){
        if(saved.port!==state.desiredPort)state.restartRequired=saved.port!==state.status.port;
        state.desiredPort=saved.port;
        if(saved.port!==0&&saved.port===state.status.port)state.restartRequired=false;
      }
    }catch(error){if(!received){state.connected=false;connectionError=true;}message(error instanceof Error?error.message:String(error),true);}
    finally{statusReading=false;paint();}
  };
  const updateLogs=async()=>{
    if(closed||state.view!=='logs'||logReading)return;
    logReading=true;
    try{const added=await log.update();state.logs=log.entries;if(state.logPaused)state.logOffset+=added;}
    catch(error){message('Could not read the log: '+(error instanceof Error?error.message:String(error)),true);}
    finally{logReading=false;paint();}
  };
  const work=async(label:string,task:()=>Promise<void>)=>{
    if(state.busy||closed)return;state.busy=label;paint();
    try{await task();}catch(error){message(error instanceof Error?error.message:String(error),true);}
    finally{state.busy='';paint();}
  };
  const show=(view:ConsoleView)=>{
    state.view=view;state.navigation=['overview','libraries','logs','settings'].indexOf(view);state.focus='content';state.selection=0;
    if(view==='libraries')void work('Loading folders',updateLibraries);
    if(view==='logs')void updateLogs();
    paint();
  };
  const modal=(type:ConsoleModal['type'],value='')=>{state.modal={type,value,cursor:value.length};paint();};
  const confirm=async()=>{
    const form=state.modal;if(!form)return;
    if(form.cancel){state.modal=null;paint();return;}
    if(form.type==='upgrade'){
      if(acknowledgeUpgrade)await acknowledgeUpgrade();state.modal=null;return;
    }
    if(form.type==='search'){state.search=form.value;state.logOffset=0;state.modal=null;return;}
    if(form.type==='port'){
      try{const saved=await saveTerminalPort(profile,state.status,form.value);state.desiredPort=saved.port;state.restartRequired=saved.port!==state.status.port;
        state.modal=null;message(state.restartRequired?'Port saved. Restart the server to apply it.':'Port saved.');}
      catch(error){form.error=error instanceof Error?error.message:String(error);}
      return;
    }
    if(form.type==='folder'){
      const path=terminalMediaPath(form.value);if(!path){state.modal=null;return;}
      const reply=await sendControl(profile,{action:'addMedia',path});
      if(!reply?.ok){form.error=reply&&!reply.ok?reply.error:'Server is not reachable.';return;}
      state.modal=null;state.status=snapshot(reply.status);await updateLibraries();message('Folder added for this run.');return;
    }
    if(form.type==='restart'){
      if(!state.status.restartSupported)throw new Error('Restart this server with its external service manager.');
      await ensureTerminalPortAvailable(profile,state.status);
      const pid=state.status.pid,reply=await sendControl(profile,{action:'restart'});
      if(!reply?.ok)throw new Error(reply&&!reply.ok?reply.error:'Server is not reachable.');
      state.modal=null;state.connected=false;
      state.status=await waitForTerminalRestart(profile,pid);state.connected=true;connectionError=false;state.restartRequired=false;
      await updateLibraries();message('Server restarted at '+state.status.url+'.');return;
    }
    const reply=await sendControl(profile,{action:'stop'});
    if(!reply?.ok)throw new Error(reply&&!reply.ok?reply.error:'Server is not reachable.');
    await waitForStop(profile);finish(true);
  };
  const activate=(action:ConsoleAction|`nav:${number}`)=>{
    if(closed)return;
    if(action==='close'){finish();return;}
    if(state.busy)return;
    if(state.modal){
      const type=state.modal.type;
      if(action==='cancel'){state.modal=null;paint();}
      if(action==='confirm')void work(type==='restart'?'Restarting':type==='stop'?'Stopping':'Saving',async()=>{
        try{await confirm();}catch(error){if(state.modal)state.modal.error=error instanceof Error?error.message:String(error);else throw error;}
      });
      return;
    }
    if(action.startsWith('nav:')){
      const index=Number(action.slice(4));state.navigation=index;
      if(index<4){show((['overview','libraries','logs','settings'] as const)[index]);return;}
      activate((['open','scan','close','stop'] as const)[index-4]);return;
    }
    if(action==='open')void work('Opening browser',async()=>{await (io.openBrowser??open)(terminalBrowserUrl(state.status));});
    else if(action==='logs')show('logs');
    else if(action==='scan')void work('Starting scan',async()=>{const reply=await sendControl(profile,{action:'scan'});if(!reply?.ok)throw new Error(reply&&!reply.ok?reply.error:'Server is not reachable.');message(reply.message||'Scan requested.');state.status=snapshot(reply.status);});
    else if(action==='editPort')modal('port',String(state.desiredPort));
    else if(action==='restart')modal('restart');
    else if(action==='stop')modal('stop');
    else if(action==='addFolder')modal('folder');
    else if(action==='pauseLogs'){state.logPaused=!state.logPaused;if(!state.logPaused)state.logOffset=0;}
    else if(action==='filterLogs'){state.logFilter=state.logFilter===0?40:state.logFilter===40?50:0;state.logOffset=0;}
    else if(action==='searchLogs')modal('search',state.search);
    paint();
  };
  const scroll=(amount:number)=>{
    if(state.view==='logs'){
      const max=Math.max(0,visibleLogs(state).length-lastFrame.logRows);
      state.logOffset=Math.max(0,Math.min(max,state.logOffset+amount));state.logPaused=state.logOffset>0;
    }else if(state.view==='libraries'){
      const max=Math.max(0,state.libraries.length-lastFrame.libraryRows);
      state.libraryOffset=Math.max(0,Math.min(max,Math.min(max,state.libraryOffset)-amount));
    }
    paint();
  };
  const edit=(text:string)=>{
    const form=state.modal;if(!form||!['port','folder','search'].includes(form.type))return;
    const value=terminalText(text).slice(0,4096);
    if(form.type==='port'&&!/^\d*$/.test(value))return;
    const limit=form.type==='port'?5:form.type==='search'?256:4096;
    if(form.value.length+value.length>limit)return;
    form.value=form.value.slice(0,form.cursor)+value+form.value.slice(form.cursor);form.cursor+=value.length;form.error=undefined;form.cancel=false;paint();
  };
  const onKey=(value:string|undefined,key:Key)=>{
    if(closed)return;
    if(key.name==='paste-start'){paste='';return;}
    if(paste!==null){if(key.name==='paste-end'){edit(paste);paste=null;}else if(paste.length<4096)paste+=value??'';return;}
    if(key.ctrl&&key.name==='c'){finish();return;}
    if((stdout.columns||100)<46||(stdout.rows||32)<18){if(key.name==='q')finish();return;}
    if(state.modal){
      const form=state.modal;
      if(key.name==='escape'){state.modal=null;paint();return;}
      if(state.busy)return;
      if(key.name==='return'){activate('confirm');return;}
      if(key.name==='tab'){form.cancel=!form.cancel;paint();return;}
      const input=['port','folder','search'].includes(form.type);
      if(!input){if(['left','right'].includes(key.name??''))form.cancel=!form.cancel;else if(key.name==='y'){form.cancel=false;activate('confirm');}else if(key.name==='n'){state.modal=null;}paint();return;}
      const positions=[...graphemes.segment(form.value)].map(part=>part.index).concat(form.value.length);
      if(key.ctrl&&key.name==='u'){form.value='';form.cursor=0;}
      else if(key.name==='home'||key.ctrl&&key.name==='a')form.cursor=0;
      else if(key.name==='end'||key.ctrl&&key.name==='e')form.cursor=form.value.length;
      else if(key.name==='left')form.cursor=positions.findLast(position=>position<form.cursor)??0;
      else if(key.name==='right')form.cursor=positions.find(position=>position>form.cursor)??form.value.length;
      else if(key.name==='backspace'){const previous=positions.findLast(position=>position<form.cursor)??0;form.value=form.value.slice(0,previous)+form.value.slice(form.cursor);form.cursor=previous;}
      else if(key.name==='delete'){const next=positions.find(position=>position>form.cursor)??form.value.length;form.value=form.value.slice(0,form.cursor)+form.value.slice(next);}
      else if(value&&!key.ctrl&&!key.meta){edit(value);return;}
      paint();return;
    }
    if(key.name==='q'){finish();return;}if(state.busy)return;
    if(key.name==='o'){activate('open');return;}if(key.name==='x'){modal('stop');return;}
    if(key.name==='tab'){state.focus=state.focus==='navigation'?'content':'navigation';paint();return;}
    if(key.name==='escape'){state.focus='navigation';paint();return;}
    if(state.view==='logs'&&(key.name==='space'||key.name==='f')){activate('pauseLogs');return;}
    if(state.view==='logs'&&value==='/'){activate('searchLogs');return;}
    if(state.focus==='navigation'){
      if(key.name==='up')state.navigation=(state.navigation+consoleActions.length-1)%consoleActions.length;
      else if(key.name==='down')state.navigation=(state.navigation+1)%consoleActions.length;
      else if(key.name==='return'||key.name==='right'){activate(`nav:${state.navigation}`);return;}
    }else if(state.view==='logs'||state.view==='libraries'){
      if(key.name==='up')scroll(1);else if(key.name==='down')scroll(-1);
      else if(key.name==='pageup')scroll(state.view==='libraries'?lastFrame.libraryRows:lastFrame.logRows);else if(key.name==='pagedown')scroll(-(state.view==='libraries'?lastFrame.libraryRows:lastFrame.logRows));
      else if(key.name==='home')scroll(Number.MAX_SAFE_INTEGER);else if(key.name==='end'){state.logPaused=false;state.logOffset=0;state.libraryOffset=state.view==='libraries'?Math.max(0,state.libraries.length-lastFrame.libraryRows):0;}
      else if(key.name==='left'||key.name==='right')state.selection=(state.selection+1)%(state.view==='logs'?3:2);
      else if(key.name==='return')activate(state.view==='logs'?(['pauseLogs','filterLogs','searchLogs'] as const)[state.selection]:state.selection===0?'addFolder':'scan');
    }else{
      if(['up','down','left','right'].includes(key.name??''))state.selection=(state.selection+1)%2;
      else if(key.name==='return')activate(state.view==='settings'?state.selection===0?'editPort':'restart':state.selection===0?'open':'logs');
    }
    paint();
  };
  const keyHandler=(value:string|undefined,key:Key)=>{
    if(key.code==='[M'){legacyMouse=3;return;}if(legacyMouse){legacyMouse--;return;}
    if(key.code==='[<'){mouse='\x1b[<';return;}
    if(mouse){
      mouse+=key.sequence??value??'';
      const match=mouse.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/);
      if(match){mouse='';if(match[4]==='m')return;const button=Number(match[1]),x=Number(match[2])-1,y=Number(match[3])-1;
        if(button===64||button===65){if(!state.modal)scroll(button===64?3:-3);return;}
        if(button===0){const hit=lastFrame.hits.findLast(hit=>y===hit.y&&x>=hit.x&&x<hit.x+hit.width);if(hit)activate(hit.action);}return;
      }
      if(mouse.length>48||/[^\x1b\[<\d;Mm]/.test(mouse))mouse='';return;
    }
    onKey(value,key);
  };
  try{
    const saved=await readServerSettings(profile.dataDir);if(saved){state.desiredPort=saved.port;state.restartRequired=saved.port!==0&&saved.port!==initial.port;}
    stdin.setRawMode(true);emitKeypressEvents(stdin);stdin.on('keypress',keyHandler);stdin.once('end',onInputEnd);
    stdout.on('resize',paint);stdout.on('drain',onDrain);stdout.once('error',onOutputError);
    process.once('SIGTERM',onInputEnd);process.once('SIGHUP',onInputEnd);
    stdout.write('\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h');stdin.resume();
    statusTimer=setInterval(()=>{void updateStatus();},io.statusInterval??1500);
    logTimer=setInterval(()=>{void updateLogs();},io.logInterval??250);
    paint();await completed;
  }finally{stdin.off('keypress',keyHandler);finish();}
}
