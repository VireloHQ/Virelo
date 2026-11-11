import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface ServerSettings {
  host: '127.0.0.1' | '0.0.0.0' | '::1' | '::';
  port: number;
}

const HOSTS = new Set(['127.0.0.1','0.0.0.0','::1','::']);

export function validateServerSettings(candidate: unknown): ServerSettings {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
    throw new Error('Invalid server settings.');
  const value = candidate as Record<string, unknown>;
  if (!HOSTS.has(String(value.host)) || !Number.isInteger(value.port)
    || (value.port as number) < 0 || (value.port as number) > 65535
    || Object.keys(value).some(key => !['host', 'port'].includes(key)))
    throw new Error('Host must be localhost or all interfaces, and port must be 0–65535.');
  return { host: value.host as ServerSettings['host'], port: value.port as number };
}

export async function readServerSettings(dataDir: string): Promise<ServerSettings | null> {
  let content: string;
  try { content = await readFile(join(dataDir, '.control', 'server-settings.json'), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  let object: unknown;
  try { object = JSON.parse(content); }
  catch { throw new Error('Invalid server settings file. Check .control/server-settings.json.'); }
  return validateServerSettings(object);
}

export async function writeServerSettings(dataDir: string, candidate: unknown): Promise<ServerSettings> {
  const next = validateServerSettings(candidate);
  const folder = join(dataDir, '.control');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const target = join(folder, 'server-settings.json');
  const temp = join(folder, `.server-settings-${randomBytes(8).toString('hex')}.tmp`);
  try {
    await writeFile(temp, JSON.stringify(next, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') await chmod(temp, 0o600);
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
  return next;
}
