import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Account, AccountPermissions, CatalogScope } from './auth-types.js';
import { DEFAULT_APPEARANCE, normalizeAppearance, type Appearance } from './appearance.js';

export class AccountError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}

export const defaultPermissions: AccountPermissions = {
  manageLibraries: false, scanLibraries: false, manageMetadata: false, play: true, transcode: true
};
const lifetime = 7 * 86400_000;
const idleTime = 86400_000;
let hashing = 0;

async function derive(password: string, salt: string) {
  if (hashing >= 2) throw new AccountError('Authentication is busy. Please try again shortly.', 429);
  hashing++;
  try {
    return await new Promise<Buffer>((resolve, reject) => scrypt(password, salt, 64,
      { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key)));
  } finally { hashing--; }
}

export function validatePassword(value: unknown): string {
  if (typeof value !== 'string' || !value.length || Buffer.byteLength(value) > 1024)
    throw new AccountError('Enter a password or PIN (up to 1024 bytes).');
  return value;
}
export async function hashPassword(value: unknown) {
  const password = validatePassword(value), salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(value: unknown, encoded?: string) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > 1024) return false;
  // Unknown accounts pay the same hashing cost; never expose an account directory at login.
  const [, salt = '00000000000000000000000000000000', expected = '00'.repeat(64)] = (encoded || '').split('$');
  const key = await derive(value, salt), target = Buffer.from(expected, 'hex');
  return Boolean(encoded) && target.length === key.length && timingSafeEqual(key, target);
}

function name(value: unknown, label: string, limit: number) {
  if (typeof value !== 'string') throw new AccountError(`${label} is required.`);
  const text = value.normalize('NFKC').trim();
  if (!text || [...text].length > limit || /[\p{Cc}\p{Cf}]/u.test(text)) throw new AccountError(`${label} must contain 1–${limit} visible characters.`);
  return text;
}
export const usernameKey = (value: string) => value.normalize('NFKC').trim().toLowerCase();
export const sessionDigest = (value: string) => createHash('sha256').update(value).digest('hex');

type Row = { id: number; username: string; display_name: string; password_hash: string; is_admin: number;
  enabled: number; all_libraries: number; permissions: string; revision: number; created_at: number };

