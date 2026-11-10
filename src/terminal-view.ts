import { TerminalCanvas, fitTerminal, terminalInputWindow } from './terminal-canvas.js';
import type { LogEntry } from './terminal-log.js';
import type { ManagedLibrary, ServerSnapshot } from './server-control.js';

export type ConsoleView='overview'|'libraries'|'logs'|'settings';
export const consoleActions=['Overview','Libraries','Live logs','Settings','Open in browser','Scan libraries','Close console','Stop server'] as const;
export type ConsoleAction='editPort'|'restart'|'addFolder'|'scan'|'open'|'logs'|'pauseLogs'|'filterLogs'|'searchLogs'|'close'|'stop'|'confirm'|'cancel';
export interface ConsoleModal {type:'port'|'folder'|'search'|'restart'|'stop'|'upgrade';value:string;cursor:number;error?:string;cancel?:boolean}
export interface ConsoleState {
  view:ConsoleView;navigation:number;focus:'navigation'|'content';selection:number;
  status:ServerSnapshot;connected:boolean;busy:string;notice:string;error:boolean;
  desiredPort:number;restartRequired:boolean;libraries:ManagedLibrary[];libraryOffset:number;
  logs:LogEntry[];logPaused:boolean;logOffset:number;logFilter:number;search:string;modal:ConsoleModal|null;
}
export interface ConsoleHit {x:number;y:number;width:number;action:ConsoleAction|`nav:${number}`}
export function visibleLogs(state:ConsoleState):LogEntry[]{return state.logs.filter(entry=>entry.level>=state.logFilter&&entry.text.toLocaleLowerCase().includes(state.search.toLocaleLowerCase()));}

