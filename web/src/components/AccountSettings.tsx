import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Switch } from '@heroui/react';
import { api } from '../api';
import { useAccount } from './AccountSession';
import { ConfirmationDialog } from './ConfirmationDialog';
import type { Account, AccountPermissions } from '../../../src/auth-types';
import type { Library } from '../types';

export function AccountToggle({title,description,checked,onChange,disabled=false}: {
  title:string;description?:string;checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean
}) {
  return <div className="account-toggle"><div><strong>{title}</strong>{description&&<p>{description}</p>}</div>
    <Switch aria-label={title} isSelected={checked} isDisabled={disabled} onChange={onChange}><Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control></Switch.Content></Switch></div>;
}

export function AccountProfile() {
  const session = useAccount();
  const [username,setUsername] = useState(session?.user.username || ''), [displayName,setDisplayName] = useState(session?.user.displayName || '');
  const [currentPassword,setCurrentPassword] = useState(''), [password,setPassword] = useState(''), [confirmation,setConfirmation] = useState('');
  const [error,setError] = useState(''), [message,setMessage] = useState(''), [pending,setPending] = useState(false);
  const busy = useRef(false);
  if (!session) return null;
  const submit = async () => {
    if (busy.current) return;
    setError(''); setMessage('');
    if (password && password !== confirmation) {setError('The new passwords do not match.');return;}
    if (!currentPassword) {setError('Enter your current password to save changes.');return;}
    busy.current = true; setPending(true);
    try {
      await api.updateAccount({username,displayName,currentPassword,password:password||undefined});
      setCurrentPassword('');setPassword('');setConfirmation('');setMessage('Account updated. Other sessions have been signed out.');
      await session.refresh();
    } catch (error) {setError(error instanceof Error?error.message:'Could not update this account.');}
    finally {busy.current=false;setPending(false);}
  };
  return <section className="account-profile" aria-labelledby="settings-title-account">
    <div className="account-profile-header"><div><h2 id="settings-title-account" tabIndex={-1}>{session.user.displayName}</h2><p>{session.user.isAdmin?'Administrator':'User'} · @{session.user.username}</p></div>
      <Button variant="secondary" isDisabled={pending} onPress={()=>{setError('');void session.logout().catch(()=>setError('Could not sign out. Check the server connection and try again.'));}}>Sign out</Button></div>
    <form className="account-form" noValidate onSubmit={event=>{event.preventDefault();void submit();}}>
      <label htmlFor="account-name">Display name</label><Input id="account-name" autoComplete="nickname" value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={80} disabled={pending}/>
      <label htmlFor="account-username">Username</label><Input id="account-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event=>setUsername(event.target.value)} maxLength={64} disabled={pending}/>
      <label htmlFor="account-current-password">Current password</label><Input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} disabled={pending}/>
      <label htmlFor="account-new-password">New password</label><Input id="account-new-password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={pending}/><small>Leave blank to keep your password. A PIN is also accepted.</small>
      <label htmlFor="account-confirm-password">Confirm new password</label><Input id="account-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={pending}/>
      <p className="account-notice">Account changes sign out other devices. Your favorites and watch history are private to this account.</p>
      {error&&<p className="error-copy" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      <Button type="submit" isPending={pending} isDisabled={pending}>Save account</Button>
    </form>
  </section>;
}

const permissions: Array<{key:keyof AccountPermissions;title:string;description:string}> = [
  {key:'play',title:'Play videos',description:'Allow video playback in the player and Shorts.'},
  {key:'transcode',title:'Convert audio and video',description:'Allow quality changes and compatibility conversion, which may use significant CPU. When disabled, playback uses original quality and default audio.'},
  {key:'manageLibraries',title:'Add and remove libraries',description:'Trust this user to access folders readable by the server. New folders are shared with accounts that can access all libraries.'},
  {key:'scanLibraries',title:'Scan libraries',description:'Scan only the libraries this account can view.'},
  {key:'manageMetadata',title:'Edit video metadata',description:'Refresh or clear metadata for accessible videos. Changes are shared with other viewers.'}
];
const viewerPermissions:AccountPermissions = {play:true,transcode:true,manageLibraries:false,scanLibraries:false,manageMetadata:false};

