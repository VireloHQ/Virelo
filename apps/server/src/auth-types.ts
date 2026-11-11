export interface AccountPermissions {
  manageLibraries: boolean;
  scanLibraries: boolean;
  manageMetadata: boolean;
  play: boolean;
  transcode: boolean;
}

export interface Account {
  id: number;
  username: string;
  displayName: string;
  isAdmin: boolean;
  enabled: boolean;
  allLibraries: boolean;
  libraryIds: number[];
  permissions: AccountPermissions;
  revision: number;
  createdAt: number;
}

export interface AuthStatus {
  setupRequired: boolean;
  localAccess: boolean;
  user: Account | null;
  monitoring?: ActivityPolicy;
}

export interface ActivityPolicy { enabled:boolean; retentionDays:number; revision:number; maxEvents:number }
export interface PlaybackActivity { mediaId:number|null; state:'idle'|'playing'|'paused'; position:number }
export interface ActivityHeartbeat extends PlaybackActivity { tabId:string; noticeVersion:number }
export interface LiveActivity extends PlaybackActivity { id:string; userId:number; displayName:string; username:string; lastSeen:number; title:string|null }
export interface AuditEvent { id:number; createdAt:number; actorId:number|null; actorName:string; targetId:number|null; targetName:string|null; action:string; mediaId:number|null; title:string|null }
export interface ActivityPage { events:AuditEvent[]; nextBefore:number|null }
export interface AccountDataSummary { history:number; favorites:number; playlists:number; playlistItems:number; sessions:number; activityEvents:number }
export type AccountDataCategory = 'history'|'favorites'|'playlists'|'sessions'|'activity';

export interface CatalogScope { userId: number; libraryIds: number[] | null }
