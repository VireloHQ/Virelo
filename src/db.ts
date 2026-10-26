import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { realpathSync } from 'node:fs';
import { parseMediaName } from './scanner.js';
import { buildHome } from './home.js';
import type { CatalogScope } from './auth-types.js';
import type { AppSettings, FolderEntry, Library, MediaRecord, MediaKind, ShortsFeed, ShortsItem, SortKey } from './types.js';

const DEFAULT_SETTINGS: AppSettings = {
  externalMetadataEnabled: true,
  externalImagesEnabled: true,
  metadataProvider: 'cinemeta',
  metadataLanguage: 'ja-JP',
  tmdbApiKey: '',
  libraryWatchEnabled: true,
  shortsIncludeLandscapes: false,
  queueBehavior: 'auto'
};

const SORT_ORDER: Record<SortKey, string> = {
  title: 'm.sort_title COLLATE NOCASE ASC, m.id ASC',
  newest: 'm.added_at DESC, m.id DESC',
  oldest: 'm.added_at ASC, m.id ASC',
  year: 'm.year IS NULL, m.year DESC, m.sort_title COLLATE NOCASE ASC',
  duration: 'm.duration IS NULL, m.duration DESC, m.sort_title COLLATE NOCASE ASC',
  random: 'RANDOM()'
};
const MEDIA_ALIASES=`SELECT id FROM media WHERE path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''}`;

export class VireloDB {
  readonly db: DatabaseSync;
  private sessionPinned = new Set<number>();