export function AccountManager() {
  const session = useAccount(), client = useQueryClient();
  const users = useQuery({queryKey:['accounts'],queryFn:api.accounts,enabled:Boolean(session?.user.isAdmin),staleTime:0});
  const libraries = useQuery({queryKey:['account-libraries'],queryFn:api.accountLibraries,enabled:Boolean(session?.user.isAdmin)});
  const security = useQuery({queryKey:['account-security'],queryFn:api.accountSecurity,enabled:Boolean(session?.user.isAdmin)});
  const [selected,setSelected] = useState<number|'new'|null>(null);
  const setSecurity = useMutation({mutationFn:api.saveAccountSecurity,onSuccess:async()=>{await client.invalidateQueries({queryKey:['account-security']});await session?.refresh();}});
  if (!session?.user.isAdmin) return null;
  const current = typeof selected === 'number' ? users.data?.find(user=>user.id===selected) : undefined;
  const changed = async (user?:Account) => {
    setSelected(user?.id ?? null);
    await client.invalidateQueries({queryKey:['accounts']});
    if (user?.id === session.user.id) await session.refresh();
  };
  return <section className="account-manager" aria-labelledby="settings-title-accounts">
    <div className="account-manager-head"><div><h2 id="settings-title-accounts" tabIndex={-1}>Account Manager</h2><p>Choose who can use this server, which libraries they see and what they can change.</p></div><Button onPress={()=>setSelected('new')}>Add user</Button></div>
    {(users.isPending||libraries.isPending)&&<p role="status">Loading accounts…</p>}
    {(users.error||libraries.error)&&<p role="alert" className="error-copy">Could not load accounts. <button type="button" onClick={()=>{void users.refetch();void libraries.refetch();}}>Try again</button></p>}
    <div className="account-manager-workspace">
    <aside className="account-user-panel" aria-label="Account selection"><h3>Users <span>{users.data?.length ?? 0}</span></h3>
    <div className="account-manager-list" aria-label="Accounts">{users.data?.map(user=><button type="button" key={user.id} aria-pressed={selected===user.id} onClick={()=>setSelected(user.id)}>
      <span><strong>{user.displayName}</strong><small>@{user.username}</small></span><span className="account-role">{!user.enabled?'Disabled':user.isAdmin?'Administrator':'User'}{user.id===session.user.id?' (you)':''}</span>
    </button>)}</div></aside>
    {(selected==='new'||current)&&libraries.data&&<AccountEditor key={selected+':'+(current?.revision??0)} user={current} libraries={libraries.data} selfId={session.user.id} onSaved={changed} onCancel={()=>setSelected(null)}/>}
    {selected===null&&<div className="account-editor-empty"><h3>Select an account</h3><p>Choose a user to edit their profile, library access and permissions, or add a new user.</p></div>}
    </div>
    <div className="account-security"><h3>Administrator network access</h3>
      {security.data&&<AccountToggle title="Administrators can only access from localhost" checked={security.data.adminLocalOnly} disabled={!security.data.localAccess||setSecurity.isPending} onChange={value=>setSecurity.mutate(value)} description="Block all administrator accounts outside this PC, including their existing sessions. Regular users can still connect over the network."/>}
      <p className="account-notice">Change this option on the server PC using localhost. Administrators can manage every account and library permission, even when their own browsing is limited. Only promote people you trust.</p>
      <p className="account-notice">This checks the direct network connection, not a forwarded IP header. A localhost proxy or tunnel can hide the original client; see the security guide before using one.</p>
      {security.error&&<p className="error-copy" role="alert">Could not load network access settings. <button type="button" onClick={()=>void security.refetch()}>Try again</button></p>}
      {setSecurity.error&&<p className="error-copy" role="alert">{setSecurity.error.message}</p>}
      {setSecurity.isSuccess&&<p className="account-feedback" role="status">Network access updated. Other administrator sessions have been signed out.</p>}
    </div>
  </section>;
}

