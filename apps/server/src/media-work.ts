export type MediaWorkKind='interactive'|'probe'|'video'|'background';
export interface MediaWorkOptions {kind:MediaWorkKind;owner?:string;scope?:string;signal?:AbortSignal;key?:string;}
export class MediaBusyError extends Error {
  readonly statusCode=503;
  readonly headers={'Retry-After':'1'};
  constructor(){super('The server is busy. Please try again shortly.');}
}
type Task={options:MediaWorkOptions;controller:AbortController;promise:Promise<unknown>;start:()=>void;cleanup:()=>void;queuedAt:number;};
const light=(kind:MediaWorkKind)=>kind==='interactive';
const rank={interactive:0,probe:1,video:2,background:3};

export class MediaScheduler {
  private pending:Task[]=[];
  private active=new Set<Task>();
  private closed=new Set<string>();
  private previousOwner=new Map<number,string>();
  private pumping=false;
  openScope(scope:string){this.closed.delete(scope);}
  private owner(options:MediaWorkOptions){return `${options.scope??''}:${options.owner??'system'}`;}
  run<T>(work:(signal:AbortSignal)=>Promise<T>,options:MediaWorkOptions):Promise<T>{
    options={...options};
    if(options.signal?.aborted||options.scope&&this.closed.has(options.scope))return Promise.reject(new Error('Media work was cancelled.'));
    const fast=light(options.kind),owner=this.owner(options);
    if(this.pending.length>=(fast?64:56)||this.pending.filter(task=>this.owner(task.options)===owner&&light(task.options.kind)===fast).length>=(fast?8:16))return Promise.reject(new MediaBusyError());
    let resolve!:(value:T)=>void,reject!:(error:Error)=>void;
    const promise=new Promise<T>((done,fail)=>{resolve=done;reject=fail;});
    const controller=new AbortController();
    const abort=()=>controller.abort();
    const cancel=()=>{
      const index=this.pending.indexOf(task);
      if(index<0)return;
      this.pending.splice(index,1);task.cleanup();reject(new Error('Media work was cancelled.'));this.pump();
    };
    const timer=setTimeout(()=>{const index=this.pending.indexOf(task);if(index>=0){this.pending.splice(index,1);task.cleanup();reject(new MediaBusyError());this.pump();}},30_000);timer.unref();
    const task:Task={options,controller,promise,queuedAt:Date.now(),cleanup:()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',cancel);},start:()=>{
      clearTimeout(timer);controller.signal.removeEventListener('abort',cancel);
      this.active.add(task);
      void Promise.resolve().then(()=>work(controller.signal)).then(resolve,reject).finally(()=>{task.cleanup();this.active.delete(task);this.pump();});
    }};
    options.signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',cancel,{once:true});
    this.pending.push(task);if(options.signal?.aborted)controller.abort();else this.pump();
    return promise;
  }
  promote(key:string,owner?:string){
    for(const task of this.pending)if(task.options.key===key&&task.options.kind==='background'){task.options.kind='probe';task.options.owner=owner;}
    this.pump();
  }
  private pump(){
    if(this.pumping)return;this.pumping=true;
    try{while(this.active.size<3){
      const active=[...this.active],fast=active.filter(task=>light(task.options.kind)).length,heavy=active.length-fast;
      const candidates=this.pending.filter(task=>light(task.options.kind)?fast<1:heavy<2&&(task.options.kind!=='background'||!active.some(item=>item.options.kind==='background')));
      if(!candidates.length)break;
      const priority=(task:Task)=>task.options.kind==='background'?3:Math.max(0,rank[task.options.kind]-Math.floor((Date.now()-task.queuedAt)/2000));
      const best=Math.min(...candidates.map(priority)),eligible=candidates.filter(task=>priority(task)===best);
      const owners=[...new Set(eligible.map(task=>this.owner(task.options)))].sort();
      const next=owners.find(owner=>owner>(this.previousOwner.get(best)??''))??owners[0];
      const task=eligible.find(item=>this.owner(item.options)===next)!;
      this.previousOwner.set(best,this.owner(task.options));this.pending.splice(this.pending.indexOf(task),1);task.start();
    }}finally{this.pumping=false;}
  }
  async closeScope(scope:string){
    this.closed.add(scope);
    const tasks=[...this.pending,...this.active].filter(task=>task.options.scope===scope);
    for(const task of tasks)task.controller.abort();
    await Promise.allSettled(tasks.map(task=>task.promise));
  }
}
export const mediaScheduler=new MediaScheduler();
