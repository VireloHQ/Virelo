import type { FolderEntry, HomeData, Library, MediaItem, PlaybackInfo, PlaybackQuality, ScanStatus, Settings, ShortsFeed } from './types';
import type { Account, AuthStatus } from '../../src/auth-types';
import type { DataUsage } from '../../src/types';
import type { PlaylistDetail, PlaylistSummary, PlaylistWrite } from './types';

export interface QualityTranscodeState {
  status:string;
  error?:string;
  playlist:string;
  variants:Array<PlaybackQuality&{url:string}>;
  bufferedUntil?:number;
  complete?:boolean;
  startTime?:number;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = { 'X-Virelo-Request':'1', ...(init?.headers as Record<string,string> | undefined) };
  if (init?.body) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (body.code === 'SESSION_REVOKED' || (response.status === 401 && !['/api/auth/login','/api/auth/setup'].includes(url))) window.dispatchEvent(new Event('virelo-auth-expired'));
    throw new Error(body.message || body.error || `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function withQuery(url: string, params: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null) query.set(key, String(value));
  return `${url}?${query}`;
}

export const api = {
  playlists: () => request<PlaylistSummary[]>('/api/playlists'),
  playlist: (id: number) => request<PlaylistDetail>(`/api/playlists/${id}`),
  createPlaylist: (body: { name: string; mediaIds: number[] }) => request<PlaylistDetail>('/api/playlists', { method: 'POST', body: JSON.stringify(body) }),
  updatePlaylist: (id: number, body: PlaylistWrite) => request<PlaylistDetail>(`/api/playlists/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deletePlaylist: (id: number, revision: number) => request<{ok:boolean}>(`/api/playlists/${id}`, { method: 'DELETE', body: JSON.stringify({ revision }) }),
  authStatus: () => request<AuthStatus>('/api/auth/status'),
  signIn: (body: {username:string;password:string}) => request<AuthStatus>('/api/auth/login', {method:'POST',body:JSON.stringify(body)}),
  setupAccount: (body: {username:string;displayName:string;password:string}) => request<AuthStatus>('/api/auth/setup', {method:'POST',body:JSON.stringify(body)}),
  signOut: () => request('/api/auth/logout', {method:'POST'}),
  updateAccount: (body: {username:string;displayName:string;currentPassword:string;password?:string}) => request<AuthStatus>('/api/auth/me', {method:'PATCH',body:JSON.stringify(body)}),
  accounts: () => request<Account[]>('/api/accounts'),
  accountLibraries: () => request<Library[]>('/api/accounts/libraries'),
  previousLibraries: () => request<Library[]>('/api/accounts/previous-libraries'),
  saveAccount: (body: object, id?:number) => request<Account>(id === undefined ? '/api/accounts' : `/api/accounts/${id}`, {method:id === undefined?'POST':'PATCH',body:JSON.stringify(body)}),
  deleteAccount: (id:number) => request(`/api/accounts/${id}`, {method:'DELETE'}),
  accountSecurity: () => request<{adminLocalOnly:boolean;localAccess:boolean}>('/api/accounts/security'),
  saveAccountSecurity: (adminLocalOnly:boolean) => request('/api/accounts/security', {method:'POST',body:JSON.stringify({adminLocalOnly})}),
  home: () => request<HomeData>('/api/home'),
  media: (params: Record<string,string|number|undefined> = {}) => request<MediaItem[]>(withQuery('/api/media', params)),
  mediaById: (id: number) => request<MediaItem>(`/api/media/${id}`),
  shorts: (params: {limit?:number;offset?:number;seed?:number;startId?:number} = {}) => request<ShortsFeed>(withQuery('/api/shorts', params)),
  setLike: (id: number, liked: boolean) => request<{ok:boolean;liked:boolean}>(`/api/media/${id}/like`, { method: 'POST', body: JSON.stringify({ liked }) }),
  folders: () => request<FolderEntry[]>('/api/folders'),
  libraries: () => request<Library[]>('/api/libraries'),
  pickFolder: () => request<{path:string|null}>('/api/libraries/pick',{method:'POST'}),
  addLibrary: (path: string, label?: string) => request<Library>('/api/libraries', { method: 'POST', body: JSON.stringify({ path, label }) }),
  removeLibrary: (id: number) => request<{ok:boolean}>(`/api/libraries/${id}`, { method:'DELETE' }),
  settings: () => request<Settings>('/api/settings'),
  dataUsage: () => request<DataUsage>('/api/data'),
  clearPlaybackCache: () => request<{deletedFiles:number;freedBytes:number;retainedFiles:number;retainedBytes:number}>('/api/data/cache',{method:'DELETE'}),
  saveSettings: (settings: Partial<Settings>) => request<Settings>('/api/settings', { method: 'POST', body: JSON.stringify(settings) }),
  startScan: () => request<{started:boolean;status:ScanStatus}>('/api/scan', { method: 'POST' }),
  scanStatus: () => request<ScanStatus>('/api/scan/status'),
  clearMetadata: (id:number) => request<MediaItem>(`/api/media/${id}/metadata`, { method:'DELETE' }),
  clearAllMetadata: () => request<{cleared:number}>('/api/metadata', { method:'DELETE' }),
  refreshMetadata: (id:number) => request<MediaItem>(`/api/media/${id}/metadata/refresh`, { method:'POST' }),
  playbackInfo: (id:number) => request<PlaybackInfo>(`/api/media/${id}/playback`),
  startTranscode: (id:number,audioStream?:number,startTime?:number) => request<{status:string;error?:string;playlist:string;bufferedUntil?:number;complete?:boolean;startTime?:number}>(`/api/media/${id}/transcode/start`, {method:'POST',body:JSON.stringify({audioStream,startTime})}),
  transcodeStatus: (id:number,audioStream?:number,startTime?:number) => request<{status:string;error?:string;playlist:string;bufferedUntil?:number;complete?:boolean;startTime?:number}>(withQuery(`/api/media/${id}/transcode/status`,{audioStream,startTime})),
  startQualityTranscode: (id:number,audioStream?:number,startTime?:number) => request<QualityTranscodeState>(`/api/media/${id}/quality/start`,{method:'POST',body:JSON.stringify({audioStream,startTime})}),
  qualityTranscodeStatus: (id:number,audioStream?:number,startTime?:number) => request<QualityTranscodeState>(withQuery(`/api/media/${id}/quality/status`,{audioStream,startTime})),
  startAudioTranscode: (id:number,audioStream:number) => request<{status:string;error?:string;url:string}>(`/api/media/${id}/audio/start`, {method:'POST',body:JSON.stringify({audioStream})}),
  audioTranscodeStatus: (id:number,audioStream:number) => request<{status:string;error?:string;url:string}>(withQuery(`/api/media/${id}/audio/status`,{audioStream})),
  subtitleUrl: (id:number,stream:number) => `/api/media/${id}/subtitles/${stream}`,
  progress: (id:number, position:number, duration:number) => fetch(`/api/media/${id}/progress`, {
    method:'POST', headers:{'Content-Type':'application/json','X-Virelo-Request':'1'}, body:JSON.stringify({position,duration}), keepalive:true
  }).catch(()=>undefined)
};

export function artwork(item: MediaItem, kind: 'poster'|'backdrop'|'thumbnail' = 'thumbnail') {
  return `/api/media/${item.id}/artwork/${kind}?v=${item.metadata_revision ?? 0}`;
}