export function renderConsole(state:ConsoleState,columns:number,rows:number,color=true,ascii=false){
  const width=Math.max(12,Math.min(200,columns-1)),height=Math.max(5,Math.min(100,rows));
  const canvas=new TerminalCanvas(width,height,ascii),hits:ConsoleHit[]=[];
  const wide=width>=90,navWidth=wide?21:0,bodyX=wide?24:1,bodyY=wide?4:5,bodyW=width-bodyX-1;
  const bodyH=Math.min(height-bodyY-3,state.view==='overview'?11:state.view==='settings'?13:height);
  const libraryRows=Math.max(1,Math.floor((bodyH-7)/2));
  const button=(action:ConsoleHit['action'],x:number,y:number,label:string,selected=false,max=bodyW)=>{
    const text=fitTerminal(' '+label+' ',max);
    canvas.text(x,y,text,selected?'selected':'normal',max);
    hits.push({x,y,width:Math.min(max,text.length),action});
  };
  canvas.text(2,1,'Virelo','title');if(width>=65)canvas.text(10,1,'Server console','muted');
  canvas.text(Math.max(10,width-24),1,state.busy|| (state.connected?'● Connected':'○ Disconnected'),state.connected?'success':'danger',23);
  canvas.text(2,2,state.status.url,'muted',width-4);
  if(width<45||height<18){
    canvas.text(2,6,'Resize to at least 46 × 18.','muted');
    canvas.text(2,8,'Q closes this console.','normal');canvas.text(2,9,'The server keeps running.','muted');
    return {lines:canvas.lines(color),hits,logRows:1,libraryRows:1,cursor:null};
  }
  if(wide){
    for(let i=0;i<consoleActions.length;i++){
      const y=4+i+(i>=4?1:0)+(i>=6?1:0);
      if(y>=height-4)break;
      const selected=state.focus==='navigation'&&state.navigation===i;
      canvas.fill(1,y,navWidth,selected?'selected':'normal');
      canvas.text(3,y,consoleActions[i],selected?'selected':i===7?'danger':i===['overview','libraries','logs','settings'].indexOf(state.view)?'title':'normal',navWidth-3);
      hits.push({x:1,y,width:navWidth,action:`nav:${i}`});
    }
    canvas.text(3,height-4,'v'+state.status.version,'muted',navWidth-2);
  }else{
    let x=2;
    for(let i=0;i<4;i++){
      const label=['Home','Folders','Logs','Settings'][i];
      button(`nav:${i}`,x,4,label,state.navigation===i,label.length+4);x+=label.length+5;
    }
  }
  canvas.box(bodyX,bodyY,bodyW,bodyH,consoleActions[['overview','libraries','logs','settings'].indexOf(state.view)]);
  const x=bodyX+2,y=bodyY+2,inner=bodyW-4;
  const logRows=Math.max(1,bodyH-6);
  if(state.view==='overview'){
    const cardW=Math.floor((inner-4)/3),uptime=Math.max(0,Math.floor((Date.now()-state.status.startedAt)/60000));
    for(const [i,label,value] of [[0,'Server',state.connected?'Online':'Offline'],[1,'Libraries',String(state.status.libraries)],[2,'Scan',state.status.scanRunning?'Running':'Idle']] as const){
      const cx=x+i*(cardW+2);canvas.text(cx,y,label,'muted',cardW);canvas.text(cx,y+1,value,i===0&&state.connected?'success':i===0?'danger':'title',cardW);
    }
    for(const [i,label,value] of [[0,'Uptime',Math.floor(uptime/60)+'h '+uptime%60+'m'],[1,'Process',String(state.status.pid)],[2,'Data folder',state.status.dataDir]] as const){
      const row=y+3+i;
      canvas.text(x,row,label,'muted',12);canvas.text(x+14,row,value,'normal',inner-14);
    }
    button('open',x,y+7,'Open in browser',state.focus==='content'&&state.selection===0);
    button('logs',x+21,y+7,'Live logs',state.focus==='content'&&state.selection===1,inner-21);
  }else if(state.view==='libraries'){
    button('addFolder',x,y,'Add folder',state.focus==='content'&&state.selection===0);
    button('scan',x+18,y,'Scan',state.focus==='content'&&state.selection===1,inner-18);
    canvas.text(x,y+2,state.status.libraries+' active folders','muted',inner);
    const count=libraryRows;
    const offset=Math.min(state.libraryOffset,Math.max(0,state.libraries.length-count));
    for(const [index,library] of state.libraries.slice(offset,offset+count).entries()){
      const ly=y+3+index*2;canvas.text(x,ly,library.label,'title',inner-13);
      canvas.text(x+Math.max(0,inner-11),ly,library.persistent?'Saved':'Temporary','muted',11);
      canvas.text(x,ly+1,library.path,'muted',inner);
    }
    if(!state.libraries.length)canvas.text(x,y+4,'No folders added.','muted',inner);
    if(state.libraries.length>count)canvas.text(x,bodyY+bodyH-2,'↑↓ / PgUp PgDn scroll folders','muted',inner);
  }else if(state.view==='settings'){
    canvas.text(x,y,'Address','muted',12);canvas.text(x+14,y,state.status.url,'normal',inner-14);
    canvas.text(x,y+2,'Saved port','muted',12);
    const value=state.desiredPort===0?'Automatic (0)':String(state.desiredPort);
    button('editPort',x+14,y+2,value+'  · Edit',state.focus==='content'&&state.selection===0,Math.min(inner-14,35));
    canvas.text(x,y+3,state.restartRequired?'Restart required to apply the saved port.':'Port changes take effect after a restart.','muted',inner);
    button('restart',x,y+5,'Restart server',state.focus==='content'&&state.selection===1,inner);
    if(bodyH>=12){canvas.text(x,y+7,'Bind address','muted',12);canvas.text(x+14,y+7,state.status.host,'normal',inner-14);canvas.text(x,y+8,'Data folder','muted',12);canvas.text(x+14,y+8,state.status.dataDir,'normal',inner-14);}
  }else{
    button('pauseLogs',x,y,state.logPaused?'Resume':'Pause',state.focus==='content'&&state.selection===0,12);
    button('filterLogs',x+13,y,state.logFilter===50?'Errors':state.logFilter===40?'Warnings':'All levels',state.focus==='content'&&state.selection===1,15);
    button('searchLogs',x+29,y,'Search',state.focus==='content'&&state.selection===2,Math.max(0,inner-29));
    const entries=visibleLogs(state),offset=Math.min(state.logOffset,Math.max(0,entries.length-logRows));
    const end=Math.max(0,entries.length-offset),start=Math.max(0,end-logRows);
    for(const [i,entry] of entries.slice(start,end).entries())canvas.text(x,y+2+i,entry.text,entry.level>=50?'danger':entry.level>=40?'accent':'normal',inner);
    if(!entries.length)canvas.text(x,y+3,state.search?'No matching log entries.':'Waiting for log output…','muted',inner);
    canvas.text(x,bodyY+bodyH-2,(state.logPaused?'Paused':'Live')+'  ·  '+entries.length+' buffered'+(state.search?'  ·  '+state.search:''),'muted',inner);
  }
  if(state.notice)canvas.text(2,height-3,state.notice,state.error?'danger':'success',width-4);
  const help=state.modal?'Enter Confirm  Esc Cancel':state.view==='logs'&&state.focus==='content'?'↑↓ Scroll  Space Pause  / Search  End Live  Tab Menu  Q Close':'Tab Focus  ↑↓ Select  Enter Open  O Browser  Q Close  X Stop';
  canvas.text(2,height-1,ascii?help.replaceAll('↑↓','Up/Down'):help,'muted',width-4);
  let cursor:{x:number;y:number}|null=null;
  if(state.modal){
    const modal=state.modal,w=Math.min(width-4,68),h=modal.type==='upgrade'?12:11,mx=Math.floor((width-w)/2),my=Math.max(4,Math.floor((height-h)/2));
    for(let row=my;row<Math.min(height-2,my+h);row++)canvas.fill(mx,row,w);
    const title={port:'Change port',folder:'Add folder',search:'Find in logs',restart:'Restart server?',stop:'Stop server?',upgrade:'Startup change'}[modal.type];
    canvas.box(mx,my,w,h,title);
    canvas.text(mx+w-6,my,'esc','muted',4);
    const input=['port','folder','search'].includes(modal.type);
    const description=modal.type==='port'?'Port 0 chooses an available port automatically.':modal.type==='folder'?'Folder path · temporary for this server run':modal.type==='search'?'Filter the local server log.':modal.type==='restart'?'Playback will pause while the server restarts.':modal.type==='stop'?'Connected viewers will be disconnected.':'The current directory is no longer scanned automatically.';
    canvas.text(mx+2,my+2,description,'muted',w-4);
    if(input){
      canvas.fill(mx+2,my+4,w-4,'field');
      const input=terminalInputWindow(modal.value,modal.cursor,w-6);canvas.text(mx+3,my+4,input.text,'field',w-6);
      cursor={x:mx+3+input.cursor,y:my+4};
    }else if(modal.type==='upgrade'){
      canvas.text(mx+2,my+4,'Saved libraries have not changed.','normal',w-4);
      canvas.text(mx+2,my+6,'Use --here to include the current folder.','muted',w-4);
    }else canvas.text(mx+2,my+4,modal.type==='restart'?'The console reconnects at the new address.':'You can start it again from this terminal.','normal',w-4);
    if(modal.error)canvas.text(mx+2,my+6,modal.error,'danger',w-4);
    button('confirm',mx+2,my+h-3,modal.type==='port'?'Save port':modal.type==='folder'?'Add folder':modal.type==='search'?'Apply filter':modal.type==='upgrade'?'Continue':modal.type==='stop'?'Stop server':'Restart',!modal.cancel,w-4);
    if(modal.type!=='upgrade')button('cancel',mx+w-14,my+h-3,'Cancel',!!modal.cancel,12);
  }
  return {lines:canvas.lines(color),hits,logRows,libraryRows,cursor};
}
