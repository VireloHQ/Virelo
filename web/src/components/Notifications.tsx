import { Trans } from '../i18n/Trans';
import { t, useLocale, getLocale } from '../i18n';
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


function NotificationCard({item,unread=false,children}:{item:Pick<Announcement,'title'|'body'|'createdAt'>;unread?:boolean;children:ReactNode}){
  useLocale();
  return <article className="notification-item" data-unread={unread} aria-label={item.title}>
    <header className="notification-item-heading">
      <div className="notification-item-title"><h3>{item.title}</h3>{unread&&<span className="notification-unread">{t("Unread")}</span>}</div>
      <time dateTime={new Date(item.createdAt).toISOString()}>{new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(item.createdAt)}</time>
    </header>
    <p className="notification-message">{item.body}</p>
    <footer className="notification-item-footer">{children}</footer>
  </article>;
}

export function NotificationBell(){
  useLocale();
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
    <Button className="icon-button communication-trigger" isIconOnly variant="ghost" aria-label={unread?t("Notifications, {value0} unread", { value0: unread }):t("Notifications")} onPress={()=>{setCursors([]);setOpen(true);}}><Bell size={22}/>{unread>0&&<span aria-hidden="true" className="notification-badge">{unread>99?'99+':unread}</span>}</Button>
    <Modal.Backdrop className="virelo-confirm-backdrop" isDismissable>
      <Modal.Container className="virelo-confirm-container notification-container" placement="center" size="md" scroll="inside">
        <Modal.Dialog className="virelo-confirm-dialog notification-dialog" aria-label={t("Notifications")}>
          <Modal.Header className="virelo-confirm-header notification-heading"><div className="notification-heading-title"><Bell aria-hidden="true"/><Modal.Heading className="virelo-confirm-title">{t("Notifications")}</Modal.Heading></div><Button ref={closeButton} className="notification-close" isIconOnly variant="ghost" aria-label={t("Close notifications")} onPress={()=>setOpen(false)}><X/></Button></Modal.Header>
          <div className="notification-toolbar"><span className="notification-unread-count" role="status">{inbox.data&&(unread?t("{value0} unread", { value0: unread }):t("No unread notifications"))}</span><Button className="notification-bulk-action" variant="ghost" isDisabled={!unread||read.isPending} onPress={()=>read.mutate(undefined)}>{t("Mark all as read")}</Button></div>
          <Modal.Body className="virelo-confirm-body notification-body">
            {inbox.isPending&&<p role="status">{t("Loading notifications…")}</p>}
            {inbox.error&&<p className="error-copy" role="alert"><Trans message="Could not load notifications. {value0}" values={{value0:<button onClick={()=>void inbox.refetch()}>{t("Try again")}</button>}}/></p>}
            {read.error&&<p className="error-copy" role="alert">{t(read.error.message)}</p>}
            <div className="notification-list">{inbox.data?.items?.map(item=><NotificationCard item={item} unread={item.readAt===null} key={item.id}>
              {item.readAt===null?<Button className="notification-read-action" variant="ghost" isDisabled={read.isPending} onPress={()=>read.mutate(item.id)}><Check aria-hidden="true"/> {t("Mark as read")}</Button>:<span className="notification-read-status"><CheckCircle aria-hidden="true"/> {t("Read")}</span>}
            </NotificationCard>)}</div>
            {inbox.data?.items?.length===0&&<div className="notification-empty"><Bell aria-hidden="true"/><h3>{t("No notifications yet")}</h3><p>{t("Messages from your server administrator will appear here.")}</p></div>}
            {(cursors.length>0||inbox.data?.nextBefore)&&<div className="notification-pagination"><Button variant="secondary" isDisabled={!cursors.length} onPress={()=>setCursors(values=>values.slice(0,-1))}>{t("Newer")}</Button><Button variant="secondary" isDisabled={!inbox.data?.nextBefore} onPress={()=>setCursors(values=>[...values,inbox.data!.nextBefore!])}>{t("Older")}</Button></div>}
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  </Modal>;
}

