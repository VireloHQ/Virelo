import { Trans } from '../i18n/Trans';
import { t, useLocale } from '../i18n';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { ArrowLeft, Database, Eye, Folders, MagnifyingGlass, PencilSimple, Plus, ShieldCheck, UserCircle } from '@phosphor-icons/react';
import { api } from '../api';
import { useAccount } from './AccountSession';
import { ConfirmationDialog } from './ConfirmationDialog';
import { AccountToggle } from './AccountToggle';
import { ActivityView, ManagedUserData } from './AccountAdministration';
import type { Account, AccountPermissions } from '../../../src/auth-types';
import type { Library } from '../types';

export function AccountProfile() {
  useLocale();
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
    <div className="account-profile-header"><div><h2 id="settings-title-account" tabIndex={-1}>{session.user.displayName}</h2><p>{session.user.isAdmin?t("Administrator"):t("User")} · @{session.user.username}</p></div>
      <Button variant="secondary" isDisabled={pending} onPress={()=>{setError('');void session.logout().catch(()=>setError('Could not sign out. Check the server connection and try again.'));}}>{t("Sign out")}</Button></div>
    <form className="account-form" noValidate onSubmit={event=>{event.preventDefault();void submit();}}>
      <label htmlFor="account-name">{t("Display name")}</label><Input id="account-name" autoComplete="nickname" value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={80} disabled={pending}/>
      <label htmlFor="account-username">{t("Username")}</label><Input id="account-username" autoComplete="username" autoCapitalize="none" spellCheck={false} value={username} onChange={event=>setUsername(event.target.value)} maxLength={64} disabled={pending}/>
      <label htmlFor="account-current-password">{t("Current password")}</label><Input id="account-current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} disabled={pending}/>
      <label htmlFor="account-new-password">{t("New password")}</label><Input id="account-new-password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={pending}/><small>{t("Leave blank to keep your password. A PIN is also accepted.")}</small>
      <label htmlFor="account-confirm-password">{t("Confirm new password")}</label><Input id="account-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={pending}/>
      <p className="account-notice">{t("Account changes sign out other devices. Favorites, watch history and playlists belong to this account. Server administrators can clear account data; activity is logged only when the monitoring notice is shown.")}</p>
      {error&&<p className="error-copy" role="alert">{t(error)}</p>}{message&&<p role="status">{t(message)}</p>}
      <Button type="submit" isPending={pending} isDisabled={pending}>{t("Save account")}</Button>
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
  useLocale();
  const session = useAccount(), client = useQueryClient();
  const users = useQuery({queryKey:['accounts'],queryFn:api.accounts,enabled:Boolean(session?.user.isAdmin),staleTime:0});
  const libraries = useQuery({queryKey:['account-libraries'],queryFn:api.accountLibraries,enabled:Boolean(session?.user.isAdmin)});
  const [selected,setSelected] = useState<number|'new'|null>(null);
  const [search,setSearch]=useState('');
  const [tab,setTab]=useState('profile');
  const select=(id:number|'new'|null)=>{setSelected(id);setTab('profile');};
  if (!session?.user.isAdmin) return null;
  const current = typeof selected === 'number' ? users.data?.find(user=>user.id===selected) : undefined;
  const changed = async (user?:Account) => {
    setSelected(user?.id ?? null);
    await client.invalidateQueries({queryKey:['accounts']});
    if (user?.id === session.user.id) await session.refresh();
  };
  return <section className="account-manager" aria-labelledby="settings-title-accounts">
    <div className="account-manager-head"><div><h2 id="settings-title-accounts" tabIndex={-1}>{t("Account Manager")}</h2><p>{t("Users, library access and personal data. Server-wide options are in Admin.")}</p></div>{selected===null&&<Button onPress={()=>select('new')}><Plus aria-hidden="true"/> {t("Add user")}</Button>}</div>
    {(users.isPending||libraries.isPending)&&<p role="status">{t("Loading accounts…")}</p>}
    {(users.error||libraries.error)&&<p role="alert" className="error-copy"><Trans message="Could not load accounts. {value0}" values={{value0:<button type="button" onClick={()=>{void users.refetch();void libraries.refetch();}}>{t("Try again")}</button>}}/></p>}
    {selected===null&&<>
      <div className="account-list-tools"><span>{t('{count} users',{count:users.data?.length??0})}</span><label className="account-search"><MagnifyingGlass aria-hidden="true"/><Input aria-label={t("Search users")} placeholder={t("Search users")} value={search} onChange={event=>setSearch(event.target.value)}/></label></div>
      <div className="admin-table-scroll"><table className="admin-table account-users"><thead><tr><th scope="col">{t("User")}</th><th scope="col">{t("Role")}</th><th scope="col">{t("Library access")}</th><th scope="col">{t("Status")}</th><th scope="col"><span className="sr-only">{t("Actions")}</span></th></tr></thead><tbody>
        {users.data?.filter(user=>(user.displayName+' '+user.username).toLowerCase().includes(search.toLowerCase())).map(user=><tr key={user.id}>
          <th scope="row"><strong>{user.displayName}{user.id===session.user.id&&<span className="account-you">{t("You")}</span>}</strong><small>@{user.username}</small><small className="account-mobile-summary">{user.isAdmin?t("Admin"):t("User")} · {user.enabled?t("Enabled"):t("Disabled")} · {user.allLibraries?t("All libraries"):t('{count} libraries',{count:user.libraryIds.length})}</small></th>
          <td><span className="account-role-badge">{user.isAdmin?<ShieldCheck aria-hidden="true"/>:<UserCircle aria-hidden="true"/>}{user.isAdmin?t("Admin"):t("User")}</span></td>
          <td>{user.allLibraries?t("All libraries"):t("{value0} selected", { value0: user.libraryIds.length })}</td><td><span className={'account-enabled-status'+(user.enabled?' enabled':'')}>{user.enabled?t("Enabled"):t("Disabled")}</span></td>
          <td><Button variant="ghost" aria-label={t("Edit {value0}", { value0: user.displayName })} onPress={()=>select(user.id)}><PencilSimple aria-hidden="true"/> {t("Edit")}</Button></td>
        </tr>)}
        {users.data&&!users.data.some(user=>(user.displayName+' '+user.username).toLowerCase().includes(search.toLowerCase()))&&<tr><td colSpan={5}>{t("No matching users.")}</td></tr>}
      </tbody></table></div>
      <p className="account-notice">{t("Administrators manage all accounts and library permissions, even when their own library browsing is restricted. Only promote people you trust.")}</p>
    </>}
    {(selected==='new'||current)&&libraries.data&&<><Button variant="ghost" onPress={()=>select(null)}><ArrowLeft aria-hidden="true"/> {t("All users")}</Button><AccountEditor key={selected+':'+(current?.revision??0)} user={current} libraries={libraries.data} selfId={session.user.id} tab={tab} onTab={setTab} onSaved={changed} onCancel={()=>select(null)}/></>}
    {typeof selected==='number'&&users.data&&!current&&<p className="admin-information"><Trans message="This account is no longer available. {value0}" values={{value0:<button type="button" onClick={()=>select(null)}>{t("Return to users")}</button>}}/></p>}
  </section>;
}

