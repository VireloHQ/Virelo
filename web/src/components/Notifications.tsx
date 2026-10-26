import { useState } from 'react';
import { Button, Input, Modal } from '@heroui/react';
import { Bell, Check, Megaphone, PaperPlaneTilt, X } from '@phosphor-icons/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import { Select } from './Select';
import { ConfirmationDialog } from './ConfirmationDialog';
import './Communication.css';
import './ConfirmationDialog.css';

export function NotificationBell(){
  const [open,setOpen]=useState(false),[cursors,setCursors]=useState<number[]>([]);
  const client=useQueryClient(),before=cursors.at(-1);
  const inbox=useQuery({queryKey:['notifications',before],queryFn:()=>api.notifications(before),refetchInterval:30000,refetchOnWindowFocus:true});
  const read=useMutation({mutationFn:api.readNotifications,onSuccess:()=>client.invalidateQueries({queryKey:['notifications']})});
  const unread=inbox.data?.unread??0;
  return <Modal isOpen={open} onOpenChange={setOpen}>
    <Button className="icon-button communication-trigger" isIconOnly variant="ghost" aria-label={unread?`Notifications, ${unread} unread`:'Notifications'} onPress={()=>{setCursors([]);setOpen(true);}}><Bell size={22}/>{unread>0&&<span aria-hidden="true" className="notification-badge">{unread>99?'99+':unread}</span>}</Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" isDismissable>
      <Modal.Container className="virelo-confirm-container" placement="center" size="sm" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog" aria-label="Notifications">
          <Modal.Header className="virelo-confirm-header communication-heading"><Modal.Heading className="virelo-confirm-title">Notifications</Modal.Heading><Button isIconOnly variant="ghost" aria-label="Close notifications" onPress={()=>setOpen(false)}><X/></Button></Modal.Header>
          <Modal.Body className="virelo-confirm-body communication-body">
            <p className="communication-help">Messages from this server only. Read status is saved to your account.</p>
            {inbox.isPending&&<p role="status">Loading notifications…</p>}
            {inbox.error&&<p className="error-copy" role="alert">Could not load notifications. <button onClick={()=>void inbox.refetch()}>Try again</button></p>}
            {read.error&&<p className="error-copy" role="alert">{read.error.message}</p>}
            <div className="notification-list">{inbox.data?.items?.map(item=><article className="notification-item" key={item.id}>
              <h3>{item.title}</h3><time dateTime={new Date(item.createdAt).toISOString()}>{new Date(item.createdAt).toLocaleString()}</time>
              <p className="notification-message">{item.body}</p>
              <div className="notification-actions">{item.readAt===null?<><span className="notification-unread">Unread</span><Button variant="secondary" isDisabled={read.isPending} onPress={()=>read.mutate(item.id)}><Check/> Mark as read</Button></>:<span>Read</span>}</div>
            </article>)}</div>
            {inbox.data?.items?.length===0&&<p>No notifications.</p>}
            {(cursors.length>0||inbox.data?.nextBefore)&&<div className="notification-actions"><Button variant="secondary" isDisabled={!cursors.length} onPress={()=>setCursors(values=>values.slice(0,-1))}>Newer</Button><Button variant="secondary" isDisabled={!inbox.data?.nextBefore} onPress={()=>setCursors(values=>[...values,inbox.data!.nextBefore!])}>Older</Button></div>}
          </Modal.Body>
          <Modal.Footer className="virelo-confirm-footer"><Button variant="secondary" isDisabled={!unread||read.isPending} onPress={()=>read.mutate(undefined)}>Mark all as read</Button><Button onPress={()=>setOpen(false)}>Done</Button></Modal.Footer>
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
    <div className="settings-card-head"><div><h2 id="settings-title-announcements" tabIndex={-1}>Announcements</h2><p>Send in-app messages to users of this server. No email, operating-system notification or external delivery service is used.</p></div></div>
    <form className="announcement-form" onSubmit={event=>{event.preventDefault();setFeedback('');send.mutate();}}>
      <label>Title<Input aria-label="Announcement title" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)} disabled={send.isPending}/></label>
      <label>Message<textarea aria-label="Announcement message" maxLength={4000} value={body} onChange={event=>setBody(event.target.value)} disabled={send.isPending}/></label>
      <Select label="Announcement recipients" value={audience} options={[{value:'all',label:'All current enabled users'},{value:'selected',label:'Selected users'}]} onChange={setAudience}/>
      {audience==='selected'&&<fieldset className="announcement-recipients"><legend>Recipients</legend>{users.data?.filter(user=>user.enabled).map(user=><label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} disabled={send.isPending} onChange={event=>setSelected(values=>event.target.checked?[...values,user.id]:values.filter(id=>id!==user.id))}/>{user.displayName} (@{user.username})</label>)}</fieldset>}
      {users.error&&audience==='selected'&&<p className="error-copy" role="alert">Could not load users. <button type="button" onClick={()=>void users.refetch()}>Try again</button></p>}
      <p className="account-notice">Recipients see new messages while using Virelo, usually within 30 seconds. Messages expire after 90 days. New accounts do not receive earlier announcements. Up to 200 announcements are retained; no per-user read receipts are exposed.</p>
      <div><Button type="submit" isPending={send.isPending} isDisabled={!title.trim()||!body.trim()||send.isPending||audience==='selected'&&!selected.length}><PaperPlaneTilt/> Send announcement</Button></div>
      {send.error&&<p className="error-copy" role="alert">{send.error.message}</p>}
      {feedback&&<p className="account-feedback" role="status">{feedback}</p>}
    </form>
    <div className="announcement-sent"><h3><Megaphone aria-hidden="true"/> Sent announcements</h3>
      {sent.isPending&&<p role="status">Loading announcements…</p>}
      {sent.error&&<p className="error-copy" role="alert">Could not load announcements. <button onClick={()=>void sent.refetch()}>Try again</button></p>}
      {sent.data?.length===0&&<p>No announcements sent.</p>}
      {sent.data?.map(item=><article className="notification-item" key={item.id}><h3>{item.title}</h3><time>{new Date(item.createdAt).toLocaleString()} · {item.recipients} recipients</time><p className="notification-message">{item.body}</p>
        <div className="notification-actions"><ConfirmationDialog triggerLabel="Withdraw" title="Withdraw this announcement?" confirmLabel="Withdraw" onConfirm={async()=>{await api.withdrawAnnouncement(item.id);await client.invalidateQueries({queryKey:['announcements']});await client.invalidateQueries({queryKey:['notifications']});}}><p>Remove this announcement from every inbox. Users may already have read or copied it.</p></ConfirmationDialog></div>
      </article>)}
    </div>
  </section>;
}
