import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { VireloDB } from './db.js';
import { parseQueueSession, restrictQueueSession, validQueueSessionKey, type QueueSession } from './queue-session-values.js';

export function registerQueueSessions(app: FastifyInstance, db: VireloDB) {
  const sql = db.db;
  sql.exec(`CREATE TABLE IF NOT EXISTS queue_sessions (
    user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    key TEXT NOT NULL, value TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,key));`);
  const scope = (request: FastifyRequest) => {
    if (!request.account || !request.catalogScope) throw Object.assign(new Error('Sign in to resume a queue.'), { statusCode: 401 });
    return request.catalogScope;
  };
  const read = (value: string): QueueSession | null => {
    try { const parsed = JSON.parse(value); return { ...parseQueueSession(parsed), updatedAt: parsed.updatedAt }; }
    catch { return null; }
  };
  const source = (session: QueueSession, userId: number) => {
    if (!session.playlistId) return session.state.sourceIds;
    if (!sql.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').get(session.playlistId, userId)) return [];
    return (sql.prepare('SELECT media_id FROM playlist_items WHERE playlist_id=? ORDER BY position').all(session.playlistId) as { media_id: number }[]).map(row => row.media_id);
  };
  app.get('/api/queue-sessions', async request => {
    const owner = scope(request);
    const rows = sql.prepare('SELECT value FROM queue_sessions WHERE user_id=? ORDER BY updated_at DESC LIMIT 12').all(owner.userId) as { value: string }[];
    return rows.flatMap(row => {
      const session = read(row.value);
      if (!session) return [];
      const ids = source(session, owner.userId), allowed = new Set(ids);
      let item = allowed.has(session.state.selectedId) ? db.getMedia(session.state.selectedId, owner) : undefined;
      if (!item) {
        const available = db.getMediaByIds(session.state.ids.filter(id => allowed.has(id)), owner);
        const safe = restrictQueueSession(session, available.map(item => item.id));
        item = available.find(item => item.id === safe?.state.selectedId);
      }
      if (!item) return [];
      const playlist = session.playlistId ? sql.prepare('SELECT name FROM playlists WHERE id=? AND user_id=?').get(session.playlistId, owner.userId) as { name: string } | undefined : undefined;
      return [{ key: session.key, playlistId: session.playlistId, label: playlist?.name, updatedAt: session.updatedAt, item }];
    });
  });
  app.get<{ Params: { key: string } }>('/api/queue-sessions/:key', async (request, reply) => {
    const owner = scope(request), key = request.params.key;
    const row = validQueueSessionKey(key) ? sql.prepare('SELECT value FROM queue_sessions WHERE user_id=? AND key=?').get(owner.userId, key) as { value: string } | undefined : undefined;
    const stored = row && read(row.value);
    if (!stored) return reply.code(404).send({ error: 'Saved queue not found.' });
    const items = db.getMediaByIds(source(stored, owner.userId), owner);
    const session = restrictQueueSession(stored, items.map(item => item.id));
    if (!session) return reply.code(404).send({ error: 'Saved queue not found.' });
    return { ...session, items };
  });
  app.put('/api/queue-sessions', async request => {
    const owner = scope(request), session = parseQueueSession(request.body);
    if (session.playlistId && !sql.prepare('SELECT id FROM playlists WHERE id=? AND user_id=?').get(session.playlistId, owner.userId))
      throw Object.assign(new Error('Playlist not found.'), { statusCode: 404 });
    const items = db.getMediaByIds(source(session, owner.userId), owner);
    const safe = restrictQueueSession(session, items.map(item => item.id));
    if (!safe) return { ok: false };
    sql.exec('BEGIN IMMEDIATE');
    try {
      sql.prepare('INSERT INTO queue_sessions(user_id,key,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(user_id,key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
        .run(owner.userId, safe.key, JSON.stringify(safe), safe.updatedAt);
      sql.prepare('DELETE FROM queue_sessions WHERE user_id=? AND key NOT IN (SELECT key FROM queue_sessions WHERE user_id=? ORDER BY updated_at DESC,key LIMIT 12)').run(owner.userId, owner.userId);
      sql.exec('COMMIT');
    } catch (error) { sql.exec('ROLLBACK'); throw error; }
    return { ok: true };
  });
  app.delete<{ Params: { key: string } }>('/api/queue-sessions/:key', async request => {
    const owner = scope(request);
    sql.prepare('DELETE FROM queue_sessions WHERE user_id=? AND key=?').run(owner.userId, request.params.key);
    return { ok: true };
  });
}
