import { Trans } from '../i18n/Trans';
import { t, useLocale, getLocale } from '../i18n';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@heroui/react';
import { ArrowClockwise, ClockCounterClockwise, Database, Eye, Heart, ListBullets, ShieldCheck, SignOut } from '@phosphor-icons/react';
import { api } from '../api';
import { useAccount } from './AccountSession';
import { AccountToggle } from './AccountToggle';
import { ConfirmationDialog } from './ConfirmationDialog';
import { Select } from './Select';
import type { Account, AccountDataCategory, ActivityPolicy } from '../../../src/auth-types';
import './AccountAdministration.css';

const actionNames:Record<string,string>={
  'auth.login':'Signed in','auth.logout':'Signed out','account.profile_updated':'Changed account details',
  'account.created':'Created a user','account.updated':'Updated a user','account.deleted':'Deleted a user',
  'playback.opened':'Opened a video','playback.started':'Started playback','playback.resumed':'Resumed playback',
  'playback.paused':'Paused playback','playback.stopped':'Stopped playback',
  'library.added':'Saved a library','library.removed':'Removed a library','library.scanned':'Requested a scan',
  'server.settings_updated':'Changed server settings','server.cache_cleared':'Cleared unused playback cache','server.admin_access_updated':'Changed administrator network access',
  'metadata.cleared_all':'Cleared shared metadata','metadata.cleared':'Cleared video metadata','metadata.refreshed':'Refreshed video metadata',
  'favorites.updated':'Changed a favorite','playlist.created':'Created a playlist','playlist.updated':'Updated a playlist','playlist.deleted':'Deleted a playlist',
  'monitoring.enabled':'Enabled activity monitoring','monitoring.updated':'Changed activity monitoring','activity.cleared':'Cleared the activity log',
  'data.history_cleared':'Cleared watch history','data.favorites_cleared':'Cleared favorites','data.playlists_cleared':'Cleared playlists','data.sessions_cleared':'Signed out all user sessions','data.activity_cleared':'Cleared user activity'
};
const time=(value:number)=>new Date(value).toLocaleString(getLocale());

export function AdminSettings() {
  useLocale();
  const session=useAccount(),client=useQueryClient();
  const security=useQuery({queryKey:['account-security'],queryFn:api.accountSecurity});
  const monitoring=useQuery({queryKey:['account-monitoring'],queryFn:api.monitoring});
  const [draft,setDraft]=useState<ActivityPolicy|null>(null);
  const policy=draft??monitoring.data;
  const save=useMutation({mutationFn:()=>api.saveMonitoring(policy!),onSuccess:async value=>{
    setDraft(null);client.setQueryData(['account-monitoring'],value);await client.invalidateQueries({queryKey:['account-activity']});await session?.refresh();
  }});
  const access=useMutation({mutationFn:api.saveAccountSecurity,onSuccess:async()=>{await client.invalidateQueries({queryKey:['account-security']});await session?.refresh();}});
  return <section id="settings-panel-admin" className="settings-card settings-section" aria-labelledby="settings-title-admin">
    <div className="settings-card-head"><div><h2 id="settings-title-admin" tabIndex={-1}>{t("Admin")}</h2><p>{t("Server-wide security and monitoring. These settings apply to every account.")}</p></div></div>
    <div className="admin-setting-group"><h3><ShieldCheck aria-hidden="true"/> {t("Administrator network access")}</h3>
      {security.data&&<AccountToggle title={t("Administrators can only access from localhost")} checked={security.data.adminLocalOnly} disabled={!security.data.localAccess||access.isPending} onChange={value=>access.mutate(value)} description={t("Block administrator accounts outside this PC, including existing sessions. Regular users can still connect over the network.")}/>}
      <p className="account-notice">{t("Change this option on the server PC using localhost. A local proxy or tunnel may hide the original connection; review the security guide before using one.")}</p>
      {security.error&&<p className="error-copy" role="alert"><Trans message="Could not load network access settings. {value0}" values={{value0:<button onClick={()=>void security.refetch()}>{t("Try again")}</button>}}/></p>}
      {access.error&&<p className="error-copy" role="alert">{t(access.error.message)}</p>}
      {access.isSuccess&&<p className="account-feedback" role="status">{t("Network access updated. Other administrator sessions have been signed out.")}</p>}
    </div>
    <div className="admin-setting-group"><h3><Eye aria-hidden="true"/> {t("Activity monitoring")}</h3>
      {policy&&<>
        <AccountToggle title={t("Monitor activity")} checked={policy.enabled} disabled={save.isPending} onChange={enabled=>setDraft({...policy,enabled})} description={t("Show online status and playback. Record successful sign-ins, playback changes, account/library operations, favorites and playlist changes.")}/>
        <div className="admin-retention"><div><strong>{t("Keep activity logs")}</strong><p>{t("Old records are removed automatically. At most 10,000 events are retained.")}</p></div>
          <Select label={t("Activity retention")} value={String(policy.retentionDays)} options={[7,30,90].map(days=>({value:String(days),label:t('{count} days',{count:days})}))} onChange={value=>setDraft({...policy,retentionDays:Number(value)})}/></div>
        <p className="account-notice">{t("Users see a monitoring notice before sign-in and while using this server. Recording starts only after their session acknowledges the current notice. Changing this policy requires a new acknowledgement. Older clients without this notice are not monitored.")}</p>
        <p className="account-notice">{t("Monitoring is off by default. Passwords, session tokens, IP addresses, full file paths, searches and page-by-page browsing are not logged. Disabling monitoring stops new collection; existing logs remain until expiry or explicit deletion.")}</p>
        <Button isPending={save.isPending} isDisabled={!draft||save.isPending} onPress={()=>save.mutate()}>{t("Save monitoring settings")}</Button>
      </>}
      {monitoring.error&&<p className="error-copy" role="alert"><Trans message="Could not load monitoring settings. {value0}" values={{value0:<button onClick={()=>void monitoring.refetch()}>{t("Try again")}</button>}}/></p>}
      {save.error&&<p className="error-copy" role="alert">{t(save.error.message)} <button onClick={()=>{setDraft(null);void monitoring.refetch();}}>{t("Reload settings")}</button></p>}
      {save.isSuccess&&!draft&&<p className="account-feedback" role="status">{t("Monitoring settings saved.")}</p>}
    </div>
  </section>;
}

