import type { DatabaseSync } from 'node:sqlite';
import type { FastifyInstance } from 'fastify';
import { AccountError } from './accounts.js';
import type { Announcement, AnnouncementWrite, NotificationPage } from './notification-types.js';

const RETENTION=90*86400000;
function text(value:unknown,label:string,limit:number){
  if(typeof value==='string')value=value.replace(/\r\n?/g,'\n');
  if(typeof value!=='string'||!value.trim()||[...value].length>limit||/[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value))throw new AccountError(`${label} must contain 1–${limit} characters.`);
  return value.trim().normalize('NFC');
}
function id(value:unknown){const number=Number(value);if(!Number.isSafeInteger(number)||number<=0)throw new AccountError('Invalid notification.');return number;}

export class Notifications {
  constructor(private db:DatabaseSync){
    db.exec(`CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,body TEXT NOT NULL,created_at INTEGER NOT NULL,
      sender_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL
    );
    CREATE TABLE IF NOT EXISTS notification_recipients (
      announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,read_at INTEGER,
      PRIMARY KEY(announcement_id,user_id)
    );
    CREATE INDEX IF NOT EXISTS notifications_user ON notification_recipients(user_id,announcement_id);
    CREATE INDEX IF NOT EXISTS announcements_created ON announcements(created_at);`);
  }
  private prune(){this.db.prepare('DELETE FROM announcements WHERE created_at<?').run(Date.now()-RETENTION);}
  send(sender:number,input:AnnouncementWrite){
    const title=text(input?.title,'Title',120),body=text(input?.body,'Message',4000);
    if(input.userIds!==undefined&&(!Array.isArray(input.userIds)||!input.userIds.length||input.userIds.length>5000||input.userIds.some(value=>!Number.isSafeInteger(value)||value<=0)))throw new AccountError('Select between 1 and 5,000 users.');
    const requested=input.userIds===undefined?null:new Set(input.userIds);
    this.prune();
    const enabled=this.db.prepare('SELECT id FROM accounts WHERE enabled=1').all() as {id:number}[];
    const users=enabled.filter(user=>requested===null||requested.has(user.id));
    if(!users.length||users.length>5000||requested&&users.length!==requested.size)throw new AccountError('One or more selected users are unavailable. Reload the user list.');
    if(Number(this.db.prepare('SELECT COUNT(*) AS count FROM announcements').get()!.count)>=200||Number(this.db.prepare('SELECT COUNT(*) AS count FROM notification_recipients').get()!.count)+users.length>100000)throw new AccountError('Notification storage is full. Withdraw older announcements before sending another.',409);
    if(Number(this.db.prepare('SELECT COUNT(*) AS count FROM announcements WHERE created_at>?').get(Date.now()-60000)!.count)>=10)throw new AccountError('Too many announcements. Try again in a minute.',429);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const result=this.db.prepare('INSERT INTO announcements(title,body,created_at,sender_id) VALUES(?,?,?,?)').run(title,body,Date.now(),sender);
      const insert=this.db.prepare('INSERT INTO notification_recipients(announcement_id,user_id) VALUES(?,?)');
      for(const user of users)insert.run(result.lastInsertRowid,user.id);
      this.db.exec('COMMIT');return {id:Number(result.lastInsertRowid),recipients:users.length};
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  sent():Announcement[]{
    this.prune();
    return this.db.prepare(`SELECT a.id,a.title,a.body,a.created_at AS createdAt,COUNT(r.user_id) AS recipients
      FROM announcements a LEFT JOIN notification_recipients r ON r.announcement_id=a.id GROUP BY a.id ORDER BY a.id DESC`).all() as unknown as Announcement[];
  }
  inbox(user:number,before?:number):NotificationPage{
    this.prune();if(before!==undefined)id(before);
    const rows=this.db.prepare(`SELECT a.id,a.title,a.body,a.created_at AS createdAt,r.read_at AS readAt
      FROM notification_recipients r JOIN announcements a ON a.id=r.announcement_id
      WHERE r.user_id=? AND a.id<? ORDER BY a.id DESC LIMIT 51`).all(user,before??Number.MAX_SAFE_INTEGER) as unknown as NotificationPage['items'];
    const items=rows.slice(0,50),unread=Number(this.db.prepare('SELECT COUNT(*) AS count FROM notification_recipients WHERE user_id=? AND read_at IS NULL').get(user)!.count);
    return {items,unread,nextBefore:rows.length>50?items.at(-1)!.id:null};
  }
  read(user:number,notification?:number){
    if(notification!==undefined)id(notification);
    this.db.prepare('UPDATE notification_recipients SET read_at=? WHERE user_id=? AND read_at IS NULL'+(notification===undefined?'':' AND announcement_id=?')).run(Date.now(),user,...(notification===undefined?[]:[notification]));
  }
  withdraw(notification:number){this.db.prepare('DELETE FROM announcements WHERE id=?').run(id(notification));}
}

export function registerNotifications(app:FastifyInstance,db:DatabaseSync){
  const notifications=new Notifications(db);
  app.get<{Querystring:{before?:string}}>('/api/notifications',async request=>notifications.inbox(request.account!.id,request.query.before===undefined?undefined:id(request.query.before)));
  app.post<{Body:{id?:number}}>('/api/notifications/read',async request=>{
    const body=request.body;
    if(!body||typeof body!=='object'||Array.isArray(body)||body.id!==undefined&&typeof body.id!=='number')throw new AccountError('Invalid notification.');
    notifications.read(request.account!.id,body.id);return {ok:true};
  });
  app.get('/api/accounts/announcements',async()=>notifications.sent());
  app.post<{Body:AnnouncementWrite}>('/api/accounts/announcements',async request=>{
    if(!request.body||typeof request.body!=='object'||Array.isArray(request.body))throw new AccountError('A message is required.');
    return notifications.send(request.account!.id,request.body);
  });
  app.delete<{Params:{id:string}}>('/api/accounts/announcements/:id',async request=>{notifications.withdraw(id(request.params.id));return {ok:true};});
}
