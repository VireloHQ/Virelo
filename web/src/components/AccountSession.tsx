import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input } from '@heroui/react';
import { api } from '../api';
import { useUIStore } from '../store';
import type { Account, AuthStatus } from '../../../src/auth-types';
import '../accounts.css';
import { ActivityDisclosure, ActivityReporter } from './ActivityDisclosure';

interface SessionContext { user: Account; localAccess: boolean; monitoring?:AuthStatus['monitoring']; refresh: () => Promise<void>; logout: () => Promise<void> }
const Context = createContext<SessionContext | null>(null);
export const useAccount = () => useContext(Context);
export function PlaybackAccess({children}:{children:ReactNode}) {
  const session = useAccount();
  return session?.user.permissions.play === false ? <div className="watch-empty"><h1>Playback is disabled</h1><p>Ask an administrator to allow video playback for your account.</p></div> : children;
}
const sessionKey = ['account-session'];

function PrivateSession({ session, children }: { session: SessionContext; children: ReactNode }) {
  // Never reuse another account's query cache, including in-flight optimistic saves.
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime:20_000, refetchOnWindowFocus:false, retry:1 } } }));
  useEffect(() => () => { void client.cancelQueries(); client.clear(); useUIStore.setState({search:'',mobileSearchOpen:false,homeFilter:'all'}); }, [client]);
  return <Context.Provider value={session}><QueryClientProvider client={client}><ActivityReporter policy={session.monitoring}/>{children}</QueryClientProvider></Context.Provider>;
}

export function AccountSession({ children }: {children:ReactNode}) {
  const client = useQueryClient();
  const query = useQuery({ queryKey:sessionKey, queryFn:api.authStatus, retry:false, staleTime:0, refetchOnWindowFocus:true, refetchInterval:60_000 });
  const channel = useRef<BroadcastChannel | null>(null);
  const notify = () => {
    if (channel.current) channel.current.postMessage('changed');
    else try { localStorage.setItem('virelo-account-changed', String(Date.now())); } catch { /* Focus also rechecks the session. */ }
  };
  const refresh = async () => { await client.invalidateQueries({queryKey:sessionKey}); };
  useEffect(() => {
    const expired = () => {
      client.setQueryData<AuthStatus>(sessionKey, previous => previous ? {...previous,user:null} : undefined);
      void client.invalidateQueries({queryKey:sessionKey});
    };
    const storage = (event:StorageEvent) => { if (event.key === 'virelo-account-changed') expired(); };
    window.addEventListener('virelo-auth-expired', expired);
    window.addEventListener('storage', storage);
    if ('BroadcastChannel' in window) { channel.current = new BroadcastChannel('virelo-account'); channel.current.onmessage = expired; }
    return () => { window.removeEventListener('virelo-auth-expired',expired); window.removeEventListener('storage',storage); channel.current?.close(); channel.current = null; };
  }, [client]);
  const logout = async () => {
    await api.signOut();
    client.setQueryData<AuthStatus>(sessionKey, previous => previous ? {...previous,user:null} : undefined);
    notify();
  };
  if (query.data?.user) return <PrivateSession key={query.data.user.id + ':' + query.data.user.revision}
    session={{user:query.data.user,localAccess:query.data.localAccess,monitoring:query.data.monitoring,refresh,logout}}>{children}</PrivateSession>;
  const connectionError = query.isError || (query.isPending && query.errorUpdatedAt > 0);
  return <div className={`account-entry app-shell${query.isPending || connectionError ? ' account-connection' : ''}`}>
    <a className="account-brand" href="/" aria-label="Virelo"><img src="/virelo-icon.png" alt=""/>Virelo</a>
    {connectionError
      ? <section className="account-status" aria-labelledby="connection-error-title"><h1 id="connection-error-title">Cannot reach your server</h1><p>Check that Virelo is running, then try again.</p><Button isPending={query.isFetching} onPress={()=>void query.refetch()}>{query.isFetching ? 'Connecting…' : 'Try again'}</Button></section>
      : query.isPending ? <div className="account-status"><p role="status">Connecting to your server…</p></div>
      : query.data && <SignIn key={String(query.data.setupRequired)} status={query.data} onDone={status=>{client.setQueryData(sessionKey,status);notify();}}/>}
  </div>;
}

function SignIn({ status, onDone }: {status:AuthStatus;onDone:(status:AuthStatus)=>void}) {
  const [username,setUsername] = useState(''), [displayName,setDisplayName] = useState('');
  const [password,setPassword] = useState(''), [confirmation,setConfirmation] = useState('');
  const [pending,setPending] = useState(false), [error,setError] = useState('');
  const busy = useRef(false), setup = status.setupRequired;
  if (setup && !status.localAccess) return <div className="account-entry-form">
    <h1>Set up Virelo on the server PC</h1>
    <p>The first administrator must be created on the PC running Virelo. Open its localhost address there, then return here to sign in.</p>
    <Button variant="secondary" onPress={()=>location.reload()}>Check again</Button>
  </div>;
  const submit = async () => {
    if (busy.current) return;
    setError('');
    if (!username.trim() || !password) { setError('Enter your username and password.'); return; }
    if (setup && password !== confirmation) { setError('The passwords do not match.'); return; }
    busy.current = true; setPending(true);
    try { onDone(await (setup ? api.setupAccount({username,displayName:displayName.trim() || username,password}) : api.signIn({username,password,noticeVersion:status.monitoring?.revision}))); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not sign in. Try again.'); }
    finally { busy.current = false; setPending(false); }
  };
  return <form className="account-entry-form account-form" noValidate onSubmit={event=>{event.preventDefault();void submit();}}>
    <h1>{setup?'Create administrator':'Welcome back'}</h1>
    <p>{setup?'Create the administrator who manages accounts and library access. Existing favorites and watch history will belong to this account.':'Sign in to your Virelo server. Accounts are stored on this PC, not in the cloud.'}</p>
    <ActivityDisclosure policy={status.monitoring}/>
    <label htmlFor="sign-in-username">Username</label><Input id="sign-in-username" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={64} value={username} onChange={event=>setUsername(event.target.value)} disabled={pending} autoFocus/>
    {setup && <><label htmlFor="sign-in-name">Display name</label><Input id="sign-in-name" autoComplete="nickname" maxLength={80} value={displayName} onChange={event=>setDisplayName(event.target.value)} disabled={pending}/></>}
    <label htmlFor="sign-in-password">Password</label><Input id="sign-in-password" type="password" autoComplete={setup?'new-password':'current-password'} maxLength={256} value={password} onChange={event=>setPassword(event.target.value)} disabled={pending}/>
    {setup && <><small>Choose a password or PIN. No complexity requirements.</small><label htmlFor="sign-in-confirm">Confirm password</label><Input id="sign-in-confirm" type="password" autoComplete="new-password" value={confirmation} onChange={event=>setConfirmation(event.target.value)} disabled={pending}/></>}
    {error && <p className="error-copy" role="alert">{error}</p>}
    <Button type="submit" isPending={pending} isDisabled={pending}>{setup?'Create administrator':'Sign in'}</Button>
    {!setup&&<p className="account-help">Forgot your password? Ask your server administrator to reset it.</p>}
    <p className="account-help">Use HTTPS or a trusted VPN when connecting over an untrusted network.</p>
  </form>;
}
