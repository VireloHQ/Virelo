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
const time=(value:number)=>new Date(value).toLocaleString();

export function AdminSettings() {
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
    <div className="settings-card-head"><div><h2 id="settings-title-admin" tabIndex={-1}>Admin</h2><p>Server-wide security and monitoring. These settings apply to every account.</p></div></div>
    <div className="admin-setting-group"><h3><ShieldCheck aria-hidden="true"/> Administrator network access</h3>
      {security.data&&<AccountToggle title="Administrators can only access from localhost" checked={security.data.adminLocalOnly} disabled={!security.data.localAccess||access.isPending} onChange={value=>access.mutate(value)} description="Block administrator accounts outside this PC, including existing sessions. Regular users can still connect over the network."/>}
      <p className="account-notice">Change this option on the server PC using localhost. A local proxy or tunnel may hide the original connection; review the security guide before using one.</p>
      {security.error&&<p className="error-copy" role="alert">Could not load network access settings. <button onClick={()=>void security.refetch()}>Try again</button></p>}
      {access.error&&<p className="error-copy" role="alert">{access.error.message}</p>}
      {access.isSuccess&&<p className="account-feedback" role="status">Network access updated. Other administrator sessions have been signed out.</p>}
    </div>
    <div className="admin-setting-group"><h3><Eye aria-hidden="true"/> Activity monitoring</h3>
      {policy&&<>
        <AccountToggle title="Monitor activity" checked={policy.enabled} disabled={save.isPending} onChange={enabled=>setDraft({...policy,enabled})} description="Show online status and playback. Record successful sign-ins, playback changes, account/library operations, favorites and playlist changes."/>
        <div className="admin-retention"><div><strong>Keep activity logs</strong><p>Old records are removed automatically. At most 10,000 events are retained.</p></div>
          <Select label="Activity retention" value={String(policy.retentionDays)} options={[7,30,90].map(days=>({value:String(days),label:days+' days'}))} onChange={value=>setDraft({...policy,retentionDays:Number(value)})}/></div>
        <p className="account-notice">Users see a monitoring notice before sign-in and while using this server. Recording starts only after their session acknowledges the current notice. Changing this policy requires a new acknowledgement. Older clients without this notice are not monitored.</p>
        <p className="account-notice">Monitoring is off by default. Passwords, session tokens, IP addresses, full file paths, searches and page-by-page browsing are not logged. Disabling monitoring stops new collection; existing logs remain until expiry or explicit deletion.</p>
        <Button isPending={save.isPending} isDisabled={!draft||save.isPending} onPress={()=>save.mutate()}>Save monitoring settings</Button>
      </>}
      {monitoring.error&&<p className="error-copy" role="alert">Could not load monitoring settings. <button onClick={()=>void monitoring.refetch()}>Try again</button></p>}
      {save.error&&<p className="error-copy" role="alert">{save.error.message} <button onClick={()=>{setDraft(null);void monitoring.refetch();}}>Reload settings</button></p>}
      {save.isSuccess&&!draft&&<p className="account-feedback" role="status">Monitoring settings saved.</p>}
    </div>
  </section>;
}