const editorTabs=[{id:'profile',label:'Profile',icon:UserCircle},{id:'libraries',label:'Libraries',icon:Folders},{id:'permissions',label:'Permissions',icon:ShieldCheck},{id:'data',label:'Data',icon:Database},{id:'activity',label:'Activity',icon:Eye}];
function AccountEditor({user,libraries,selfId,tab,onTab,onSaved,onCancel}: {user?:Account;libraries:Library[];selfId:number;tab:string;onTab:(id:string)=>void;onSaved:(user?:Account)=>Promise<void>;onCancel:()=>void}) {
  useLocale();
  const client=useQueryClient();
  const [draft,setDraft] = useState(()=>user ?? {username:'',displayName:'',isAdmin:false,enabled:true,allLibraries:false,libraryIds:[] as number[],permissions:{...viewerPermissions}});
  const [password,setPassword] = useState(''), [confirmation,setConfirmation] = useState(''), [error,setError] = useState('');
  const [librarySearch,setLibrarySearch]=useState('');
  const tabs=user?editorTabs:editorTabs.slice(0,3);
  const save = useMutation({mutationFn:()=>api.saveAccount({...draft,displayName:draft.displayName.trim()||draft.username,password:password||undefined},user?.id),onSuccess:async result=>{setPassword('');setConfirmation('');await onSaved(result);}});
  const submit = () => {
    setError('');
    if(!draft.username.trim()){onTab('profile');setError('Enter a username.');return;}
    if ((!user || password) && password !== confirmation) {onTab('profile');setError('The passwords do not match.');return;}
    if (!user && !password) {onTab('profile');setError('Set a password for the new account.');return;}
    save.mutate();
  };
  return <div className="account-editor"><h3>{user?t("Edit {value0}", { value0: user.displayName }):t("New user")}</h3>
    <div className="account-editor-tabs" role="tablist" aria-label={t("User settings")} onKeyDown={event=>{
      const index=tabs.findIndex(item=>item.id===tab);let next=index;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;else if(event.key==='ArrowLeft')next=(index+tabs.length-1)%tabs.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=tabs.length-1;else return;
      event.preventDefault();onTab(tabs[next].id);document.getElementById('user-tab-'+tabs[next].id)?.focus();
    }}>{tabs.map(item=><button key={item.id} id={'user-tab-'+item.id} type="button" role="tab" aria-selected={tab===item.id} tabIndex={tab===item.id?0:-1} aria-controls="user-editor-panel" onClick={()=>onTab(item.id)}><item.icon aria-hidden="true"/>{t(item.label)}</button>)}</div>
    <div id="user-editor-panel" role="tabpanel" aria-labelledby={'user-tab-'+tab} tabIndex={0}>
    {user&&tab==='data'?<ManagedUserData user={user}/>:user&&tab==='activity'?<ActivityView userId={user.id}/>:<form noValidate onSubmit={event=>{event.preventDefault();if(!save.isPending)submit();}}>
      {tab==='profile'&&<><fieldset className="account-permissions account-identity" disabled={save.isPending}><legend>{t("Profile")}</legend><div className="account-form">
        <label htmlFor="managed-username">{t("Username")}</label><Input id="managed-username" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} value={draft.username} onChange={event=>setDraft({...draft,username:event.target.value})} disabled={save.isPending}/>
        <label htmlFor="managed-display-name">{t("Display name")}</label><Input id="managed-display-name" maxLength={80} value={draft.displayName} onChange={event=>setDraft({...draft,displayName:event.target.value})} disabled={save.isPending}/>
        <label htmlFor="managed-password">{user?t("Reset password"):t("Password")}</label><Input id="managed-password" type="password" autoComplete="new-password" value={password} onChange={event=>setPassword(event.target.value)} disabled={save.isPending}/><small>{user?t("Leave blank to keep the current password. "):''}{t("A password or PIN. No complexity requirements.")}</small>
        <label htmlFor="managed-confirm-password">{t("Confirm password")}</label><Input id="managed-confirm-password" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={save.isPending}/>
      </div></fieldset>
      <fieldset className="account-permissions" disabled={save.isPending}><legend>{t("Role and status")}</legend>
      <AccountToggle title={t("Administrator")} checked={draft.isAdmin} disabled={save.isPending} onChange={value=>setDraft({...draft,isAdmin:value,permissions:value?draft.permissions:{...viewerPermissions}})} description={t("Allow account management and server configuration. This is full administrative trust, not just library access.")}/>
      <AccountToggle title={t("Account enabled")} checked={draft.enabled} disabled={save.isPending} onChange={value=>setDraft({...draft,enabled:value})} description={t("Disabling signs this user out and blocks further access.")}/>
      </fieldset></>}
      {tab==='libraries'&&<fieldset className="account-permissions" disabled={save.isPending}><legend>{t("Library access")}</legend>
        <AccountToggle title={t("All libraries, including future additions")} checked={draft.allLibraries} onChange={value=>setDraft({...draft,allLibraries:value})}/>
        {!draft.allLibraries&&<><p className="account-notice">{t("Only selected libraries are visible. No selection means no library access.")}</p>{libraries.length===0?<p className="account-notice">{t("Add a library in Settings → Libraries first.")}</p>:<Input aria-label={t("Find a library")} placeholder={t("Find a library")} value={librarySearch} onChange={event=>setLibrarySearch(event.target.value)}/>}{libraries.filter(library=>(library.label+' '+library.path).toLowerCase().includes(librarySearch.toLowerCase())).map(library=><AccountToggle key={library.id} title={library.label} description={t(library.persistent?'Saved library':'Temporary')+' · '+library.path} checked={draft.libraryIds.includes(library.id)} onChange={value=>setDraft({...draft,libraryIds:value?[...draft.libraryIds,library.id]:draft.libraryIds.filter(id=>id!==library.id)})}/>)}</>}
      </fieldset>}
      {tab==='permissions'&&<fieldset className="account-permissions" disabled={save.isPending}><legend>{t("Allowed actions")}</legend>
        {draft.isAdmin?<p className="account-notice">{t("Administrators can perform all actions. Library browsing still follows the Libraries tab.")}</p>:permissions.map(permission=><AccountToggle key={permission.key} title={t(permission.title)} description={t(permission.description)} checked={draft.permissions[permission.key]} onChange={value=>setDraft({...draft,permissions:{...draft.permissions,[permission.key]:value}})}/>)}</fieldset>}
      {user&&<p className="account-notice">{t(user.id===selfId?'Saving changes signs this user out on all devices, including this session. Previously downloaded or buffered content cannot be recalled.':'Saving changes signs this user out on all devices. Previously downloaded or buffered content cannot be recalled.')}</p>}
      {(error||save.error)&&<p className="error-copy" role="alert">{t(error||save.error?.message||'')}</p>}
      {user&&save.error&&<Button variant="secondary" onPress={()=>void client.invalidateQueries({queryKey:['accounts']})}>{t("Reload user")}</Button>}
      <div className="account-editor-actions"><Button type="submit" isPending={save.isPending} isDisabled={save.isPending}>{user?t("Save user"):t("Create user")}</Button><Button variant="secondary" isDisabled={save.isPending} onPress={onCancel}>{t("Cancel")}</Button></div>
    </form>}
    </div>
    {user&&tab==='profile'&&user.id!==selfId&&<div className="admin-destructive"><ConfirmationDialog triggerLabel={t("Delete user")} title={t("Delete {value0}?", { value0: user.displayName })} confirmLabel={t("Delete user")} onConfirm={async()=>{await api.deleteAccount(user.id);await onSaved();}}><p>{t("Remove this account, its favorites, watch history, playlists and activity logs. A record of this deletion may remain in the administrator's log. Video files and libraries are never deleted.")}</p></ConfirmationDialog></div>}
  </div>;
}
