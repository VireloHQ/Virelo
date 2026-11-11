import { randomUUID } from 'node:crypto';
import { AccountError, sessionDigest } from './accounts.js';
import type { VireloDB } from './db.js';
import type { Accounts } from './accounts.js';
import type { Account, AccountDataCategory, AccountDataSummary, ActivityHeartbeat, ActivityPage, ActivityPolicy, CatalogScope, LiveActivity } from './auth-types.js';

const day=86400_000, onlineWindow=90_000, maxEvents=10_000;
type LiveEntry=Omit<LiveActivity,'title'|'displayName'|'username'> & {digest:string};
type EventRow={id:number;created_at:number;actor_id:number|null;target_id:number|null;action:string;media_id:number|null;actor_name:string|null;target_name:string|null};

export class AccountActivity {
  private live=new Map<string,LiveEntry>();
  private lastPrune=0;
  constructor(private catalog:VireloDB,private accounts:Accounts) {
    catalog.db.exec(`CREATE TABLE IF NOT EXISTS account_activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,created_at INTEGER NOT NULL,
      actor_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,target_id INTEGER,
      action TEXT NOT NULL,media_id INTEGER,retention_days INTEGER NOT NULL DEFAULT 30);
      CREATE INDEX IF NOT EXISTS account_activity_actor ON account_activity(actor_id,id);
      CREATE INDEX IF NOT EXISTS account_activity_target ON account_activity(target_id,id);
      CREATE INDEX IF NOT EXISTS account_activity_time ON account_activity(created_at);`);
    if(!(catalog.db.prepare('PRAGMA table_info(account_activity)').all() as {name:string}[]).some(column=>column.name==='retention_days'))
      catalog.db.exec('ALTER TABLE account_activity ADD COLUMN retention_days INTEGER NOT NULL DEFAULT 7');
    this.prune();
  }
  policy():ActivityPolicy {
    const value=this.catalog.db.prepare("SELECT value FROM account_config WHERE key='activityPolicy'").get()?.value;
    return value?{...JSON.parse(String(value)),maxEvents}:{enabled:false,retentionDays:30,revision:0,maxEvents};
  }
  configure(input:Record<string,unknown>,actorId:number) {
    const previous=this.policy();
    if(typeof input.enabled!=='boolean'||![7,30,90].includes(Number(input.retentionDays))||typeof input.retentionDays!=='number')throw new AccountError('Choose a valid monitoring policy.');
    if(input.revision!==previous.revision)throw new AccountError('Monitoring settings changed elsewhere. Reload before saving.',409);
    if(input.enabled===previous.enabled&&input.retentionDays===previous.retentionDays)return previous;
    if(previous.enabled)this.record(actorId,'monitoring.updated',null,null,true);
    const next={enabled:input.enabled,retentionDays:input.retentionDays,revision:previous.revision+1,maxEvents};
    this.catalog.db.prepare("INSERT INTO account_config VALUES('activityPolicy',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));
    this.live.clear();this.prune();
    if(!previous.enabled&&next.enabled)this.record(actorId,'monitoring.enabled',null,null,true);
    return next;
  }
  acknowledged(value:string|undefined) {
    const policy=this.policy();
    if(!policy.enabled||!value)return false;
    const row=this.catalog.db.prepare('SELECT activity_notice_revision FROM account_sessions WHERE digest=?').get(sessionDigest(value)) as {activity_notice_revision:number}|undefined;
    return row?.activity_notice_revision===policy.revision;
  }
  acknowledge(value:string,userId:number,revision:unknown) {
    const policy=this.policy();
    if(!policy.enabled||revision!==policy.revision)return false;
    return this.catalog.db.prepare('UPDATE account_sessions SET activity_notice_revision=? WHERE digest=? AND user_id=?').run(policy.revision,sessionDigest(value),userId).changes>0;
  }
  record(actorId:number,action:string,targetId:number|null=null,mediaId:number|null=null,disclosed:boolean|number=false) {
    const policy=this.policy();
    if(!disclosed||!policy.enabled||typeof disclosed==='number'&&disclosed!==policy.revision)return;
    if(!this.accounts.get(actorId))return;
    this.catalog.db.prepare('INSERT INTO account_activity(created_at,actor_id,target_id,action,media_id,retention_days) VALUES(?,?,?,?,?,?)').run(Date.now(),actorId,targetId,action,mediaId,policy.retentionDays);
    this.prune();
  }
  prune() {
    const now=Date.now(),policy=this.policy();
    this.catalog.db.prepare('DELETE FROM account_activity WHERE created_at<? - MIN(retention_days,?)*?').run(now,policy.retentionDays,day);
    this.catalog.db.exec('DELETE FROM account_activity WHERE id NOT IN (SELECT id FROM account_activity ORDER BY id DESC LIMIT 10000)');
    this.lastPrune=now;
  }
  private pruneLive(validateSessions=false,now=Date.now()) {
    for(const [key,entry] of this.live) {
      if(entry.lastSeen+onlineWindow<=now){this.live.delete(key);continue;}
      if(!validateSessions)continue;
      const session=this.catalog.db.prepare('SELECT user_id,revision,expires_at,last_seen FROM account_sessions WHERE digest=?').get(entry.digest) as {user_id:number;revision:number;expires_at:number;last_seen:number}|undefined;
      const user=session&&this.accounts.get(session.user_id);
      if(!session||session.expires_at<=now||session.last_seen+day<=now||!user?.enabled||user.revision!==session.revision)this.live.delete(key);
    }
  }
  heartbeat(user:Account,value:string,input:ActivityHeartbeat) {
    if(!this.acknowledge(value,user.id,input.noticeVersion))return {accepted:false};
    this.pruneLive();
    const digest=sessionDigest(value),key=digest+':'+input.tabId,previous=this.live.get(key);
    if(!previous&&(this.live.size>=1024||[...this.live.values()].filter(entry=>entry.userId===user.id).length>=32))throw new AccountError('Too many active sessions. Try again later.',429);
    const entry={id:previous?.id??randomUUID(),userId:user.id,digest,lastSeen:Date.now(),state:input.state,mediaId:input.mediaId,position:input.position};
    if(previous?.mediaId!==entry.mediaId&&previous?.mediaId!=null)this.record(user.id,'playback.stopped',null,previous.mediaId,true);
    if(entry.mediaId!==null&&(previous?.mediaId!==entry.mediaId||previous.state!==entry.state))
      this.record(user.id,entry.state==='playing'?(previous?.mediaId===entry.mediaId?'playback.resumed':'playback.started'):(previous?.mediaId===entry.mediaId?'playback.paused':'playback.opened'),null,entry.mediaId,true);
    this.live.set(key,entry);
    return {accepted:true};
  }
  private visibleMedia(mediaId:number|null,scope:CatalogScope) {
    const media=mediaId===null?undefined:this.catalog.getMedia(mediaId,scope);
    return {mediaId:media?.id??null,title:media?.title??(mediaId===null?null:'Unavailable or restricted video')};
  }
  active(scope:CatalogScope):LiveActivity[] {
    this.pruneLive(true);
    if(!this.policy().enabled)return [];
    return [...this.live.values()].map(({digest,...entry})=>{
      const user=this.accounts.get(entry.userId)!;
      return {...entry,displayName:user.displayName,username:user.username,...this.visibleMedia(entry.mediaId,scope)};
    }).sort((a,b)=>b.lastSeen-a.lastSeen);
  }
  events(scope:CatalogScope,userId?:number,before?:number):ActivityPage {
    if(this.lastPrune+60_000<Date.now())this.prune();
    const rows=this.catalog.db.prepare(`SELECT e.*,a.display_name actor_name,t.display_name target_name FROM account_activity e
      LEFT JOIN accounts a ON a.id=e.actor_id LEFT JOIN accounts t ON t.id=e.target_id
      WHERE (? IS NULL OR e.actor_id=? OR e.target_id=?) AND (? IS NULL OR e.id<?) ORDER BY e.id DESC LIMIT 51`)
      .all(userId??null,userId??null,userId??null,before??null,before??null) as EventRow[];
    return {events:rows.slice(0,50).map(row=>({id:row.id,createdAt:row.created_at,actorId:row.actor_id,actorName:row.actor_name??'Deleted account',targetId:row.target_id,targetName:row.target_name,action:row.action,...this.visibleMedia(row.media_id,scope)})),nextBefore:rows.length>50?rows[49].id:null};
  }
  summary(id:number):AccountDataSummary {
    if(!this.accounts.get(id))throw new AccountError('Account not found.',404);
    if(this.lastPrune+60_000<Date.now())this.prune();
    const count=(sql:string,...params:number[])=>Number((this.catalog.db.prepare(sql).get(...params) as {n:number}).n);
    return {history:count('SELECT COUNT(*) n FROM user_progress WHERE user_id=?',id),favorites:count('SELECT COUNT(*) n FROM user_likes WHERE user_id=?',id),
      playlists:count('SELECT COUNT(*) n FROM playlists WHERE user_id=?',id),playlistItems:count('SELECT COUNT(*) n FROM playlist_items WHERE playlist_id IN (SELECT id FROM playlists WHERE user_id=?)',id),
      sessions:count('SELECT COUNT(*) n FROM account_sessions WHERE user_id=? AND expires_at>? AND last_seen>?',id,Date.now(),Date.now()-day),
      activityEvents:count('SELECT COUNT(*) n FROM account_activity WHERE actor_id=? OR target_id=?',id,id)};
  }
  clear(id:number,category:AccountDataCategory) {
    if(!this.accounts.get(id))throw new AccountError('Account not found.',404);
    const queries:Record<AccountDataCategory,string>={history:'DELETE FROM user_progress WHERE user_id=?',favorites:'DELETE FROM user_likes WHERE user_id=?',playlists:'DELETE FROM playlists WHERE user_id=?',sessions:'DELETE FROM account_sessions WHERE user_id=?',activity:'DELETE FROM account_activity WHERE actor_id=? OR target_id=?'};
    if(!Object.hasOwn(queries,category))throw new AccountError('Choose a valid data category.');
    this.catalog.db.prepare(queries[category]).run(...(category==='activity'?[id,id]:[id]));
    if(category==='sessions')for(const [key,entry] of this.live)if(entry.userId===id)this.live.delete(key);
  }
  clearEvents() {this.catalog.db.exec('DELETE FROM account_activity');}
  forget(id:number) {
    for(const [key,entry] of this.live)if(entry.userId===id)this.live.delete(key);
  }
}