export function ActivityView({userId}:{userId?:number}) {
  const [filter,setFilter]=useState('all'),[cursors,setCursors]=useState<number[]>([]);
  const selected=userId??(filter==='all'?undefined:Number(filter)),before=cursors.at(-1);
  const users=useQuery({queryKey:['accounts'],queryFn:api.accounts,enabled:userId===undefined});
  const activity=useQuery({queryKey:['account-activity',selected,before],queryFn:()=>api.activity({userId:selected,before}),refetchInterval:10_000,staleTime:0});
  const client=useQueryClient();
  const clear=useMutation({mutationFn:api.clearActivity,onSuccess:async()=>{setCursors([]);await client.invalidateQueries({queryKey:['account-activity']});await client.invalidateQueries({queryKey:['account-data']});}});
  const online=activity.data?.active.filter(entry=>selected===undefined||entry.userId===selected)??[];
  return <section className="account-activity" aria-label="Account activity">
    <div className="admin-section-heading"><h3><Eye aria-hidden="true"/> {userId?'User activity':'Overview'}</h3><Button variant="ghost" isPending={activity.isFetching} onPress={()=>void activity.refetch()}><ArrowClockwise aria-hidden="true"/> Refresh</Button></div>
    {activity.error&&<p className="error-copy" role="alert">{activity.error.message}</p>}
    {activity.data&&!activity.data.policy.enabled&&<p className="admin-information">Monitoring is off. No new activity is being collected. <a href="/settings#admin">Manage monitoring in Admin</a>.</p>}
    {activity.data?.policy.enabled&&<><h4>Online now</h4>
      <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th scope="col">User</th><th scope="col">Status</th><th scope="col">Video</th><th scope="col">Last seen</th></tr></thead><tbody>
        {online.map(entry=><tr key={entry.id}><th scope="row">{entry.displayName}<small>@{entry.username}</small></th><td>{entry.state==='playing'?'Playing':entry.state==='paused'?'Paused':'Online'}</td><td>{entry.title??'—'}{entry.mediaId!==null&&<small>{Math.floor(entry.position/60)}:{String(Math.floor(entry.position%60)).padStart(2,'0')}</small>}</td><td>{time(entry.lastSeen)}</td></tr>)}
        {online.length===0&&<tr><td colSpan={4}>No recently active sessions. A session is shown for up to 90 seconds after its last update.</td></tr>}
      </tbody></table></div></>}
    <div className="admin-section-heading"><h4>Activity log</h4>{userId===undefined&&<Select label="Filter activity by user" value={filter} options={[{value:'all',label:'All users'},...(users.data??[]).map(user=>({value:String(user.id),label:user.displayName}))]} onChange={value=>{setFilter(value);setCursors([]);}}/>}</div>
    <div className="admin-table-scroll"><table className="admin-table activity-events"><thead><tr><th scope="col">Time</th><th scope="col">User</th><th scope="col">Action</th><th scope="col">Details</th></tr></thead><tbody>
      {activity.data?.events.map(event=><tr key={event.id}><td>{time(event.createdAt)}</td><td>{event.actorName}</td><td>{actionNames[event.action]??'Account activity'}</td><td>{event.title??event.targetName??(event.targetId?'Account #'+event.targetId:'—')}</td></tr>)}
      {activity.data?.events.length===0&&<tr><td colSpan={4}>No recorded activity.</td></tr>}
    </tbody></table></div>
    <div className="admin-pagination"><Button variant="secondary" isDisabled={!cursors.length} onPress={()=>setCursors(value=>value.slice(0,-1))}>Newer</Button><Button variant="secondary" isDisabled={!activity.data?.nextBefore} onPress={()=>setCursors(value=>[...value,activity.data!.nextBefore!])}>Older</Button></div>
    {userId===undefined&&<div className="admin-destructive"><ConfirmationDialog triggerLabel="Clear activity log" title="Clear the activity log?" confirmLabel="Clear log" onConfirm={async()=>{await clear.mutateAsync();}}><p>Delete the retained activity events for all users. This cannot be undone. When monitoring is on, the clearing action is recorded as a new event.</p><p>Accounts, favorites, watch history, playlists, libraries and original videos are not changed.</p></ConfirmationDialog></div>}
    <p className="account-notice">Events are server-observed operations and client-reported playback state, not a tamper-proof security audit. Video titles follow the administrator's current library access.</p>
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
  const session=useAccount(),client=useQueryClient();
  const [message,setMessage]=useState('');
  const data=useQuery({queryKey:['account-data',user.id],queryFn:()=>api.accountData(user.id),staleTime:0});
  const clear=async(category:AccountDataCategory)=>{
    await api.clearAccountData(user.id,category);
    await client.invalidateQueries({queryKey:['account-data',user.id]});await client.invalidateQueries({queryKey:['account-activity']});
    if(user.id===session?.user.id){await client.invalidateQueries({predicate:query=>['home','media','favorites','playlists','playlist','watch-queue','shorts'].includes(String(query.queryKey[0]))});if(category==='sessions')await session.refresh();}
    setMessage(category==='sessions'?'All devices for this account have been signed out.':category==='activity'?'Activity cleared. While monitoring is on, the clearing action remains as a new event.':categories.find(item=>item.key===category)!.label+' cleared for '+user.displayName+'.');
  };
  return <div className="managed-user-data"><h3><Database aria-hidden="true"/> User data</h3><p className="admin-information">These controls affect only {user.displayName}'s Virelo data. Original videos, shared libraries, metadata, thumbnails and other users are never removed.</p>
    {message&&<p className="account-feedback" role="status">{message}</p>}
    {data.error&&<p role="alert" className="error-copy">Could not load user data. <button onClick={()=>void data.refetch()}>Try again</button></p>}
    {data.isPending&&<p role="status">Loading user data…</p>}
    {data.data&&<div className="managed-data-list">{categories.map(category=><div key={category.key}><category.icon aria-hidden="true"/><div><strong>{category.label}</strong><p>{category.description}{category.key==='playlists'?' · '+data.data!.playlistItems+' entries':''}</p></div><span className="managed-data-count">{data.data![category.key==='activity'?'activityEvents':category.key]}</span>
      <ConfirmationDialog triggerLabel={category.key==='sessions'?'Sign out devices':'Clear '+category.label.toLowerCase()} title={category.key==='sessions'?'Sign out '+user.displayName+' on all devices?':'Clear '+user.displayName+"'s "+category.label.toLowerCase()+'?'} confirmLabel={category.key==='sessions'?'Sign out devices':'Clear data'} onConfirm={()=>clear(category.key)}>
        <p>{category.key==='sessions'?'All sessions for this account will be revoked. Buffered or downloaded content cannot be recalled.':'Delete only this account’s '+category.label.toLowerCase()+'. This cannot be undone.'}</p><p>Original videos and other users' favorites, history and playlists are not changed.{category.key==='activity'?' Shared log entries involving this user are removed from the global log too. The clearing action may remain.':''}{category.key==='sessions'&&user.id===session?.user.id?' You will also be signed out.':''}</p>
      </ConfirmationDialog>
    </div>)}</div>}
  </div>;
}
