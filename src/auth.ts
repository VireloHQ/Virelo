import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AccountError, Accounts, hashPassword, verifyPassword } from './accounts.js';
import type { Account, AuthStatus, CatalogScope } from './auth-types.js';
import type { VireloDB } from './db.js';
import { isIP } from 'node:net';

declare module 'fastify' {
  interface FastifyRequest { account: Account | null; catalogScope: CatalogScope | null }
}

export function directLocal(request: FastifyRequest) {
  const peer = request.raw.socket.remoteAddress || request.ip;
  const hostHeader = (request.headers.host || '').toLowerCase();
  const host = hostHeader.startsWith('[') ? hostHeader.slice(1,hostHeader.indexOf(']')) : hostHeader.split(':')[0].replace(/\.$/,'');
  // Requiring a literal loopback Host also prevents rebinding a LAN hostname during setup.
  const localHost = host === 'localhost' || host === '::1' || (isIP(host) === 4 && host.startsWith('127.'));
  return localHost && Boolean(peer && (/^127\./.test(peer) || peer === '::1' || /^::ffff:127\./i.test(peer)))
    && !['forwarded','x-forwarded-for','x-real-ip','x-forwarded-host','x-forwarded-proto'].some(header => request.headers[header] !== undefined);
}
function token(request: FastifyRequest) {
  const matches = (request.headers.cookie || '').split(';').map(part => part.trim()).filter(part => part.startsWith('virelo_session='));
  return matches.length === 1 ? matches[0].slice('virelo_session='.length) : undefined;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError('A JSON object is required.');
  return value as Record<string, unknown>;
}

