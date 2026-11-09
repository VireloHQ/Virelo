import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync, statSync, renameSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import {
  acquireStartupLock, sendControl, type ControlProfile, type ServerSnapshot
} from './server-control.js';
import type { CliOptions } from './cli-options.js';

export function isContainer(): boolean {
  return process.env.container === 'docker' || process.env.CONTAINER === 'true' ||
    (process.platform === 'linux' && existsSync('/.dockerenv'));
}

export function canUseTui(): boolean {
  return !!(process.stdin.isTTY && process.stdout.isTTY && process.env.TERM !== 'dumb' && !process.env.CI);
}

export async function runningServer(profile: ControlProfile): Promise<ServerSnapshot | null> {
  const reply = await sendControl(profile, { action: 'status' });
  if (!reply) return null;
  if (!reply.ok) throw new Error(reply.error);
  return reply.status;
}

async function waitForReady(profile: ControlProfile, child: ReturnType<typeof spawn>, launchError: () => Error | undefined): Promise<ServerSnapshot> {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (launchError()) throw launchError();
    if (child.exitCode !== null) throw new Error(`Virelo background server exited with code ${child.exitCode}. Check .control/server.log.`);
    const result = await runningServer(profile).catch(() => null);
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 180));
  }
  throw new Error('Virelo did not become ready. Check .control/server.log in the data directory.');
}

export async function startDetached(profile: ControlProfile, options: CliOptions): Promise<{ status: ServerSnapshot; existing: boolean }> {
  const found = await runningServer(profile);
  if (found) return { status: found, existing: true };
  let unlock: () => Promise<void>;
  try {
    unlock = await acquireStartupLock(profile);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already starting')) throw error;
    // A second terminal may launch while the first one is still booting.
    // Wait for its authenticated IPC handshake rather than starting a duplicate.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const existing = await runningServer(profile).catch(() => null);
      if (existing) return { status: existing, existing: true };
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Another Virelo instance is still starting. Try again or inspect its log.');
  }
  try {
    const raced = await runningServer(profile);
    if (raced) return { status: raced, existing: true };
    mkdirSync(profile.controlDir, { recursive: true, mode: 0o700 });
    const log = join(profile.controlDir, 'server.log');
    try {
      if (existsSync(log) && statSync(log).size > 8 * 1024 * 1024) renameSync(log, log + '.previous');
    } catch { /* A locked log on Windows must not prevent server startup. */ }
    const fd = openSync(log, 'a', 0o600);
    const args = [
      fileURLToPath(new URL('./cli.js', import.meta.url)),
      '--daemon-child', '--no-open', '--data', profile.dataDir,
      '--host', options.host, '--port', String(options.port)
    ];
    for (const path of options.mediaPaths) args.push('--media', path);
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(process.execPath, args, { detached: true, windowsHide: true,
        stdio: ['ignore', fd, fd] });
    } finally { closeSync(fd); }
    let error: Error | undefined;
    child.on('error', reason => { error = reason; });
    child.unref();
    const ready = await waitForReady(profile, child, () => error);
    return { status: ready, existing: false };
  } finally {
    await unlock();
  }
}

export async function stopDetached(profile: ControlProfile): Promise<boolean> {
  const result = await sendControl(profile, { action: 'stop' });
  if (!result) return false;
  if (!result.ok) throw new Error(result.error);
  return true;
}

export async function waitForStop(profile: ControlProfile, timeout = 15000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (!await runningServer(profile).catch(() => null)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('Virelo did not shut down in time. See .control/server.log.');
}