  constructor(dataDir: string) {
    this.db = new DatabaseSync(resolve(dataDir, 'virelo.db'));
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    this.migrate();
    this.db.function('shorts_rank', { deterministic: true }, (id, seed) => shortsRank(Number(id), Number(seed)));
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS libraries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        library_id INTEGER NOT NULL,
        path TEXT NOT NULL UNIQUE,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        sort_title TEXT NOT NULL,
        kind TEXT NOT NULL,
        series_title TEXT,
        season INTEGER,
        episode INTEGER,
        year INTEGER,
        duration REAL,
        width INTEGER,
        height INTEGER,
        video_codec TEXT,
        audio_codec TEXT,
        container TEXT,
        folder TEXT NOT NULL DEFAULT '',
        size INTEGER NOT NULL,
        mtime INTEGER NOT NULL,
        thumbnail_path TEXT,
        poster_path TEXT,
        backdrop_path TEXT,
        overview TEXT,
        genres TEXT,
        external_id TEXT,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(library_id) REFERENCES libraries(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_media_library ON media(library_id);
      CREATE INDEX IF NOT EXISTS idx_media_kind ON media(kind);
      CREATE INDEX IF NOT EXISTS idx_media_title ON media(sort_title);
      CREATE INDEX IF NOT EXISTS idx_media_added ON media(added_at DESC);
      CREATE TABLE IF NOT EXISTS progress (
        media_id INTEGER PRIMARY KEY,
        position REAL NOT NULL DEFAULT 0,
        duration REAL NOT NULL DEFAULT 0,
        completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS likes (
        media_id INTEGER PRIMARY KEY,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE CASCADE
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(media)').all() as Array<{name: string}>;
    for (const name of ['metadata_blocked', 'metadata_revision']) {
      if (!columns.some((column) => column.name === name)) this.db.exec(`ALTER TABLE media ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
    }
    if(process.platform==='win32')this.db.exec('CREATE INDEX IF NOT EXISTS idx_media_path_nocase ON media(path COLLATE NOCASE)');
    this.migrateFolderColumn();
    const libraryColumns = this.db.prepare('PRAGMA table_info(libraries)').all() as Array<{name:string}>;
    if (!libraryColumns.some(column => column.name === 'persistent'))
      this.db.exec('ALTER TABLE libraries ADD COLUMN persistent INTEGER NOT NULL DEFAULT 0');
    this.mergeLibraryAliases();
  }

  private pathKey(path: string) {
    const absolute = resolve(path);
    return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
  }

  private directoryKey(path:string) {
    try { return this.pathKey(realpathSync.native(path)); }
    catch { return this.pathKey(path); }
  }

  private mergeLibraryAliases() {
    if (process.platform !== 'win32') return;
    const canonical = new Map<string, Library>();
    const hasGrants = Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='account_libraries'").get());
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const library of this.listLibraries()) {
        const key = this.pathKey(library.path), previous = canonical.get(key);
        if (!previous) { canonical.set(key, library); continue; }
        this.db.prepare('UPDATE media SET library_id=? WHERE library_id=?').run(previous.id, library.id);
        if (hasGrants) {
          this.db.prepare('INSERT OR IGNORE INTO account_libraries(user_id,library_id) SELECT user_id,? FROM account_libraries WHERE library_id=?').run(previous.id, library.id);
        }
        this.db.prepare('UPDATE libraries SET persistent=MAX(persistent,?) WHERE id=?').run(library.persistent, previous.id);
        this.db.prepare('DELETE FROM libraries WHERE id=?').run(library.id);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }

  private migrateFolderColumn() {
    const columns = this.db.prepare('PRAGMA table_info(media)').all() as Array<{ name: string }>;
    if (!columns.some((c) => c.name === 'folder')) {
      this.db.exec(`ALTER TABLE media ADD COLUMN folder TEXT NOT NULL DEFAULT ''`);
    }
    const pending = this.db.prepare(`
      SELECT m.id, m.path, l.path AS library_path FROM media m JOIN libraries l ON l.id=m.library_id WHERE m.folder='' AND m.path != l.path
    `).all() as Array<{ id: number; path: string; library_path: string }>;
    if (!pending.length) return;
    const update = this.db.prepare('UPDATE media SET folder=? WHERE id=?');
    for (const row of pending) {
      const parent = dirname(row.path);
      let folder: string;
      try { folder = relative(row.library_path, parent).replaceAll('\\', '/'); } catch { folder = ''; }
      if (!folder || folder.startsWith('..')) folder = '';
      update.run(folder, row.id);
    }
  }

  close() { this.db.close(); }

  getSettings(): AppSettings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as Array<{key: string; value: string}>;
    const result: AppSettings = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (!(row.key in result)) continue;
      try { (result as unknown as Record<string, unknown>)[row.key] = JSON.parse(row.value); } catch { /* ignore corrupt setting */ }
    }
    return result;
  }

  updateSettings(patch: Partial<AppSettings>) {
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
    const stmt = this.db.prepare(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`);
    this.db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(patch)) {
        if (allowed.has(key)) stmt.run(key, JSON.stringify(value));
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listLibraries(): Library[] {
    return this.db.prepare('SELECT * FROM libraries ORDER BY created_at ASC').all() as unknown as Library[];
  }

  visibleLibraries(scope?: CatalogScope): Library[] {
    return this.listLibraries().filter(l => (l.persistent === 1 || this.sessionPinned.has(l.id))
      && (!scope || scope.libraryIds === null || scope.libraryIds.includes(l.id)));
  }

  previousLibraries(): Library[] {
    return this.listLibraries().filter(l => !l.persistent && !this.sessionPinned.has(l.id));
  }

  libraryForPath(path: string): Library | undefined {
    return this.ownerForPath(path,this.visibleLibraries());
  }

  private ownerForPath(path: string,libraries: readonly Library[]): Library | undefined {
    let owner: Library | undefined;
    for (const library of libraries) {
      const rest=relative(library.path,path);
      if (rest!=='..'&&!rest.startsWith('..'+sep)&&!isAbsolute(rest)&&(!owner||library.path.length>owner.path.length)) owner=library;
    }
    return owner;
  }

  private reassignMedia() {
    const libraries=this.visibleLibraries();
    const rows=this.db.prepare('SELECT id,path,library_id FROM media').all() as Array<{id:number;path:string;library_id:number}>;
    const update=this.db.prepare('UPDATE media SET library_id=?,folder=? WHERE id=?');
    for (const row of rows) {
      const owner=this.ownerForPath(row.path,libraries);
      if (owner&&owner.id!==row.library_id)
        update.run(owner.id,relative(owner.path,dirname(row.path)).replaceAll('\\','/'),row.id);
    }
  }

  private visibleIdClause(scope?: CatalogScope): { sql: string; params: SQLInputValue[] } {
    const ids = this.visibleLibraries(scope).map((l) => l.id);
    return ids.length
      ? { sql: `m.library_id IN (${ids.map(() => '?').join(',')})`, params: ids }
      : { sql: '0=1', params: [] };
  }

  private catalogClause(scope?: CatalogScope) {
    const visible=this.visibleIdClause(scope);
    if(process.platform!=='win32')return visible;
    // Hide case aliases only in collections; historical IDs still resolve individually.
    return {sql:`${visible.sql} AND m.id=(SELECT MIN(alias.id) FROM media alias WHERE alias.path=m.path COLLATE NOCASE AND ${visible.sql.replaceAll('m.','alias.')})`,params:[...visible.params,...visible.params]};
  }

  addLibrary(path: string, label: string, persistent = true): Library {
    path = resolve(path);
    const now = Date.now();
    const libraries=this.listLibraries();
    const pathMatch=libraries.find(library=>this.pathKey(library.path)===this.pathKey(path));
    const directory=pathMatch?null:this.directoryKey(path);
    const existing=pathMatch??libraries.find(library=>this.directoryKey(library.path)===directory);
    if (existing) {
      if (persistent) this.db.prepare('UPDATE libraries SET persistent=1 WHERE id=?').run(existing.id);
    } else {
      this.db.prepare('INSERT INTO libraries(path,label,created_at,persistent) VALUES(?,?,?,?)').run(path, label, now, Number(persistent));
    }
    const library = this.db.prepare('SELECT * FROM libraries WHERE path=?').get(existing?.path ?? path) as unknown as Library;
    this.sessionPinned.add(library.id);
    this.reassignMedia();
    return library;
  }

  removeLibrary(id: number) {
    this.db.prepare('UPDATE libraries SET persistent=0 WHERE id=?').run(id);
    this.sessionPinned.delete(id);
    this.reassignMedia();
  }

  getMediaByPath(path: string): MediaRecord | undefined {
    return this.db.prepare(`SELECT * FROM media WHERE path=? ${process.platform === 'win32' ? 'COLLATE NOCASE' : ''} ORDER BY id LIMIT 1`).get(path) as unknown as MediaRecord | undefined;
  }

  private personalJoins(scope?: CatalogScope) {
    if(process.platform==='win32'){
      const progress=scope?'user_progress':'progress',likes=scope?'user_likes':'likes';
      const user=scope?'AND history.user_id=?':'';
      return {sql:`LEFT JOIN ${progress} p ON p.media_id=(
        SELECT history.media_id FROM media alias JOIN ${progress} history ON history.media_id=alias.id ${user}
        WHERE alias.path=m.path COLLATE NOCASE ORDER BY history.updated_at DESC,history.media_id DESC LIMIT 1)
        ${scope?'AND p.user_id=?':''}
        LEFT JOIN ${likes} l ON l.media_id=(
        SELECT history.media_id FROM media alias JOIN ${likes} history ON history.media_id=alias.id ${user}
        WHERE alias.path=m.path COLLATE NOCASE ORDER BY history.media_id LIMIT 1)
        ${scope?'AND l.user_id=?':''}`,params:scope?[scope.userId,scope.userId,scope.userId,scope.userId]:[]};
    }
    return scope ? { sql: 'LEFT JOIN user_progress p ON p.media_id=m.id AND p.user_id=? LEFT JOIN user_likes l ON l.media_id=m.id AND l.user_id=?', params: [scope.userId, scope.userId] }
      : { sql: 'LEFT JOIN progress p ON p.media_id=m.id LEFT JOIN likes l ON l.media_id=m.id', params: [] };
  }

  getMedia(id: number, scope?: CatalogScope): MediaRecord | undefined {
    const joins = this.personalJoins(scope), visible = scope ? this.visibleIdClause(scope) : { sql: '1=1', params: [] };
    const canonical=process.platform==='win32'
      ? {sql:`(SELECT MIN(alias.id) FROM media alias WHERE alias.path=m.path COLLATE NOCASE AND ${visible.sql.replaceAll('m.','alias.')})`,params:visible.params}
      : {sql:'m.id',params:[]};
    return this.db.prepare(`
      SELECT m.*,${canonical.sql} AS canonical_id, p.position AS progress_position, p.duration AS progress_duration, p.completed AS progress_completed,
        (l.media_id IS NOT NULL) AS liked
      FROM media m
      ${joins.sql}
      WHERE m.id=? AND ${visible.sql}
    `).get(...canonical.params,...joins.params, id, ...visible.params) as unknown as MediaRecord | undefined;
  }

  getMediaByIds(ids: number[], scope: CatalogScope): MediaRecord[] {
    if (!ids.length) return [];
    const joins = this.personalJoins(scope), visible = this.visibleIdClause(scope);
    const canonical = process.platform === 'win32'
      ? { sql: `(SELECT MIN(alias.id) FROM media alias WHERE alias.path=m.path COLLATE NOCASE AND ${visible.sql.replaceAll('m.', 'alias.')})`, params: visible.params }
      : { sql: 'm.id', params: [] };
    const rows = this.db.prepare(`SELECT m.*,${canonical.sql} AS canonical_id,
      p.position AS progress_position,p.duration AS progress_duration,p.completed AS progress_completed,(l.media_id IS NOT NULL) AS liked
      FROM media m ${joins.sql} WHERE m.id IN (SELECT value FROM json_each(?)) AND ${visible.sql}`)
      .all(...canonical.params, ...joins.params, JSON.stringify(ids), ...visible.params) as unknown as MediaRecord[];
    const byId = new Map(rows.map(item => [item.id, item]));
    return ids.flatMap(id => { const item = byId.get(id); return item ? [item] : []; });
  }

  upsertMedia(input: Omit<MediaRecord, 'id' | 'added_at' | 'updated_at'>): MediaRecord {
    if(process.platform==='win32'){
      const existing=this.getMediaByPath(input.path);
      if(existing)input={...input,path:existing.path};
    }
    const owner=this.libraryForPath(input.path);
    if (owner&&owner.id!==input.library_id)
      input={...input,library_id:owner.id,folder:relative(owner.path,dirname(input.path)).replaceAll('\\','/')};
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO media(
        library_id,path,filename,title,sort_title,kind,series_title,season,episode,year,duration,width,height,
        video_codec,audio_codec,container,folder,size,mtime,thumbnail_path,poster_path,backdrop_path,overview,genres,external_id,added_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(path) DO UPDATE SET
        library_id=excluded.library_id, filename=excluded.filename, title=excluded.title, sort_title=excluded.sort_title,
        kind=excluded.kind, series_title=excluded.series_title, season=excluded.season, episode=excluded.episode, year=excluded.year,
        duration=CASE WHEN media.size!=excluded.size OR media.mtime!=excluded.mtime THEN excluded.duration ELSE COALESCE(excluded.duration,media.duration) END,
        width=CASE WHEN media.size!=excluded.size OR media.mtime!=excluded.mtime THEN excluded.width ELSE COALESCE(excluded.width,media.width) END,
        height=CASE WHEN media.size!=excluded.size OR media.mtime!=excluded.mtime THEN excluded.height ELSE COALESCE(excluded.height,media.height) END,
        video_codec=CASE WHEN media.size!=excluded.size OR media.mtime!=excluded.mtime THEN excluded.video_codec ELSE COALESCE(excluded.video_codec,media.video_codec) END,
        audio_codec=CASE WHEN media.size!=excluded.size OR media.mtime!=excluded.mtime THEN excluded.audio_codec ELSE COALESCE(excluded.audio_codec,media.audio_codec) END,
        container=COALESCE(excluded.container,media.container), folder=excluded.folder, size=excluded.size, mtime=excluded.mtime,
        thumbnail_path=COALESCE(excluded.thumbnail_path,media.thumbnail_path), poster_path=COALESCE(media.poster_path,excluded.poster_path),
        backdrop_path=COALESCE(media.backdrop_path,excluded.backdrop_path), overview=COALESCE(media.overview,excluded.overview),
        genres=COALESCE(media.genres,excluded.genres), external_id=COALESCE(media.external_id,excluded.external_id), updated_at=excluded.updated_at
    `).run(
      input.library_id,input.path,input.filename,input.title,input.sort_title,input.kind,input.series_title,input.season,input.episode,input.year,
      input.duration,input.width,input.height,input.video_codec,input.audio_codec,input.container,input.folder ?? '',input.size,input.mtime,input.thumbnail_path,
      input.poster_path,input.backdrop_path,input.overview,input.genres,input.external_id,now,now
    );
    const record=this.getMediaByPath(input.path)!;
    if(process.platform==='win32')this.db.prepare(`UPDATE media SET library_id=?,folder=?,size=?,mtime=?,duration=?,width=?,height=?,video_codec=?,audio_codec=?,container=?,updated_at=? WHERE id IN (${MEDIA_ALIASES}) AND id!=?`)
      .run(record.library_id,record.folder,record.size,record.mtime,record.duration,record.width,record.height,record.video_codec,record.audio_codec,record.container,now,record.id,record.id);
    return record;
  }

  updateTechnicalMetadata(id: number, data: Partial<Pick<MediaRecord,'duration'|'width'|'height'|'video_codec'|'audio_codec'|'container'|'thumbnail_path'>>) {
    this.db.prepare(`UPDATE media SET duration=COALESCE(?,duration),width=COALESCE(?,width),height=COALESCE(?,height),video_codec=COALESCE(?,video_codec),audio_codec=COALESCE(?,audio_codec),container=COALESCE(?,container),thumbnail_path=COALESCE(?,thumbnail_path),metadata_revision=metadata_revision+?,updated_at=? WHERE id IN (${MEDIA_ALIASES})`)
      .run(data.duration ?? null,data.width ?? null,data.height ?? null,data.video_codec ?? null,data.audio_codec ?? null,data.container ?? null,data.thumbnail_path ?? null,Number(Boolean(data.thumbnail_path)),Date.now(),id);
  }

  shareThumbnail(path:string,thumbnail:string|null,invalidate=false){
    // Keep historical media IDs valid for progress, favorites and saved links.
    return Number(this.db.prepare(`UPDATE media SET thumbnail_path=?,metadata_revision=metadata_revision+1,updated_at=?
      WHERE path=? ${process.platform==='win32'?'COLLATE NOCASE':''} AND (?=1 OR thumbnail_path IS NOT ?)`)
      .run(thumbnail,Date.now(),path,Number(invalidate),thumbnail).changes);
  }

  clearMissingArtwork(id:number,poster:boolean,backdrop:boolean){
    this.db.prepare(`UPDATE media SET poster_path=CASE WHEN ? THEN NULL ELSE poster_path END,backdrop_path=CASE WHEN ? THEN NULL ELSE backdrop_path END,metadata_revision=metadata_revision+1,updated_at=? WHERE id=?`)
      .run(Number(poster),Number(backdrop),Date.now(),id);
  }

  updateExternalMetadata(id: number, data: Partial<Pick<MediaRecord,'title'|'overview'|'genres'|'poster_path'|'backdrop_path'|'external_id'|'year'>>, expectedRevision?: number) {
    const current = this.getMedia(id);
    if (!current || (expectedRevision !== undefined && current.metadata_revision !== expectedRevision)) return;
    this.db.prepare(`UPDATE media SET metadata_blocked=0,metadata_revision=metadata_revision+1,title=?,sort_title=?,overview=?,genres=?,poster_path=?,backdrop_path=?,external_id=?,year=?,updated_at=? WHERE id IN (${MEDIA_ALIASES})`)
      .run(data.title ?? current.title,(data.title ?? current.title).toLowerCase(),data.overview ?? current.overview,data.genres ?? current.genres,data.poster_path ?? current.poster_path,data.backdrop_path ?? current.backdrop_path,data.external_id ?? current.external_id,data.year ?? current.year,Date.now(),id);
  }

  clearExternalMetadata(id: number, parsed: {title: string; year: number|null}) {
    this.db.prepare(`UPDATE media SET title=?,sort_title=?,year=?,overview=NULL,genres=NULL,poster_path=NULL,backdrop_path=NULL,external_id=NULL,metadata_blocked=1,metadata_revision=metadata_revision+1,updated_at=? WHERE id IN (${MEDIA_ALIASES})`)
      .run(parsed.title, parsed.title.toLowerCase(), parsed.year, Date.now(), id);
    return this.getMedia(id);
  }

  clearAllExternalMetadata() {
    const rows = this.db.prepare(`SELECT MIN(id) AS id,path FROM media GROUP BY path ${process.platform==='win32'?'COLLATE NOCASE':''}`).all() as Array<{id:number;path:string}>;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const row of rows) this.clearExternalMetadata(row.id, parseMediaName(row.path));
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { cleared: rows.length };
  }

  deleteMissingForLibrary(libraryId: number, existingPaths: Set<string>) {
    const paths = new Set([...existingPaths].map(path => this.pathKey(path)));
    const rows = this.db.prepare('SELECT id,path FROM media WHERE library_id=?').all(libraryId) as Array<{id:number;path:string}>;
    const del = this.db.prepare('DELETE FROM media WHERE id=?');
    for (const row of rows) if (!paths.has(this.pathKey(row.path))) del.run(row.id);
  }

  listMedia(options: { search?: string; kind?: MediaKind; limit?: number; offset?: number; libraryId?: number; folder?: string; sort?: SortKey; liked?: boolean } = {}, scope?: CatalogScope) {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    const visible = this.catalogClause(scope), joins = this.personalJoins(scope);
    clauses.push(visible.sql);
    params.push(...visible.params);
    if (options.search) {
      clauses.push('(m.title LIKE ? OR m.filename LIKE ? OR m.series_title LIKE ?)');
      const q = `%${options.search}%`; params.push(q,q,q);
    }
    if (options.kind) { clauses.push('m.kind=?'); params.push(options.kind); }
    if (options.libraryId) { clauses.push('m.library_id=?'); params.push(options.libraryId); }
    if (options.folder !== undefined) { clauses.push('m.folder=?'); params.push(options.folder); }
    if (options.liked) clauses.push('l.media_id IS NOT NULL');
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const orderBy = SORT_ORDER[options.sort ?? 'title'] ?? SORT_ORDER.title;
    const requestedLimit = Number.isFinite(options.limit) ? Number(options.limit) : 100;
    const requestedOffset = Number.isFinite(options.offset) ? Number(options.offset) : 0;
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 500);
    const offset = Math.max(Math.trunc(requestedOffset), 0);
    return this.db.prepare(`
      SELECT m.*,p.position AS progress_position,p.duration AS progress_duration,p.completed AS progress_completed,
        (l.media_id IS NOT NULL) AS liked
      FROM media m
      ${joins.sql} ${where}
      ORDER BY ${orderBy} LIMIT ? OFFSET ?
    `).all(...joins.params,...params,limit,offset) as unknown as MediaRecord[];
  }

  getHome(scope?: CatalogScope) {
    const visible = this.catalogClause(scope), joins = this.personalJoins(scope);
    // Curate one visible catalog snapshot; only bounded shelves are sent to clients.
    const items = this.db.prepare(`SELECT m.*,p.position AS progress_position,
      p.duration AS progress_duration,p.completed AS progress_completed,p.updated_at AS progress_updated_at,
      (l.media_id IS NOT NULL) AS liked
      FROM media m ${joins.sql}
      WHERE ${visible.sql} ORDER BY m.added_at DESC,m.id DESC`).all(...joins.params,...visible.params) as unknown as MediaRecord[];
    return buildHome(items);
  }


  listMetadataCandidates(limit = 500, includeMissingArtwork = false, scope?: CatalogScope): MediaRecord[] {
    const safeLimit = Math.min(Math.max(limit, 1), 5000);
    const visible = this.catalogClause(scope);
    return this.db.prepare(`
      SELECT m.*,p.position AS progress_position,p.duration AS progress_duration,p.completed AS progress_completed,
        (l.media_id IS NOT NULL) AS liked
      FROM media m LEFT JOIN progress p ON p.media_id=m.id LEFT JOIN likes l ON l.media_id=m.id
      WHERE ${visible.sql} AND m.metadata_blocked=0 AND (m.external_id IS NULL OR (?=1 AND (m.poster_path IS NULL OR m.backdrop_path IS NULL)))
      ORDER BY m.added_at ASC LIMIT ?
    `).all(...visible.params, includeMissingArtwork ? 1 : 0, safeLimit) as unknown as MediaRecord[];
  }

  getShorts(options: { limit?: number; offset?: number; seed?: number; startId?: number; includeLandscapes?: boolean } = {}, scope?: CatalogScope): ShortsFeed {
    const requestedLimit = Number.isFinite(options.limit) ? Number(options.limit) : 50;
    const requestedOffset = Number.isFinite(options.offset) ? Number(options.offset) : 0;
    const limit = Math.min(Math.max(Math.trunc(requestedLimit), 1), 500);
    const offset = Math.max(Math.trunc(requestedOffset), 0);
    const startId = Number.isSafeInteger(options.startId) && Number(options.startId) > 0 ? Number(options.startId) : 0;
    const dims = '(m.width IS NOT NULL AND m.height IS NOT NULL AND m.width>0 AND m.height>0)';
    const cond = options.includeLandscapes ? dims : `${dims} AND m.height>m.width`;
    const visible = this.catalogClause(scope), joins = this.personalJoins(scope);
    const items = this.db.prepare(`
      SELECT m.*,p.position AS progress_position,p.duration AS progress_duration,p.completed AS progress_completed,(l.media_id IS NOT NULL) AS liked
      FROM media m ${joins.sql}
      WHERE ${visible.sql} AND ${cond}
      ORDER BY (m.path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''}) DESC,shorts_rank(m.id,?),m.id LIMIT ? OFFSET ?
    `).all(...joins.params,...visible.params, startId, Number.isFinite(options.seed) ? Number(options.seed) >>> 0 : 0, limit, offset) as unknown as ShortsItem[];
    const total = Number((this.db.prepare(`SELECT COUNT(*) c FROM media m WHERE ${visible.sql} AND ${cond}`).get(...visible.params) as {c:number}).c);
    const start=startId?this.getMedia(startId,scope):undefined;
    return { items, total, ...(start&&items[0]&&this.pathKey(items[0].path)===this.pathKey(start.path)?{startId:items[0].id}:{}) };
  }

  getFolders(scope?: CatalogScope): FolderEntry[] {
    const visible = this.catalogClause(scope);
    return this.db.prepare(`
      SELECT library_id, folder, COUNT(*) AS count FROM media m
      WHERE ${visible.sql}
      GROUP BY library_id, folder ORDER BY folder COLLATE NOCASE
    `).all(...visible.params) as unknown as FolderEntry[];
  }

  setLike(mediaId: number, liked: boolean, userId?: number) {
    if (userId !== undefined) {
      if (liked) this.db.prepare('INSERT OR IGNORE INTO user_likes(user_id,media_id,created_at) VALUES(?,?,?)').run(userId,mediaId,Date.now());
      else this.db.prepare(`DELETE FROM user_likes WHERE user_id=? AND media_id IN (SELECT id FROM media WHERE path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''})`).run(userId,mediaId);
      return;
    }
    if (liked) this.db.prepare('INSERT OR IGNORE INTO likes(media_id,created_at) VALUES(?,?)').run(mediaId, Date.now());
    else this.db.prepare(`DELETE FROM likes WHERE media_id IN (SELECT id FROM media WHERE path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''})`).run(mediaId);
  }

  setProgress(mediaId: number, position: number, duration: number, userId?: number) {
    const safePosition = Number.isFinite(position) ? Math.max(position, 0) : 0;
    const safeDuration = Number.isFinite(duration) ? Math.max(duration, 0) : 0;
    const completed = safeDuration > 0 && safePosition / safeDuration >= 0.92 ? 1 : 0;
    if (userId !== undefined) {
      this.db.prepare(`INSERT INTO user_progress(user_id,media_id,position,duration,completed,updated_at)
        SELECT ?,id,?,?,?,? FROM media WHERE path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''}
        ON CONFLICT(user_id,media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=excluded.updated_at`)
        .run(userId,safePosition,safeDuration,completed,Date.now(),mediaId);
      return;
    }
    this.db.prepare(`INSERT INTO progress(media_id,position,duration,completed,updated_at)
      SELECT id,?,?,?,? FROM media WHERE path=(SELECT path FROM media WHERE id=?) ${process.platform==='win32'?'COLLATE NOCASE':''}
      ON CONFLICT(media_id) DO UPDATE SET position=excluded.position,duration=excluded.duration,completed=excluded.completed,updated_at=excluded.updated_at`)
      .run(safePosition,safeDuration,completed,Date.now(),mediaId);
  }
}

function shortsRank(id: number, seed: number) {
  let hash = (id ^ seed) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x7feb352d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x846ca68b);
  return (hash ^ (hash >>> 16)) >>> 0;
}
