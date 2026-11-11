import { spawn, type ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AccountError } from './accounts.js';
import { directLocal } from './auth.js';
import type { CustomCommand, CustomCommandDefinition } from './custom-command-types.js';

const OUTPUT_LIMIT = 32_768;
export function finishCommandGroup(pid: number, platform = process.platform, send = process.kill) {
  try { send(-pid, 'SIGKILL'); } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // After SIGTERM and parent exit, Darwin can report EPERM for a zombie-only group.
    if (code !== 'ESRCH' && !(platform === 'darwin' && code === 'EPERM')) throw error;
  }
}
type Row = { id: number; definition: string };
type Run = Pick<CustomCommand, 'status' | 'output' | 'activeUrl' | 'exitCode'> & {
  child: ChildProcess;
  finished: Promise<void>;
  stopping?: Promise<void>;
};

function text(value: unknown, label: string, max: number, required = false) {
  if (typeof value !== 'string' || value.length > max || /[\p{Cc}\p{Cf}]/u.test(value) || (required && !value.trim()))
    throw new AccountError(`Enter a valid ${label}.`);
  return value.trim();
}
function httpsOrigin(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash) return url.origin;
  } catch { /* Invalid URLs are rejected by the caller. */ }
  throw new AccountError('Public URL must be an HTTPS address without a path, credentials or query.');
}
export function commandDefinition(value: unknown): CustomCommandDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AccountError('A command definition is required.');
  const body = value as Record<string, unknown>;
  const name = text(body.name, 'name', 80, true), executable = text(body.executable, 'executable', 4096, true);
  if (!Array.isArray(body.args) || body.args.length > 128 || body.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || /[\0\r\n]/.test(arg)) || Buffer.byteLength(JSON.stringify(body.args)) > 16384)
    throw new AccountError('Use up to 128 arguments, without line breaks (16 KiB total).');
  const publicUrl = text(body.publicUrl ?? '', 'public URL', 2048);
  const urlDomain = text(body.urlDomain ?? '', 'generated URL domain', 253).toLowerCase();
  if (urlDomain && (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(urlDomain) || publicUrl))
    throw new AccountError('Enter a domain such as share.example.com, or a fixed public URL, not both.');
  return { name, executable, args: body.args as string[], publicUrl: publicUrl ? httpsOrigin(publicUrl) : '', urlDomain };
}

