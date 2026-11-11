export interface Notification {
  id:number; title:string; body:string; createdAt:number; readAt:number|null;
}
export interface NotificationPage { items:Notification[]; unread:number; nextBefore:number|null; }
export interface Announcement extends Omit<Notification,'readAt'> { recipients:number; }
export interface AnnouncementWrite { title:string; body:string; userIds?:number[]; }