function AccountEditor({user,libraries,selfId,onSaved,onCancel}: {user?:Account;libraries:Library[];selfId:number;onSaved:(user?:Account)=>Promise<void>;onCancel:()=>void}) {
  const client=useQueryClient();
  const [draft,setDraft] = useState(()=>user ?? {username:'',displayName:'',isAdmin:false,enabled:true,allLibraries:false,libraryIds:[] as number[],permissions:{...viewerPermissions}});
  const [password,setPassword] = useState(''), [confirmation,setConfirmation] = useState(''), [error,setError] = useState('');
  const save = useMutation({mutationFn:()=>api.saveAccount({...draft,displayName:draft.displayName.trim()||draft.username,password:password||undefined},user?.id),onSuccess:async result=>{setPassword('');setConfirmation('');await onSaved(result);}});
  const submit = () => {
    setError('');
    if ((!user || password) && password !== confirmation) {setError('The passwords do not match.');return;}
    if (!user && !password) {setError('Set a password for the new account.');return;}
    save.mutate();
  };
  return <div className="account-editor"><h3>{user?'Edit '+user.displayName:'New user'}</h3>
    <form noValidate onSubmit={event=>{event.preventDefault();if(!save.isPending)submit();}}>
      <fieldset className="account-permissions account-identity" disabled={save.isPending}><legend>Profile</legend><div className="account-form">
        <label htmlFor="managed-username">Username</label><Input id="managed-username" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} value={draft.username} onChange={event=>setDraft({...draft,username:event.target.value})} disabled={save.isPending}/>
        <label htmlFor="managed-display-name">Display name</label><Input id="managed-display-name" maxLength={80} value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})} disabled={save.isPending}/>
        <label htmlFor="managed-password">{user?'Reset password':'Password'}</label><Input id="managed-password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={save.isPending}/><small>{user?'Leave blank to keep the current password. ':''}A password or PIN. No complexity requirements.</small>
        <label htmlFor="managed-confirm-password">Confirm password</label><Input id="managed-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={save.isPending}/>
      </div></fieldset>
      <fieldset className="account-permissions" disabled={save.isPending}><legend>Role and status</legend>
      <AccountToggle title="Administrator" checked={draft.isAdmin} disabled={save.isPending} onChange={value=>setDraft({...draft,isAdmin:value,permissions:value?draft.permissions:{...viewerPermissions}})} description="Allow account management and server configuration. This is full administrative trust, not just library access."/>
      <AccountToggle title="Account enabled" checked={draft.enabled} disabled={save.isPending} onChange={value=>setDraft({...draft,enabled:value})} description="Disabling signs this user out and blocks further access."/>
      </fieldset>
      <fieldset className="account-permissions" disabled={save.isPending}><legend>Library access</legend>
        <AccountToggle title="All libraries, including future additions" checked={draft.allLibraries} onChange={value=>setDraft({...draft,allLibraries:value})}/>
        {!draft.allLibraries&&<><p className="account-notice">Only selected libraries are visible. No selection means no library access.</p>{libraries.length===0&&<p className="account-notice">Add a library in Settings → Libraries first.</p>}{libraries.map(library=><AccountToggle key={library.id} title={library.label} description={(library.persistent?'Saved library · ':'Temporary · ')+library.path} checked={draft.libraryIds.includes(library.id)} onChange={value=>setDraft({...draft,libraryIds:value?[...draft.libraryIds,library.id]:draft.libraryIds.filter(id=>id!==library.id)})}/>)}</>}
      </fieldset>
      <fieldset className="account-permissions" disabled={save.isPending}><legend>Allowed actions</legend>
        {draft.isAdmin?<p className="account-notice">Administrators can perform all actions. Library browsing still follows the selection above.</p>:permissions.map(permission=><AccountToggle key={permission.key} title={permission.title} description={permission.description} checked={draft.permissions[permission.key]} onChange={value=>setDraft({...draft,permissions:{...draft.permissions,[permission.key]:value}})}/>)}</fieldset>
      {user&&<p className="account-notice">Saving changes signs this user out on all devices{user.id===selfId?', including this session':''}. Previously downloaded or buffered content cannot be recalled.</p>}
      {(error||save.error)&&<p className="error-copy" role="alert">{error||save.error?.message}</p>}
      {user&&save.error&&<Button variant="secondary" onPress={()=>void client.invalidateQueries({queryKey:['accounts']})}>Reload user</Button>}
      <div className="account-editor-actions"><Button type="submit" isPending={save.isPending} isDisabled={save.isPending}>{user?'Save user':'Create user'}</Button><Button variant="secondary" isDisabled={save.isPending} onPress={onCancel}>Cancel</Button></div>
    </form>
    {user&&user.id!==selfId&&<div className="account-editor-actions"><ConfirmationDialog triggerLabel="Delete user" title={'Delete '+user.displayName+'?'} confirmLabel="Delete user" onConfirm={async()=>{await api.deleteAccount(user.id);await onSaved();}}><p>Remove this account, its favorites and watch history. Your video files and libraries will not be deleted.</p></ConfirmationDialog></div>}
  </div>;
}