export function registerAccounts(app: FastifyInstance, db: VireloDB, isPublicHost: (host: string) => boolean = () => false) {
  const cookie = (reply: FastifyReply, request: FastifyRequest, value = '') => {
    const secure = request.protocol === 'https' || process.env.VIRELO_SECURE_COOKIES === '1' || isPublicHost(request.hostname.toLowerCase());
    reply.header('Set-Cookie', `virelo_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value ? 604800 : 0}${secure ? '; Secure' : ''}`);
  };
  const accounts = new Accounts(db.db);
  app.decorateRequest('account', null);
  app.decorateRequest('catalogScope', null);
  const attempts = new Map<string, { count: number; until: number }>();
  const streams = new Map<number, Set<{reply:FastifyReply;token:string|undefined}>>();
  const disconnect = (id: number, session?:string) => {
    const active = streams.get(id);
    active?.forEach(entry => { if (!session || entry.token === session) { entry.reply.raw.destroy(); active.delete(entry); } });
    if (!active?.size) streams.delete(id);
  };
  const throttle = (request: FastifyRequest) => {
    const now = Date.now(), key = request.ip;
    for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
    const entry = attempts.get(key) || { count: 0, until: now + 300_000 };
    if (entry.count >= 12 || (!attempts.has(key) && attempts.size >= 2048)) throw new AccountError('Too many attempts. Try again in five minutes.', 429);
    entry.count++; attempts.set(key, entry);
  };
  const fresh = (request: FastifyRequest, admin = false) => {
    const user = accounts.session(token(request));
    if (!user || (user.isAdmin && accounts.adminLocalOnly() && !directLocal(request))) throw new AccountError('Please sign in again.', 401);
    if (admin && !user.isAdmin) throw new AccountError('Administrator access is required.', 403);
    return user;
  };
  const status = (request: FastifyRequest): AuthStatus => ({ setupRequired: !accounts.hasAccounts(), localAccess: directLocal(request), user: request.account });
  const beginSession = (request: FastifyRequest, reply: FastifyReply, user: Account) => {
    cookie(reply, request, accounts.createSession(user));
    request.account = user;
    return status(request);
  };

  app.addHook('onRequest', async (request, reply) => {
    const path = request.routeOptions.url ?? new URL(request.url, 'http://localhost').pathname;
    const protectedPath = /^\/(?:api|hls|audio|playback)(?:\/|$)/.test(path);
    if (!protectedPath) return;
    reply.header('Cache-Control', 'private, no-store');
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && request.headers['x-virelo-request'] !== '1')
      return reply.code(403).send({ error: 'A same-origin Virelo request is required.' });
    const candidate = accounts.session(token(request));
    const blocked = candidate?.isAdmin && accounts.adminLocalOnly() && !directLocal(request);
    request.account = blocked ? null : candidate ?? null;
    request.catalogScope = request.account ? accounts.scope(request.account) : null;
    if (['/api/auth/status','/api/auth/setup','/api/auth/login','/api/auth/logout'].includes(path)) return;
    const user = request.account;
    if (!user) return reply.code(401).send({ error: blocked ? 'Administrator access is limited to localhost.' : 'Sign in to access this server.', code: 'SESSION_REVOKED' });
    const deny = () => reply.code(403).send({ error: 'Your account does not have permission for this action.' });
    if (/^\/api\/accounts(?:\/|$)/.test(path) && !user.isAdmin) return deny();
    if (/^\/api\/data(?:\/|$)/.test(path) && !user.isAdmin) return deny();
    if ((path === '/api/settings' && request.method !== 'GET') || path === '/api/metadata') { if (!user.isAdmin) return deny(); }
    if (path === '/api/libraries' && request.method === 'POST' || /^\/api\/libraries\//.test(path)) {
      if (!user.permissions.manageLibraries) return deny();
      if (request.method === 'DELETE' && !db.visibleLibraries(request.catalogScope!).some(library => library.id === Number((request.params as {id: string}).id))) return reply.code(404).send({ error: 'Not found.' });
    }
    if (path === '/api/scan' && !user.permissions.scanLibraries) return deny();
    const resource = /^\/(hls|audio|playback)\//.test(path);
    const mediaRoute = request.routeOptions.url?.startsWith('/api/media/:id');
    if (resource || mediaRoute) {
      const params = request.params as { id?: string; '*'?: string };
      if (resource && params['*'] && (/[\\%]/.test(params['*']) || params['*'].split('/').some(part => part === '.' || part === '..')))
        return reply.code(404).send({error:'Media not found.'});
      const id = Number(params.id ?? params['*']?.split('/')[0]);
      if (!Number.isSafeInteger(id) || !db.getMedia(id, request.catalogScope!)) return reply.code(404).send({ error: 'Media not found.' });
      const playing = resource || /\/(?:stream|playback|subtitles|transcode|quality|audio)(?:\/|$)/.test(path.replace(/^\/api\/media\/[^/]+/, ''));
      if (playing && !user.permissions.play) return deny();
      if ((path.startsWith('/playback/') || /\/(?:transcode|quality|audio)\//.test(path)) && !user.permissions.transcode) return deny();
      if (/\/metadata(?:\/|$)/.test(path) && !user.permissions.manageMetadata) return deny();
      if (resource || path.endsWith('/stream')) {
        const active = streams.get(user.id) || new Set<{reply:FastifyReply;token:string|undefined}>();
        const entry = {reply,token:token(request)};
        active.add(entry); streams.set(user.id, active);
        reply.raw.once('close', () => { active.delete(entry); if (!active.size && streams.get(user.id) === active) streams.delete(user.id); });
      }
    }
  });
  app.addHook('onSend', async (request, reply, payload) => {
    if (/^\/(?:api|hls|audio|playback)(?:\/|$)/.test(new URL(request.url, 'http://localhost').pathname)) reply.header('Cache-Control', 'private, no-store');
    // A viewer needs artwork URLs and labels, not the server's filesystem layout.
    if (request.account && !request.account.permissions.manageLibraries && typeof payload === 'string' && String(reply.getHeader('Content-Type')).includes('application/json')) {
      return JSON.stringify(JSON.parse(payload), (key, value) => key === 'path' ? ''
        : ['thumbnail_path','poster_path','backdrop_path'].includes(key) && value ? 'available' : value);
    }
    return payload;
  });

  app.get('/api/auth/status', async request => status(request));
  app.post('/api/auth/setup', async (request, reply) => {
    if (!directLocal(request)) throw new AccountError('Create the first administrator on this PC using localhost.', 403);
    if (accounts.hasAccounts()) throw new AccountError('Setup is already complete.', 409);
    throttle(request);
    const body = object(request.body), password = await hashPassword(body.password);
    return beginSession(request, reply, accounts.save({ username: body.username, displayName: body.displayName }, password, undefined, true));
  });
  app.post('/api/auth/login', async (request, reply) => {
    throttle(request);
    const body = object(request.body);
    const id = typeof body.username === 'string' && body.username.length <= 256 ? accounts.findUsername(body.username) : undefined;
    const hash = id === undefined ? undefined : accounts.passwordHash(id);
    const valid = await verifyPassword(body.password, hash);
    const user = id === undefined ? undefined : accounts.get(id);
    if (!valid || !user?.enabled || accounts.passwordHash(id!) !== hash) throw new AccountError('Username or password is incorrect.', 401);
    if (user.isAdmin && accounts.adminLocalOnly() && !directLocal(request)) throw new AccountError('Administrator access is limited to localhost.', 403);
    return beginSession(request, reply, user);
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const value = token(request); if (value) { accounts.logout(value); if (request.account) disconnect(request.account.id,value); }
    cookie(reply, request);
    return { ok: true };
  });
  app.patch('/api/auth/me', async (request, reply) => {
    throttle(request);
    const user = fresh(request), body = object(request.body);
    if (!await verifyPassword(body.currentPassword, accounts.passwordHash(user.id))) throw new AccountError('Current password is incorrect.', 400);
    const password = body.password === undefined ? undefined : await hashPassword(body.password);
    fresh(request);
    const updated = accounts.save({ username: body.username, displayName: body.displayName }, password, user.id);
    disconnect(user.id);
    return beginSession(request, reply, updated);
  });
  app.get('/api/accounts', async () => accounts.list());
  app.get('/api/accounts/libraries', async () => db.visibleLibraries());
  app.get('/api/accounts/previous-libraries', async () => db.previousLibraries());
  app.post('/api/accounts', async (request, reply) => {
    const body = object(request.body), password = await hashPassword(body.password);
    fresh(request, true);
    return reply.code(201).send(accounts.save(body, password));
  });
  app.patch<{Params: {id: string}}>('/api/accounts/:id', async request => {
    const body = object(request.body), password = body.password === undefined ? undefined : await hashPassword(body.password);
    fresh(request, true);
    const user = accounts.save(body, password, Number(request.params.id));
    disconnect(user.id);
    return user;
  });
  app.delete<{Params: {id: string}}>('/api/accounts/:id', async request => {
    const id = Number(request.params.id);
    if (id === request.account!.id) throw new AccountError('Sign in as another administrator to delete this account.', 409);
    accounts.remove(id); disconnect(id);
    return { ok: true };
  });
  app.get('/api/accounts/security', async request => ({ adminLocalOnly: accounts.adminLocalOnly(), localAccess: directLocal(request) }));
  app.post('/api/accounts/security', async (request, reply) => {
    if (!directLocal(request)) throw new AccountError('Change this security option from localhost on the server PC.', 403);
    const body = object(request.body);
    if (typeof body.adminLocalOnly !== 'boolean') throw new AccountError('Invalid security option.');
    accounts.setAdminLocalOnly(body.adminLocalOnly);
    for (const user of accounts.list()) if (user.isAdmin) disconnect(user.id);
    cookie(reply, request, accounts.createSession(request.account!));
    return { adminLocalOnly: body.adminLocalOnly, localAccess: true };
  });
  return { accounts, fresh };
}