export class Accounts {
  constructor(readonly db: DatabaseSync) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL, password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1, all_libraries INTEGER NOT NULL DEFAULT 0,
        permissions TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_libraries (
        user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        library_id INTEGER NOT NULL REFERENCES libraries(id) ON DELETE CASCADE, PRIMARY KEY(user_id,library_id)
      );
      CREATE TABLE IF NOT EXISTS account_sessions (
        digest TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS account_sessions_user ON account_sessions(user_id);
      CREATE TABLE IF NOT EXISTS account_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS account_appearance (
        user_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        controller_style TEXT NOT NULL, accent_color TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS user_progress (
        user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        position REAL NOT NULL DEFAULT 0, duration REAL NOT NULL DEFAULT 0, completed INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,media_id)
      );
      CREATE TABLE IF NOT EXISTS user_likes (
        user_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        media_id INTEGER NOT NULL REFERENCES media(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL, PRIMARY KEY(user_id,media_id)
      );
    `);
    if (!(db.prepare('PRAGMA table_info(account_sessions)').all() as {name:string}[]).some(column=>column.name==='activity_notice_revision'))
      db.exec('ALTER TABLE account_sessions ADD COLUMN activity_notice_revision INTEGER NOT NULL DEFAULT 0');
  }
  private transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  hasAccounts() { return Boolean(this.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()); }
  appearance(id: number): Appearance {
    const row = this.db.prepare('SELECT controller_style,accent_color FROM account_appearance WHERE user_id=?').get(id) as {controller_style:string;accent_color:string}|undefined;
    return row ? normalizeAppearance({controllerStyle:row.controller_style,accentColor:row.accent_color}) : {...DEFAULT_APPEARANCE};
  }
  saveAppearance(id: number, value: Appearance): Appearance {
    const appearance = normalizeAppearance(value);
    this.db.prepare('INSERT INTO account_appearance VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET controller_style=excluded.controller_style,accent_color=excluded.accent_color').run(id,appearance.controllerStyle,appearance.accentColor);
    return appearance;
  }
  passwordHash(id: number) { return (this.db.prepare('SELECT password_hash FROM accounts WHERE id=?').get(id) as {password_hash: string} | undefined)?.password_hash; }
  findUsername(username: string) { return (this.db.prepare('SELECT id FROM accounts WHERE username_key=?').get(usernameKey(username)) as {id: number} | undefined)?.id; }
  get(id: number): Account | undefined {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id=?').get(id) as Row | undefined;
    if (!row) return;
    const permissions = JSON.parse(row.permissions) as AccountPermissions;
    return { id: row.id, username: row.username, displayName: row.display_name, isAdmin: Boolean(row.is_admin),
      enabled: Boolean(row.enabled), allLibraries: Boolean(row.all_libraries), revision: row.revision, createdAt: row.created_at,
      permissions: row.is_admin ? Object.fromEntries(Object.keys(defaultPermissions).map(key => [key, true])) as unknown as AccountPermissions : permissions,
      libraryIds: (this.db.prepare('SELECT library_id FROM account_libraries WHERE user_id=? ORDER BY library_id').all(id) as {library_id: number}[]).map(row => row.library_id) };
  }
  list() { return (this.db.prepare('SELECT id FROM accounts ORDER BY created_at,id').all() as {id: number}[]).map(row => this.get(row.id)!); }
  scope(user: Account): CatalogScope { return { userId: user.id, libraryIds: user.allLibraries ? null : user.libraryIds }; }

  save(input: Record<string, unknown>, passwordHash?: string, id?: number, first = false): Account {
    if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) throw new AccountError('Invalid account ID.');
    return this.transaction(() => {
      if (first && this.hasAccounts()) throw new AccountError('An administrator has already been created.', 409);
      const previous = id === undefined ? undefined : this.get(id);
      if (id !== undefined && !previous) throw new AccountError('Account not found.', 404);
      if (previous && input.revision !== undefined && input.revision !== previous.revision) throw new AccountError('This account changed elsewhere. Reload the user before saving.', 409);
      const username = name(input.username ?? previous?.username, 'Username', 64);
      const displayName = name(input.displayName ?? previous?.displayName ?? username, 'Display name', 80);
      const duplicate = this.findUsername(username);
      if (duplicate !== undefined && duplicate !== id) throw new AccountError('This username is already in use.', 409);
      for (const key of ['isAdmin', 'enabled', 'allLibraries']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new AccountError(`Invalid ${key}.`);
      const isAdmin = first || (input.isAdmin ?? previous?.isAdmin ?? false) as boolean;
      const enabled = (input.enabled ?? previous?.enabled ?? true) as boolean;
      const allLibraries = first || (input.allLibraries ?? previous?.allLibraries ?? false) as boolean;
      const stored = previous ? JSON.parse((this.db.prepare('SELECT permissions FROM accounts WHERE id=?').get(previous.id) as {permissions:string}).permissions) as AccountPermissions : {};
      const permissions = { ...defaultPermissions, ...stored };
      if (input.permissions !== undefined) {
        if (!input.permissions || typeof input.permissions !== 'object' || Array.isArray(input.permissions)) throw new AccountError('Invalid permissions.');
        for (const [key, value] of Object.entries(input.permissions)) {
          if (!Object.hasOwn(defaultPermissions, key) || typeof value !== 'boolean') throw new AccountError('Invalid permission.');
          permissions[key as keyof AccountPermissions] = value;
        }
      }
      const libraryIds = input.libraryIds ?? previous?.libraryIds ?? [];
      if (!Array.isArray(libraryIds) || libraryIds.length > 1000 || libraryIds.some(id => !Number.isSafeInteger(id) || id <= 0 || !this.db.prepare('SELECT 1 FROM libraries WHERE id=?').get(id))) throw new AccountError('Choose valid libraries.');
      if (previous?.isAdmin && previous.enabled && (!isAdmin || !enabled)) this.protectLastAdmin();
      if (previous) {
        this.db.prepare(`UPDATE accounts SET username=?,username_key=?,display_name=?,password_hash=?,is_admin=?,enabled=?,all_libraries=?,permissions=?,revision=revision+1 WHERE id=?`)
          .run(username, usernameKey(username), displayName, passwordHash ?? this.passwordHash(previous.id)!, Number(isAdmin), Number(enabled), Number(allLibraries), JSON.stringify(permissions), previous.id);
      } else {
        if (!passwordHash) throw new AccountError('Password is required.');
        id = Number(this.db.prepare(`INSERT INTO accounts(username,username_key,display_name,password_hash,is_admin,enabled,all_libraries,permissions,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
          .run(username, usernameKey(username), displayName, passwordHash, Number(isAdmin), Number(enabled), Number(allLibraries), JSON.stringify(permissions), Date.now()).lastInsertRowid);
      }
      this.db.prepare('DELETE FROM account_libraries WHERE user_id=?').run(id!);
      const grant = this.db.prepare('INSERT INTO account_libraries(user_id,library_id) VALUES(?,?)');
      for (const libraryId of new Set(libraryIds)) grant.run(id!, libraryId);
      if (first) {
        this.db.prepare('INSERT INTO user_progress SELECT ?,media_id,position,duration,completed,updated_at FROM progress').run(id!);
        this.db.prepare('INSERT INTO user_likes SELECT ?,media_id,created_at FROM likes').run(id!);
      }
      this.revoke(id!);
      return this.get(id!)!;
    });
  }
  private protectLastAdmin() {
    if (Number((this.db.prepare('SELECT COUNT(*) n FROM accounts WHERE is_admin=1 AND enabled=1').get() as {n: number}).n) <= 1)
      throw new AccountError('Keep at least one enabled administrator. Create another administrator first.', 409);
  }
  remove(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccountError('Invalid account ID.');
    this.transaction(() => {
      const user = this.get(id);
      if (!user) throw new AccountError('Account not found.', 404);
      if (user.isAdmin && user.enabled) this.protectLastAdmin();
      this.db.prepare('DELETE FROM accounts WHERE id=?').run(id);
    });
  }
  grantLibrary(id: number, libraryId: number) { this.db.prepare('INSERT OR IGNORE INTO account_libraries VALUES(?,?)').run(id, libraryId); }
  revoke(id: number) { this.db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(id); }
  createSession(user: Account) {
    const now = Date.now(), token = randomBytes(32).toString('base64url');
    this.db.prepare('DELETE FROM account_sessions WHERE expires_at<=? OR last_seen<=?').run(now, now - idleTime);
    this.db.prepare('INSERT INTO account_sessions(digest,user_id,revision,expires_at,last_seen) VALUES(?,?,?,?,?)').run(sessionDigest(token), user.id, user.revision, now + lifetime, now);
    this.db.prepare('DELETE FROM account_sessions WHERE user_id=? AND digest NOT IN (SELECT digest FROM account_sessions WHERE user_id=? ORDER BY last_seen DESC,rowid DESC LIMIT 32)').run(user.id,user.id);
    return token;
  }
  session(token: string | undefined, now = Date.now()) {
    if (!token || !/^[\w-]{43}$/.test(token)) return;
    const digest = sessionDigest(token);
    const row = this.db.prepare('SELECT * FROM account_sessions WHERE digest=?').get(digest) as {user_id: number; revision: number; expires_at: number; last_seen: number} | undefined;
    if (!row || row.expires_at <= now || row.last_seen + idleTime <= now) return;
    const user = this.get(row.user_id);
    if (!user?.enabled || user.revision !== row.revision) return;
    if (row.last_seen + 60_000 < now) this.db.prepare('UPDATE account_sessions SET last_seen=? WHERE digest=?').run(now, digest);
    return user;
  }
  logout(token: string) { this.db.prepare('DELETE FROM account_sessions WHERE digest=?').run(sessionDigest(token)); }
  adminLocalOnly() { return this.db.prepare("SELECT value FROM account_config WHERE key='adminLocalOnly'").get()?.value === 'true'; }
  setAdminLocalOnly(value: boolean) {
    this.db.prepare("INSERT INTO account_config VALUES('adminLocalOnly',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(value));
    this.db.exec('DELETE FROM account_sessions WHERE user_id IN (SELECT id FROM accounts WHERE is_admin=1)');
  }
}