export function ActivityView({userId}:{userId?:number}) {
  useLocale();
  const [filter,setFilter]=useState('all'),[cursors,setCursors]=useState<number[]>([]);
  const selected=userId??(filter==='all'?undefined:Number(filter)),before=cursors.at(-1);
  const users=useQuery({queryKey:['accounts'],queryFn:api.accounts,enabled:userId===undefined});
  const activity=useQuery({queryKey:['account-activity',selected,before],queryFn:()=>api.activity({userId:selected,before}),refetchInterval:10_000,staleTime:0});
  const client=useQueryClient();
  const clear=useMutation({mutationFn:api.clearActivity,onSuccess:async()=>{setCursors([]);await client.invalidateQueries({queryKey:['account-activity']});await client.invalidateQueries({queryKey:['account-data']});}});
  const online=activity.data?.active.filter(entry=>selected===undefined||entry.userId===selected)??[];
  return <section className="account-activity" aria-label={t("Account activity")}>
    <div className="admin-section-heading"><h3><Eye aria-hidden="true"/> {userId?t("User activity"):t("Overview")}</h3><Button variant="ghost" isPending={activity.isFetching} onPress={()=>void activity.refetch()}><ArrowClockwise aria-hidden="true"/> {t("Refresh")}</Button></div>
    {activity.error&&<p className="error-copy" role="alert">{t(activity.error.message)}</p>}
    {activity.data&&!activity.data.policy.enabled&&<p className="admin-information"><Trans message="Monitoring is off. No new activity is being collected. {value0}." values={{value0:<a href="/settings#admin">{t("Manage monitoring in Admin")}</a>}}/></p>}
    {activity.data?.policy.enabled&&<><h4>{t("Online now")}</h4>
      <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th scope="col">{t("User")}</th><th scope="col">{t("Status")}</th><th scope="col">{t("Video")}</th><th scope="col">{t("Last seen")}</th></tr></thead><tbody>
        {online.map(entry=><tr key={entry.id}><th scope="row">{entry.displayName}<small>@{entry.username}</small></th><td>{entry.state==='playing'?t("Playing"):entry.state==='paused'?t("Paused"):t("Online")}</td><td>{entry.title??'—'}{entry.mediaId!==null&&<small>{Math.floor(entry.position/60)}:{String(Math.floor(entry.position%60)).padStart(2,'0')}</small>}</td><td>{time(entry.lastSeen)}</td></tr>)}
        {online.length===0&&<tr><td colSpan={4}>{t("No recently active sessions. A session is shown for up to 90 seconds after its last update.")}</td></tr>}
      </tbody></table></div></>}
    <div className="admin-section-heading"><h4>{t("Activity log")}</h4>{userId===undefined&&<Select label={t("Filter activity by user")} value={filter} options={[{value:'all',label:t('All users')},...(users.data??[]).map(user=>({value:String(user.id),label:user.displayName}))]} onChange={value=>{setFilter(value);setCursors([]);}}/>}</div>
    <div className="admin-table-scroll"><table className="admin-table activity-events"><thead><tr><th scope="col">{t("Time")}</th><th scope="col">{t("User")}</th><th scope="col">{t("Action")}</th><th scope="col">{t("Details")}</th></tr></thead><tbody>
      {activity.data?.events.map(event=><tr key={event.id}><td>{time(event.createdAt)}</td><td>{event.actorName}</td><td>{t(actionNames[event.action]??'Account activity')}</td><td>{event.title??event.targetName??(event.targetId?t("Account #{value0}", { value0: event.targetId }):'—')}</td></tr>)}
      {activity.data?.events.length===0&&<tr><td colSpan={4}>{t("No recorded activity.")}</td></tr>}
    </tbody></table></div>
    <div className="admin-pagination"><Button variant="secondary" isDisabled={!cursors.length} onPress={()=>setCursors(value=>value.slice(0,-1))}>{t("Newer")}</Button><Button variant="secondary" isDisabled={!activity.data?.nextBefore} onPress={()=>setCursors(value=>[...value,activity.data!.nextBefore!])}>{t("Older")}</Button></div>
    {userId===undefined&&<div className="admin-destructive"><ConfirmationDialog triggerLabel={t("Clear activity log")} title={t("Clear the activity log?")} confirmLabel={t("Clear log")} onConfirm={async()=>{await clear.mutateAsync();}}><p>{t("Delete the retained activity events for all users. This cannot be undone. When monitoring is on, the clearing action is recorded as a new event.")}</p><p>{t("Accounts, favorites, watch history, playlists, libraries and original videos are not changed.")}</p></ConfirmationDialog></div>}
    <p className="account-notice">{t("Events are server-observed operations and client-reported playback state, not a tamper-proof security audit. Video titles follow the administrator's current library access.")}</p>
  </section>;
}

