import { useRef, useState, type ReactNode } from 'react';
import { Button, Input, Modal } from '@heroui/react';
import { Bell, Check, CheckCircle, Megaphone, PaperPlaneTilt, Users, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Select } from './Select';
import { ConfirmationDialog } from './ConfirmationDialog';
import type { Announcement } from '../../../src/notification-types';
import './Communication.css';
import './ConfirmationDialog.css';
import './Notifications.css';

const notificationTime=new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'});
function NotificationCard({item,unread=false,children}:{item:Pick<Announcement,'title'|'body'|'createdAt'>;unread?:boolean;children:ReactNode}){
  return <article className="notification-item" data-unread={unread} aria-label={item.title}>
    <div className="notification-item-heading"><h3>{item.title}</h3>{unread&&<span className="notification-new">New</span>}</div>
    <p className="notification-message">{item.body}</p>
    <footer className="notification-item-footer"><time dateTime={new Date(item.createdAt).toISOString()}>{notificationTime.format(item.createdAt)}</time>{children}</footer>
  </article>;
}

export function NotificationBell(){
  const [open,setOpen]=useState(false),[cursors,setCursors]=useState<number[]>([]);
  const closeButton=useRef<HTMLButtonElement>(null);
  const client=useQueryClient(),before=cursors.at(-1);
  const inbox=useQuery({queryKey:['notifications',before],queryFn:()=>api.notifications(before),refetchInterval:30000,refetchOnWindowFocus:true});
  const read=useMutation({mutationFn:api.readNotifications,onSuccess:async()=>{
    await client.invalidateQueries({queryKey:['notifications']});
    closeButton.current?.focus({preventScroll:true});
  }});
  const unread=inbox.data?.unread??0;
  return <Modal isOpen={open} onOpenChange={setOpen}>
    <Button className="icon-button communication-trigger" isIconOnly variant="ghost" aria-label={unread?`Notifications, ${unread} unread`:'Notifications'} onPress={()=>{setCursors([]);setOpen(true);}}><Bell size={22}/>{unread>0&&<span aria-hidden="true" className="notification-badge">{unread>99?'99+':unread}</span>}</Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" isDismissable>
      <Modal.Container className="virelo-confirm-container notification-container" placement="center" size="md" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog notification-dialog" aria-label="Notifications">
          <Modal.Header className="virelo-confirm-header notification-heading"><div className="notification-heading-title"><Bell aria-hidden="true"/><Modal.Heading className="virelo-confirm-title">Notifications</Modal.Heading></div><Button ref={closeButton} className="notification-close" isIconOnly variant="ghost" aria-label="Close notifications" onPress={()=>setOpen(false)}><X/></Button></Modal.Header>
          <div className="notification-toolbar"><span className="notification-unread-count" role="status">{inbox.data&&(unread?`${unread} unread`:'No unread notifications')}</span><Button className="notification-bulk-action" variant="ghost" isDisabled={!unread||read.isPending} onPress={()=>read.mutate(undefined)}>Mark all as read</Button></div>
          <Modal.Body className="virelo-confirm-body notification-body">
            {inbox.isPending&&<p role="status">Loading notifications…</p>}
            {inbox.error&&<p className="error-copy" role="alert">Could not load notifications. <button onClick={()=>void inbox.refetch()}>Try again</button></p>}
            {read.error&&<p className="error-copy" role="alert">{read.error.message}</p>}
            <div className="notification-list">{inbox.data?.items?.map(item=><NotificationCard item={item} unread={item.readAt===null} key={item.id}>
              {item.readAt===null?<Button className="notification-read-action" variant="ghost" isDisabled={read.isPending} onPress={()=>read.mutate(item.id)}><Check aria-hidden="true"/> Mark as read</Button>:<span className="notification-read-status"><CheckCircle aria-hidden="true"/> Read</span>}
            </NotificationCard>)}</div>
            {inbox.data?.items?.length===0&&<div className="notification-empty"><Bell aria-hidden="true"/><h3>No notifications yet</h3><p>Messages from your server administrator will appear here.</p></div>}
            {(cursors.length>0||inbox.data?.nextBefore)&&<div className="notification-pagination"><Button variant="secondary" isDisabled={!cursors.length} onPress={()=>setCursors(values=>values.slice(0,-1))}>Newer</Button><Button variant="secondary" isDisabled={!inbox.data?.nextBefore} onPress={()=>setCursors(values=>[...values,inbox.data!.nextBefore!])}>Older</Button></div>}
          </Modal.Body>
          <Modal.Footer className="virelo-confirm-footer notification-footer"><p>From this server's administrators. Read status is saved to your account.</p></Modal.Footer>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}

export function AnnouncementSettings(){
  const client=useQueryClient();
  const [title,setTitle]=useState(''),[body,setBody]=useState(''),[audience,setAudience]=useState('all'),[selected,setSelected]=useState<number[]>([]),[feedback,setFeedback]=useState('');
  const users=useQuery({queryKey:['accounts'],queryFn:api.accounts});
  const sent=useQuery({queryKey:['announcements'],queryFn:api.announcements});
  const send=useMutation({mutationFn:()=>api.sendAnnouncement({title,body,...(audience==='selected'?{userIds:selected}:{})}),onSuccess:async result=>{
    setTitle('');setBody('');setFeedback(`Sent to ${result.recipients} ${result.recipients===1?'user':'users'}.`);
    await client.invalidateQueries({queryKey:['announcements']});await client.invalidateQueries({queryKey:['notifications']});
  }});
  return <section id="settings-panel-announcements" className="settings-card settings-section" aria-labelledby="settings-title-announcements">
    <div className="settings-card-head"><div><h2 id="settings-title-announcements" tabIndex={-1}>Announcements</h2><p>Send a message to users on this server.</p></div></div>
    <form className="announcement-form" onSubmit={event=>{event.preventDefault();setFeedback('');send.mutate();}}>
      <h3 className="announcement-compose-title"><Megaphone aria-hidden="true"/> New announcement</h3>
      <label>Title<Input aria-label="Announcement title" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)} disabled={send.isPending}/></label>
      <label>Message<textarea aria-label="Announcement message" maxLength={4000} value={body} onChange={event=>setBody(event.target.value)} disabled={send.isPending}/></label>
      <Select label="Announcement recipients" value={audience} options={[{value:'all',label:'All current enabled users'},{value:'selected',label:'Selected users'}]} onChange={setAudience}/>
      {audience==='selected'&&<fieldset className="announcement-recipients"><legend>Recipients</legend>{users.data?.filter(user=>user.enabled).map(user=><label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} disabled={send.isPending} onChange={event=>setSelected(values=>event.target.checked?[...values,user.id]:values.filter(id=>id!==user.id))}/>{user.displayName} (@{user.username})</label>)}</fieldset>}
      {users.error&&audience==='selected'&&<p className="error-copy" role="alert">Could not load users. <button type="button" onClick={()=>void users.refetch()}>Try again</button></p>}
      <div className="announcement-compose-footer"><span>{audience==='all'?'All current enabled users':`${selected.length} selected ${selected.length===1?'user':'users'}`}</span><Button type="submit" isPending={send.isPending} isDisabled={!title.trim()||!body.trim()||send.isPending||audience==='selected'&&!selected.length}><PaperPlaneTilt/> Send announcement</Button></div>
      {send.error&&<p className="error-copy" role="alert">{send.error.message}</p>}
      {feedback&&<p className="account-feedback" role="status">{feedback}</p>}
      <details className="announcement-delivery"><summary>Delivery details</summary><p>Messages appear in Virelo, usually within 30 seconds. No email or OS push is sent. They expire after 90 days, with up to 200 retained. New accounts do not receive earlier messages. Per-user read receipts are not shown to administrators.</p></details>
    </form>
    <div className="announcement-sent"><div className="announcement-history-heading"><h3><Megaphone aria-hidden="true"/> Sent announcements</h3>{sent.data&&<span>{sent.data.length} sent</span>}</div>
      {sent.isPending&&<p role="status">Loading announcements…</p>}
      {sent.error&&<p className="error-copy" role="alert">Could not load announcements. <button onClick={()=>void sent.refetch()}>Try again</button></p>}
      {sent.data?.length===0&&<div className="notification-empty"><Megaphone aria-hidden="true"/><h3>No announcements sent.</h3><p>Sent messages will appear here. You can withdraw them at any time.</p></div>}
      <div className="notification-list">{sent.data?.map(item=><NotificationCard item={item} key={item.id}>
        <span className="announcement-recipient-count"><Users aria-hidden="true"/>{item.recipients} {item.recipients===1?'recipient':'recipients'}</span>
        <div className="announcement-withdraw" role="group" aria-label={'Actions for '+item.title}><ConfirmationDialog triggerLabel="Withdraw" title="Withdraw this announcement?" confirmLabel="Withdraw" onConfirm={async()=>{await api.withdrawAnnouncement(item.id);await client.invalidateQueries({queryKey:['announcements']});await client.invalidateQueries({queryKey:['notifications']});}}><p>Remove this announcement from every inbox. Users may already have read or copied it.</p></ConfirmationDialog></div>
      </NotificationCard>)}</div>
    </div>
  </section>;
}