export class CustomCommands {
  private runs = new Map<number, Run>();
  private closing = false;
  constructor(private sql: DatabaseSync, private cwd: string, private localUrl: () => string) {
    sql.exec('CREATE TABLE IF NOT EXISTS custom_commands (id INTEGER PRIMARY KEY AUTOINCREMENT, definition TEXT NOT NULL)');
  }
  private row(id: number) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccountError('Command not found.', 404);
    const row = this.sql.prepare('SELECT * FROM custom_commands WHERE id=?').get(id) as Row | undefined;
    if (!row) throw new AccountError('Command not found.', 404);
    return row;
  }
  private view(row: Row): CustomCommand {
    const run = this.runs.get(row.id);
    return { ...commandDefinition(JSON.parse(row.definition)), id: row.id, status: run?.status ?? 'stopped', output: run?.output ?? '', activeUrl: run?.status === 'running' ? run.activeUrl : '', exitCode: run?.exitCode ?? null };
  }
  list() { return (this.sql.prepare('SELECT * FROM custom_commands ORDER BY id').all() as Row[]).map(row => this.view(row)); }
  private assertStopped(id: number) {
    if (['running', 'stopping'].includes(this.runs.get(id)?.status ?? '')) throw new AccountError('Stop the command before editing or removing it.', 409);
  }
  save(value: unknown, id?: number) {
    if (this.closing) throw new AccountError('The server is shutting down.', 503);
    const definition = commandDefinition(value);
    if (id !== undefined) {
      this.row(id); this.assertStopped(id);
      this.sql.prepare('UPDATE custom_commands SET definition=? WHERE id=?').run(JSON.stringify(definition), id);
      this.runs.delete(id);
    } else {
      if (this.list().length >= 8) throw new AccountError('Up to eight custom commands can be saved.');
      id = Number(this.sql.prepare('INSERT INTO custom_commands (definition) VALUES (?)').run(JSON.stringify(definition)).lastInsertRowid);
    }
    return this.view(this.row(id));
  }
  remove(id: number) {
    this.row(id); this.assertStopped(id);
    this.sql.prepare('DELETE FROM custom_commands WHERE id=?').run(id); this.runs.delete(id);
    return { ok: true };
  }
  allowsHost(host: string) {
    const canonical=host.toLowerCase().replace(/\.$/,'');
    return [...this.runs.values()].some(run => run.status === 'running' && run.activeUrl && new URL(run.activeUrl).hostname.replace(/\.$/,'') === canonical);
  }
  async start(id: number) {
    if (this.closing) throw new AccountError('The server is shutting down.', 503);
    const row = this.row(id), definition = commandDefinition(JSON.parse(row.definition));
    this.assertStopped(id);
    if ([...this.runs.values()].filter(run => ['running', 'stopping'].includes(run.status)).length >= 2) throw new AccountError('Two commands are already running.', 429);
    const args = definition.args.map(arg => arg.replaceAll('{url}', this.localUrl()));
    // Arguments are passed literally; shell syntax is never interpreted implicitly.
    const child = spawn(definition.executable, args, { cwd: this.cwd, shell: false, windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let finish!: () => void;
    const run: Run = { child, status: 'running', output: '', activeUrl: definition.publicUrl, exitCode: null, finished: new Promise(resolve => { finish = resolve; }) };
    this.runs.set(id, run);
    const append = (chunk: string) => {
      run.output = (run.output + stripVTControlCharacters(chunk).replace(/\r(?!\n)/g, '\n').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '')).slice(-OUTPUT_LIMIT);
      if (!definition.urlDomain || run.activeUrl || run.status !== 'running') return;
      for (const match of run.output.matchAll(/https:\/\/[^\s<>"'|]+/g)) {
        try {
          const origin = httpsOrigin(match[0].replace(/[,);\]]+$/, '')), host = new URL(origin).hostname;
          if (host === definition.urlDomain || host.endsWith('.' + definition.urlDomain)) { run.activeUrl = origin; break; }
        } catch { /* Only explicitly scoped HTTPS origins can become public Hosts. */ }
      }
    };
    for (const stream of [child.stdout, child.stderr]) stream?.setEncoding('utf8').on('data', append);
    child.once('error', error => { append(error.message); run.status = 'error'; run.activeUrl = ''; finish(); });
    child.once('close', (code) => { run.exitCode = child.pid ? code : null; run.status = run.status === 'stopping' ? 'stopped' : code === 0 ? 'exited' : 'error'; run.activeUrl = ''; finish(); });
    await new Promise<void>((resolve, reject) => { child.once('spawn', resolve); child.once('error', () => reject(new AccountError('Could not start the executable. Check its path and command output.', 400))); });
    return this.view(row);
  }
  async stop(id: number) {
    const row = this.row(id), run = this.runs.get(id);
    if (!run || !['running', 'stopping'].includes(run.status)) return this.view(row);
    run.status = 'stopping'; run.activeUrl = '';
    run.stopping ??= this.terminate(run).finally(() => { run.stopping = undefined; });
    await run.stopping;
    return this.view(row);
  }
  private async terminate(run: Run) {
    const pid = run.child.pid;
    if (!pid) return;
    if (process.platform === 'win32') {
      await new Promise<void>((resolve, reject) => {
        const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        const timer = setTimeout(() => { killer.kill(); reject(new AccountError('Could not stop the command. Check it on the server PC.', 503)); }, 5000);
        killer.once('error', () => { clearTimeout(timer); reject(new AccountError('Could not stop the command on this PC.', 503)); });
        killer.once('close', code => { clearTimeout(timer); if (code && run.child.exitCode === null && run.child.signalCode === null) reject(new AccountError('Could not stop the command. Check it on the server PC.', 503)); else resolve(); });
      });
    } else {
      try { process.kill(-pid, 'SIGTERM'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    }
    const force = process.platform === 'win32' ? undefined : setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch { /* Already exited. */ }
    }, 1500);
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([run.finished, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new AccountError('The command has not stopped. Check it on the server PC.', 503));
        }, 3000);
      })]);
      // A parent can exit before a child that ignores SIGTERM closes its own pipes.
      if (process.platform !== 'win32') finishCommandGroup(pid);
    } finally { clearTimeout(timer); clearTimeout(force); }
  }
  async close() {
    this.closing = true;
    await Promise.all([...this.runs].filter(([, run]) => ['running', 'stopping'].includes(run.status)).map(([id]) => this.stop(id)));
  }
}

export function registerCustomCommands(app: FastifyInstance, commands: CustomCommands, requireAdmin: (request: FastifyRequest) => unknown) {
  const guard = async (request: FastifyRequest) => {
    requireAdmin(request);
    if (!directLocal(request)) throw new AccountError('Custom commands are only available to administrators on localhost.', 403);
  };
  app.get('/api/commands', { preHandler: guard }, async () => commands.list());
  app.post('/api/commands', { preHandler: guard }, async (request, reply) => reply.code(201).send(commands.save(request.body)));
  app.put<{ Params: { id: string } }>('/api/commands/:id', { preHandler: guard }, async request => commands.save(request.body, Number(request.params.id)));
  app.delete<{ Params: { id: string } }>('/api/commands/:id', { preHandler: guard }, async request => commands.remove(Number(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/commands/:id/start', { preHandler: guard }, async request => commands.start(Number(request.params.id)));
  app.post<{ Params: { id: string } }>('/api/commands/:id/stop', { preHandler: guard }, async request => commands.stop(Number(request.params.id)));
}