export function AnnouncementSettings(){
  useLocale();
  const client=useQueryClient();
  const [title,setTitle]=useState(''),[body,setBody]=useState(''),[audience,setAudience]=useState('all'),[selected,setSelected]=useState<number[]>([]),[feedback,setFeedback]=useState('');
  const users=useQuery({queryKey:['accounts'],queryFn:api.accounts});
  const sent=useQuery({queryKey:['announcements'],queryFn:api.announcements});
  const send=useMutation({mutationFn:()=>api.sendAnnouncement({title,body,...(audience==='selected'?{userIds:selected}:{})}),onSuccess:async result=>{
    setTitle('');setBody('');setFeedback(t('Sent to {count} users.',{count:result.recipients}));
    await client.invalidateQueries({queryKey:['announcements']});await client.invalidateQueries({queryKey:['notifications']});
  }});
  return <section id="settings-panel-announcements" className="settings-card settings-section" aria-labelledby="settings-title-announcements">
    <div className="settings-card-head"><div><h2 id="settings-title-announcements" tabIndex={-1}>{t("Announcements")}</h2><p>{t("Send a message to users on this server.")}</p></div></div>
    <form className="announcement-form admin-setting-group" onSubmit={event=>{event.preventDefault();setFeedback('');send.mutate();}}>
      <h3 className="announcement-compose-title"><Megaphone aria-hidden="true"/> {t("New announcement")}</h3>
      <label>{t("Title")}<Input aria-label={t("Announcement title")} name="title" autoComplete="off" maxLength={120} value={title} onChange={event=>setTitle(event.target.value)} disabled={send.isPending}/></label>
      <label>{t("Message")}<textarea aria-label={t("Announcement message")} name="message" autoComplete="off" maxLength={4000} value={body} onChange={event=>setBody(event.target.value)} disabled={send.isPending}/></label>
      <Select label={t("Announcement recipients")} value={audience} options={[{value:'all',label:t('All current enabled users')},{value:'selected',label:t('Selected users')}]} onChange={setAudience}/>
      {audience==='selected'&&<fieldset className="announcement-recipients"><legend>{t("Recipients")}</legend>{users.data?.filter(user=>user.enabled).map(user=><label key={user.id}><input type="checkbox" checked={selected.includes(user.id)} disabled={send.isPending} onChange={event=>setSelected(values=>event.target.checked?[...values,user.id]:values.filter(id=>id!==user.id))}/>{user.displayName} (@{user.username})</label>)}</fieldset>}
      {users.error&&audience==='selected'&&<p className="error-copy" role="alert"><Trans message="Could not load users. {value0}" values={{value0:<button type="button" onClick={()=>void users.refetch()}>{t("Try again")}</button>}}/></p>}
      <div className="announcement-compose-footer"><Button type="submit" isPending={send.isPending} isDisabled={!title.trim()||!body.trim()||send.isPending||audience==='selected'&&!selected.length}><PaperPlaneTilt/> {t("Send announcement")}</Button></div>
      {send.error&&<p className="error-copy" role="alert">{t(send.error.message)}</p>}
      {feedback&&<p className="account-feedback" role="status">{t(feedback)}</p>}
    </form>
    <div className="announcement-sent admin-setting-group"><div className="announcement-history-heading"><h3><Megaphone aria-hidden="true"/> {t("Sent announcements")}</h3>{sent.data&&<span><Trans message="{value0} sent" values={{value0:sent.data.length}}/></span>}</div>
      {sent.isPending&&<p role="status">{t("Loading announcements…")}</p>}
      {sent.error&&<p className="error-copy" role="alert"><Trans message="Could not load announcements. {value0}" values={{value0:<button onClick={()=>void sent.refetch()}>{t("Try again")}</button>}}/></p>}
      {sent.data?.length===0&&<div className="notification-empty"><Megaphone aria-hidden="true"/><h3>{t("No announcements sent.")}</h3><p>{t("Sent messages will appear here. You can withdraw them at any time.")}</p></div>}
      <div className="notification-list">{sent.data?.map(item=><NotificationCard item={item} key={item.id}>
        <span className="announcement-recipient-count"><Users aria-hidden="true"/>{t('{count} recipients',{count:item.recipients})}</span>
        <div className="announcement-withdraw" role="group" aria-label={t("Actions for {value0}", { value0: item.title })}><ConfirmationDialog triggerLabel={t("Withdraw")} title={t("Withdraw this announcement?")} confirmLabel={t("Withdraw")} onConfirm={async()=>{await api.withdrawAnnouncement(item.id);await client.invalidateQueries({queryKey:['announcements']});await client.invalidateQueries({queryKey:['notifications']});}}><p>{t("Remove this announcement from every inbox. Users may already have read or copied it.")}</p></ConfirmationDialog></div>
      </NotificationCard>)}</div>
    </div>
  </section>;
}
