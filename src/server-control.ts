import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createConnection, createServer, type Server } from 'node:net';
import { chmod, lstat, mkdir, open, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { userInfo } from 'node:os';
import { join } from 'node:path';

export interface ControlProfile {
  dataDir: string;
  endpoint: string;
  controlDir: string;
  tokenFile: string;
  lockDir: string;
}

export interface ServerSnapshot {
  pid: number;
  url: string;
  version: string;
  startedAt: number;
  libraries: number;
  media: number;
  scanRunning: boolean;
  host: string;
  port: number;
  dataDir: string;
  restartSupported?: boolean;
}

export interface ManagedLibrary { id: number; label: string; path: string; persistent: number }
export type ControlAction = 'status' | 'stop' | 'restart' | 'scan' | 'addMedia' | 'libraries';
export type ControlRequest = { action: ControlAction; path?: string };
export type ControlReply =
  | { ok: true; status: ServerSnapshot; message?: string; libraries?: ManagedLibrary[] }
  | { ok: false; error: string };

const MAX_MESSAGE_BYTES = 16384;
const MAX_RESPONSE_BYTES = 256 * 1024;
const PROTOCOL_VERSION = 1;
const LOCAL_SOCKET_TIMEOUT_MS = 2500;

export async function controlProfile(dataDir: string): Promise<ControlProfile> {
  await mkdir(dataDir, { recursive: true });
  const canonical = await realpath(dataDir);
  const controlDir = join(canonical, '.control');
  const owner = process.getuid?.() ?? userInfo().username;
  const id = createHash('sha256').update(`${owner}\0${process.platform}\0${process.platform === 'win32' ? canonical.toLowerCase() : canonical}`).digest('hex').slice(0, 32);
  const endpoint = process.platform === 'win32'
    ? `\\\\.\\pipe\\virelo-${id}`
    : join('/tmp', `virelo-${owner}`, `${id}.sock`);
  if (process.platform !== 'win32') {
    const runtimeDir = join('/tmp', `virelo-${owner}`);
    try { await mkdir(runtimeDir, { mode: 0o700 }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    const runtime = await lstat(runtimeDir);
    if (!runtime.isDirectory() || runtime.isSymbolicLink() || runtime.uid !== process.getuid?.() || (runtime.mode & 0o077) !== 0)
      throw new Error('Unsafe Virelo IPC directory permissions.');
  }
  return { dataDir: canonical, endpoint, controlDir, tokenFile: join(controlDir, 'key'), lockDir: join(controlDir, 'starting') };
}

async function token(profile: ControlProfile, create: boolean): Promise<string | null> {
  if (create) {
    await mkdir(profile.controlDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      const info = await stat(profile.controlDir);
      if (process.getuid && info.uid !== process.getuid())
        throw new Error('Virelo control directory is not owned by the current user.');
      await chmod(profile.controlDir, 0o700);
    }
  }
  if (create) {
    try {
      await writeFile(profile.tokenFile, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  let value: string;
  try { value = (await readFile(profile.tokenFile, 'utf8')).trim(); }
  catch (error) {
    if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid Virelo control key. Check data directory permissions.');
  if (process.platform !== 'win32') {
    const info = await stat(profile.tokenFile);
    if (info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0)
      throw new Error('Unsafe Virelo control key permissions.');
  }
  return value;
}

function identicalToken(expected: string, supplied: unknown): boolean {
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied)) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function isNoServer(error: unknown): boolean {
  return ['ENOENT', 'ECONNREFUSED', 'ENXIO'].includes((error as NodeJS.ErrnoException)?.code ?? '');
}

export async function sendControl(profile: ControlProfile, request: ControlRequest, timeout = LOCAL_SOCKET_TIMEOUT_MS): Promise<ControlReply | null> {
  const secret = await token(profile, false);
  if (!secret) return null;
  return await new Promise<ControlReply | null>((resolve, reject) => {
    let settled = false;
    let received = '';
    const socket = createConnection(profile.endpoint);
    socket.setEncoding('utf8');
    const finish = (value: ControlReply | null, error?: Error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.setTimeout(timeout, () => finish(null, new Error('Virelo control socket timed out.')));
    socket.on('error', error => {
      if (isNoServer(error)) finish(null);
      else finish(null, error);
    });
    socket.on('connect', () => socket.write(JSON.stringify({ v: PROTOCOL_VERSION, key: secret, ...request }) + '\n'));
    socket.on('data', chunk => {
      received += String(chunk);
      if (Buffer.byteLength(received) > MAX_RESPONSE_BYTES) return finish(null, new Error('Oversized control response.'));
      const end = received.indexOf('\n');
      if (end === -1) return;
      try {
        const value = JSON.parse(received.slice(0, end)) as ControlReply;
        if (typeof value?.ok !== 'boolean') throw new Error('Invalid response.');
        finish(value);
      } catch { finish(null, new Error('Invalid Virelo control response.')); }
    });
    socket.on('end', () => { if (!settled) finish(null, new Error('Control server closed the connection.')); });
  });
}

export async function acquireStartupLock(profile: ControlProfile): Promise<() => Promise<void>> {
  await mkdir(profile.controlDir, { recursive: true, mode: 0o700 });
  let acquired = false;
  try { await mkdir(profile.lockDir, { mode: 0o700 }); acquired = true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  if (!acquired) {
    // Only reclaim locks abandoned for at least 90 seconds, not locks held by
    // a concurrently launching instance. Do not delete a live socket.
    try {
      const info = await stat(profile.lockDir);
      if (Date.now() - info.mtimeMs > 90000 && !(await sendControl(profile, { action: 'status' }))) {
        await rm(profile.lockDir, { recursive: true, force: true });
        await mkdir(profile.lockDir, { mode: 0o700 });
        acquired = true;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  if (!acquired) throw new Error('Virelo is already starting. Try again shortly.');
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    await rm(profile.lockDir, { recursive: true, force: true });
  };
}

export async function createControlServer(
  profile: ControlProfile,
  handler: (request: ControlRequest) => Promise<ControlReply>
): Promise<{ close: () => Promise<void> }> {
  const secret = await token(profile, true);
  if (!secret) throw new Error('Missing Virelo control key.');
  const server: Server = createServer(socket => {
    socket.setEncoding('utf8');
    socket.setTimeout(10000, () => socket.destroy());
    let raw = '';
    let processing = false;
    socket.on('data', chunk => {
      if (processing) return;
      raw += String(chunk);
      if (Buffer.byteLength(raw) > MAX_MESSAGE_BYTES) { socket.destroy(); return; }
      const nl = raw.indexOf('\n');
      if (nl < 0) return;
      processing = true;
      void (async () => {
        let result: ControlReply;
        try {
          const message = JSON.parse(raw.slice(0, nl)) as { v?: number; key?: string; action?: ControlAction; path?: string };
          if (message.v !== PROTOCOL_VERSION) result = { ok: false, error: 'Incompatible Virelo control protocol.' };
          else if (!identicalToken(secret, message.key)) result = { ok: false, error: 'Not authorized.' };
          else if (!['status','stop','restart','scan','addMedia','libraries'].includes(message.action ?? ''))
            result = { ok: false, error: 'Unknown management command.' };
          else result = await handler({ action: message.action!, ...(message.path !== undefined ? { path: message.path } : {}) });
        } catch { result = { ok: false, error: 'Invalid control request.' }; }
        let response=JSON.stringify(result)+'\n';
        if(Buffer.byteLength(response)>MAX_RESPONSE_BYTES)response=JSON.stringify({ok:false,error:'Management response is too large.'})+'\n';
        socket.end(response);
      })().catch(() => socket.destroy());
    });
  });
  // An orphaned Unix socket may survive a crash. Only unlink it when it cannot
  // be reached; never replace a socket belonging to a live server.
  if (process.platform !== 'win32') {
    try { await stat(profile.endpoint); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const existing = await sendControl(profile, { action: 'status' });
    if (existing) throw new Error('A Virelo server is already running for this data directory.');
    await rm(profile.endpoint, { force: true });
  }
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(profile.endpoint, () => { server.off('error', reject); resolve(); });
    });
    if (process.platform !== 'win32') await chmod(profile.endpoint, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  let closed = false;
  return {
    close: async () => {
      if (closed) return;
      closed = true;
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (process.platform !== 'win32') await rm(profile.endpoint, { force: true });
    }
  };
}

export async function readRecentLog(profile: ControlProfile, limit = 60): Promise<string> {
  const file = join(profile.controlDir, 'server.log');
  let value = '';
  try {
    const fileHandle = await open(file, 'r');
    try {
      const info = await fileHandle.stat();
      const length = Math.min(info.size, 65536);
      const buffer = Buffer.alloc(length);
      await fileHandle.read(buffer, 0, length, info.size - length);
      value = buffer.toString('utf8');
    } finally { await fileHandle.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return value.split(/\r?\n/).slice(-limit).join('\n');
}
