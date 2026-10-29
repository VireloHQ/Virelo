import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { VireloDB } from './db.js';
import type { CatalogScope } from './auth-types.js';
import { playlistIds, playlistName, playlistRevision, mergePlaylistIds, type PlaylistSummary } from './playlist-values.js';

class PlaylistError extends Error { constructor(message: string, readonly statusCode = 400) { super(message); } }
type Row = { id: number; user_id: number; name: string; revision: number; created_at: number; updated_at: number };
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PlaylistError('A JSON object is required.');
  return value as Record<string, unknown>;
};

export function registerPlaylists(app: FastifyInstance, db: VireloDB) {
  const sql = db.db;
  sql.exec(`CREATE TABLE IF NOT EXISTS playlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS playlists_owner ON playlists(user_id);
    CREATE TABLE IF NOT EXISTS playlist_items (
      playlist_id INTEGER NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
      media_id INTEGER NOT NULL, position INTEGER NOT NULL, PRIMARY KEY(playlist_id,media_id));`);
  sql.exec('CREATE INDEX IF NOT EXISTS playlist_items_order ON playlist_items(playlist_id,position)');
  const entries = (id: number) => (sql.prepare('SELECT media_id FROM playlist_items WHERE playlist_id=? ORDER BY position').all(id) as { media_id: number }[]).map(row => row.media_id);
  const owner = (id: number, scope: CatalogScope) => {
    if (!Number.isSafeInteger(id) || id <= 0) throw new PlaylistError('Playlist not found.', 404);
    const row = sql.prepare('SELECT * FROM playlists WHERE id=? AND user_id=?').get(id, scope.userId) as Row | undefined;
    if (!row) throw new PlaylistError('Playlist not found.', 404);
    return row;
  };
  const cover = (mediaId:number, revision=0) => ({mediaId,url:`/api/media/${mediaId}/artwork/thumbnail?v=${revision}`});
  const summary = (row: Row, itemCount: number, unavailableCount: number, cover:PlaylistSummary['cover']=null): PlaylistSummary => ({
    id: row.id, name: row.name, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at, itemCount, unavailableCount, cover
  });
  const detail = (id: number, scope: CatalogScope) => {
    const row = owner(id, scope), ids = entries(id), items = db.getMediaByIds(ids, scope);
    return { ...summary(row, items.length, ids.length - items.length,items[0]?cover(items[0].id,items[0].metadata_revision):null), items };
  };
  const writeEntries = (id: number, ids: number[]) => {
    sql.prepare('DELETE FROM playlist_items WHERE playlist_id=?').run(id);
    const insert = sql.prepare('INSERT INTO playlist_items(playlist_id,media_id,position) VALUES(?,?,?)');
    ids.forEach((mediaId, position) => insert.run(id, mediaId, position));
  };
  const normalized = (value: unknown, scope: CatalogScope) => {
    const ids = playlistIds(value), items = db.getMediaByIds(ids, scope);
    if (items.length !== ids.length) throw new PlaylistError('One or more videos are unavailable.', 404);
    return [...new Set(items.map(item => item.canonical_id ?? item.id))];
  };
  const transaction = <T>(operation: () => T) => {
    sql.exec('BEGIN IMMEDIATE');
    try { const result = operation(); sql.exec('COMMIT'); return result; }
    catch (error) { sql.exec('ROLLBACK'); throw error; }
  };
  const scopeOf = (request: FastifyRequest) => {
    if (!request.account || !request.catalogScope) throw new PlaylistError('Sign in to manage playlists.', 401);
    return request.catalogScope;
  };
  app.get('/api/playlists', async request => {
    const scope = scopeOf(request), libraries = db.visibleLibraries(scope).map(library => library.id);
    const rows = sql.prepare(`SELECT p.*,COUNT(m.id) AS available,COUNT(e.media_id)-COUNT(m.id) AS unavailable,
      (SELECT json_array(m2.id,m2.metadata_revision) FROM playlist_items e2 JOIN media m2 ON m2.id=e2.media_id
       WHERE e2.playlist_id=p.id AND m2.library_id IN (SELECT value FROM json_each(?)) ORDER BY e2.position LIMIT 1) AS cover
      FROM playlists p LEFT JOIN playlist_items e ON e.playlist_id=p.id
      LEFT JOIN media m ON m.id=e.media_id AND m.library_id IN (SELECT value FROM json_each(?))
      WHERE p.user_id=? GROUP BY p.id ORDER BY p.updated_at DESC,p.id DESC`).all(JSON.stringify(libraries),JSON.stringify(libraries),scope.userId) as Array<Row & { available: number; unavailable: number; cover:string|null }>;
    return rows.map(row => summary(row, row.available, row.unavailable,row.cover?cover(...JSON.parse(row.cover) as [number,number]):null));
  });
  app.get<{ Params: { id: string } }>('/api/playlists/:id', async request => detail(Number(request.params.id), scopeOf(request)));
  app.post('/api/playlists', async request => {
    const scope = scopeOf(request), body = object(request.body);
    const id = transaction(() => {
      if (Number((sql.prepare('SELECT COUNT(*) AS total FROM playlists WHERE user_id=?').get(scope.userId) as {total:number}).total) >= 1000)
        throw new PlaylistError('You can save up to 1,000 playlists.');
      const name = playlistName(body.name), ids = normalized(body.mediaIds ?? [], scope), now = Date.now();
      const result = sql.prepare('INSERT INTO playlists(user_id,name,created_at,updated_at) VALUES(?,?,?,?)').run(scope.userId, name, now, now);
      const id = Number(result.lastInsertRowid); writeEntries(id, ids); return id;
    });
    return detail(id, scope);
  });
  app.patch<{ Params: { id: string } }>('/api/playlists/:id', async request => {
    const scope = scopeOf(request), id = Number(request.params.id), body = object(request.body);
    transaction(() => {
      const row = owner(id, scope);
      if (playlistRevision(body.revision) !== row.revision) throw new PlaylistError('This playlist changed elsewhere. Reload it before saving again.', 409);
      if (body.append !== undefined && typeof body.append !== 'boolean') throw new PlaylistError('Append must be a boolean.');
      if (body.mediaIds !== undefined) {
        const previous = entries(id), available = new Set(db.getMediaByIds(previous, scope).map(item => item.id));
        writeEntries(id, mergePlaylistIds(previous, normalized(body.mediaIds, scope), available, body.append === true));
      }
      sql.prepare('UPDATE playlists SET name=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?')
        .run(body.name === undefined ? row.name : playlistName(body.name), Date.now(), id, scope.userId);
    });
    return detail(id, scope);
  });
  app.delete<{ Params: { id: string } }>('/api/playlists/:id', async request => {
    const scope = scopeOf(request), id = Number(request.params.id), body = object(request.body);
    transaction(() => {
      const row = owner(id, scope);
      if (playlistRevision(body.revision) !== row.revision) throw new PlaylistError('This playlist changed elsewhere. Reload it before deleting it.', 409);
      sql.prepare('DELETE FROM playlists WHERE id=? AND user_id=?').run(id, scope.userId);
    });
    return { ok: true };
  });
}