const categories:Array<{key:AccountDataCategory;label:string;description:string;icon:typeof Heart}>=[
  {key:'history',label:'Watch history',description:'Resume positions and watched status',icon:ClockCounterClockwise},
  {key:'favorites',label:'Favorites',description:'Videos saved as favorites',icon:Heart},
  {key:'playlists',label:'Playlists',description:'Named playlists and their ordering',icon:ListBullets},
  {key:'sessions',label:'Signed-in sessions',description:'Sign this user out on every device',icon:SignOut},
  {key:'activity',label:'Activity log',description:'Retained events involving this user',icon:Eye}
];
export function ManagedUserData({user}:{user:Account}) {
  useLocale();
  const session=useAccount(),client=useQueryClient();
  const [message,setMessage]=useState('');
  const data=useQuery({queryKey:['account-data',user.id],queryFn:()=>api.accountData(user.id),staleTime:0});
  const clear=async(category:AccountDataCategory)=>{
    await api.clearAccountData(user.id,category);
    await client.invalidateQueries({queryKey:['account-data',user.id]});await client.invalidateQueries({queryKey:['account-activity']});
    if(user.id===session?.user.id){await client.invalidateQueries({predicate:query=>['home','media','favorites','playlists','playlist','watch-queue','shorts'].includes(String(query.queryKey[0]))});if(category==='sessions')await session.refresh();}
    setMessage(category==='sessions'?'All devices for this account have been signed out.':category==='activity'?'Activity cleared. While monitoring is on, the clearing action remains as a new event.':t('Cleared {category} for {name}.',{category:t(categories.find(item=>item.key===category)!.label),name:user.displayName}));
  };
  return <div className="managed-user-data"><h3><Database aria-hidden="true"/> {t("User data")}</h3><p className="admin-information"><Trans message="These controls affect only {value0}'s Virelo data. Original videos, shared libraries, metadata, thumbnails and other users are never removed." values={{value0:user.displayName}}/></p>
    {message&&<p className="account-feedback" role="status">{t(message)}</p>}
    {data.error&&<p role="alert" className="error-copy"><Trans message="Could not load user data. {value0}" values={{value0:<button onClick={()=>void data.refetch()}>{t("Try again")}</button>}}/></p>}
    {data.isPending&&<p role="status">{t("Loading user data…")}</p>}
    {data.data&&<div className="managed-data-list">{categories.map(category=><div key={category.key}><category.icon aria-hidden="true"/><div><strong>{t(category.label)}</strong><p>{t(category.description)}{category.key==='playlists'?' · '+t('{count} entries',{count:data.data!.playlistItems}):''}</p></div><span className="managed-data-count">{data.data![category.key==='activity'?'activityEvents':category.key]}</span>
      <ConfirmationDialog triggerLabel={category.key==='sessions'?t("Sign out devices"):t("Clear {value0}", { value0: t(category.label) })} title={category.key==='sessions'?t("Sign out {value0} on all devices?", { value0: user.displayName }):t("Clear {value0}'s {value1}?", { value0: user.displayName, value1: t(category.label) })} confirmLabel={category.key==='sessions'?t("Sign out devices"):t("Clear data")} onConfirm={()=>clear(category.key)}>
        <p>{category.key==='sessions'?t("All sessions for this account will be revoked. Buffered or downloaded content cannot be recalled."):t("Delete only this account’s {value0}. This cannot be undone.", { value0: t(category.label) })}</p><p>{t("Original videos and other users' favorites, history and playlists are not changed.")}{category.key==='activity'?t(" Shared log entries involving this user are removed from the global log too. The clearing action may remain."):''}{category.key==='sessions'&&user.id===session?.user.id?t(" You will also be signed out."):''}</p>
      </ConfirmationDialog>
    </div>)}</div>}
  </div>;
}
