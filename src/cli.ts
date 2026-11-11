#!/usr/bin/env node
import { existsSync, openSync, closeSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { stat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import open from 'open';
import { defaultDataDir, ensureDataDirs } from './config.js';
import { CliUsageError, DEFAULT_PORT, parseCliArgs, type CliOptions } from './cli-options.js';
import { VIRELO_VERSION } from './version.js';
import { acceptsIpv4, networkUrls, serverUrl } from './network-urls.js';
import { assertSupportedNode, NODE_REQUIREMENT } from './runtime.js';
import {
  acquireStartupLock, controlProfile, createControlServer, sendControl, type ControlProfile,
  type ControlRequest, type ControlReply, type ServerSnapshot
} from './server-control.js';
import {
  canUseTui, isContainer, runningServer, shouldOpenTerminalConsole, startDetached, stopDetached, waitForStop
} from './server-process.js';
import { openTerminalUI } from './terminal-ui.js';
import { ensureRestartPortAvailable, ensureTerminalPortAvailable } from './terminal-server.js';
import { readServerSettings } from './server-settings.js';

function usage() {
  console.log(`Virelo — personal media server

Usage:
  npx virelo [options]
  npx virelo status [--data <path>]
  npx virelo stop [--data <path>]
  npx virelo restart [options]

Options:
      --here          Include the current working directory as a temporary library
  -m, --media <path>  Use a media directory (repeatable)
  -d, --data <path>   Store data and cache in this directory (default: ~/.virelo)
  -H, --host <host>   Bind address (default: 127.0.0.1)
  -p, --port <port>   HTTP port (default: ${DEFAULT_PORT}; use 0 for an available port)
      --random-port   Select an available HTTP port automatically
      --background    Start independently without opening the terminal UI
      --foreground    Keep the server attached to this terminal (Docker/service mode)
      --no-tui        Do not open the terminal management UI
      --no-open       Do not open a browser in foreground mode
      --reset-password <username>
                      Recover an administrator's password locally, then exit
  -h, --help          Show help
  -v, --version       Show version

By default, Virelo starts with saved libraries without scanning the current directory.
Use --here for the former behavior, or add folders in Settings > Libraries.
On an interactive terminal, npx virelo starts or attaches to the server and opens its TUI.
In a container or without a TTY, the server stays in the foreground.
Requires Node.js ${NODE_REQUIREMENT} within those release lines.
`);
}

async function loadServer() {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const type = typeof args[0] === 'string' ? args[0] : undefined;
    if (type === 'ExperimentalWarning' && String(warning).includes('SQLite')) return;
    Reflect.apply(emitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try { return await import('./server.js'); }
  finally { process.emitWarning = emitWarning; }
}

async function recoverAdministrator(options: CliOptions) {
  const dataDir = options.dataDir ?? defaultDataDir();
  try { await stat(join(dataDir, 'virelo.db')); }
  catch { throw new CliUsageError('No Virelo database found. Check --data.'); }
  const { VireloDB } = await import('./db.js');
  const { Accounts, hashPassword } = await import('./accounts.js');
  const db = new VireloDB(dataDir);
  try {
    const accounts = new Accounts(db.db), id = accounts.findUsername(options.resetPassword!);
    if (id === undefined || !accounts.get(id)?.isAdmin)
      throw new CliUsageError('Administrator not found. Check the username and --data.');
    const password = randomBytes(20).toString('base64url');
    accounts.save({ enabled: true }, await hashPassword(password), id);
    console.log(`Administrator recovered. All sessions were revoked.\nUsername: ${accounts.get(id)!.username}\nTemporary password: ${password}\nRestart Virelo, sign in on localhost and change this password in Settings > Account.`);
  } finally { db.close(); }
}

async function validateMedia(paths: string[]) {
  for (const path of paths) {
    let readable = false;
    try { readable = (await stat(path)).isDirectory(); } catch { /* reported below */ }
    if (!readable) throw new CliUsageError(`Media directory cannot be read: ${path}`);
  }
}

async function upgradeNotice(profile: ControlProfile, wasExisting: boolean) {
  const marker = join(profile.controlDir, 'cli-upgrade-1');
  try { await readFile(marker); return false; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (wasExisting) return true;
  await mkdir(profile.controlDir, { recursive: true, mode: 0o700 });
  await writeFile(marker, 'new\n', { flag: 'wx' }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
  return false;
}

async function acknowledgeUpgrade(profile: ControlProfile) {
  await writeFile(join(profile.controlDir, 'cli-upgrade-1'), 'migrated\n', { flag: 'wx' }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
}

const upgradeMessage = 'Virelo no longer scans the current directory automatically. Use --here to include it; saved libraries remain available.';

async function plainUpgradeNotice(profile: ControlProfile, hadDatabase: boolean) {
  if (!await upgradeNotice(profile, hadDatabase)) return;
  console.log(upgradeMessage);
  await acknowledgeUpgrade(profile);
}

async function rememberNewProfile(profile: ControlProfile) {
  if (existsSync(join(profile.dataDir, 'virelo.db'))) return;
  await mkdir(profile.controlDir, { recursive: true, mode: 0o700 });
  await writeFile(join(profile.controlDir, 'cli-upgrade-1'), 'new\n', { flag: 'wx' }).catch(error => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  });
}

async function serveForeground(options: CliOptions, profile: ControlProfile) {
  const hadDatabase = existsSync(join(profile.dataDir, 'virelo.db'));
  await validateMedia(options.mediaPaths);
  // This mode is used by Docker, system service wrappers and CLI regression tests.
  // It stays alive with the calling process, but can still be managed via IPC.
  const already = await runningServer(profile);
  if (already) throw new Error(`Virelo is already running at ${already.url}. Use 'virelo status' or the TUI.`);
  ensureDataDirs(profile.dataDir);
  const { startServer } = await loadServer();
  const { app, db, port, scanStatus, runScan, addTemporaryLibrary } = await startServer({
    dataDir: profile.dataDir, host: options.host, port: options.port, mediaPaths: options.mediaPaths
  });
  const startedAt = Date.now();
  const address = app.server.address();
  const boundHost = address && typeof address === 'object' ? address.address : options.host;
  const browserHost = boundHost === '0.0.0.0' ? '127.0.0.1' : boundHost === '::' ? '::1' : options.host;
  const url = serverUrl(browserHost, port);
  const snapshot = (): ServerSnapshot => ({
    pid: process.pid, url, version: VIRELO_VERSION, startedAt,
    libraries: db.visibleLibraries().length, media: 0, scanRunning: scanStatus.running,
    host: boundHost, port, dataDir: profile.dataDir, restartSupported: options.daemonChild
  });
  let closing: ServerSnapshot | null = null;
  const shutdown = async () => {
    if (closing) return;
    closing = snapshot();
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    // Keep IPC available until the HTTP listener has released its port.
    // A restarting client waits for the control socket to disappear.
    await app.close();
    await control.close();
  };
  let control: Awaited<ReturnType<typeof createControlServer>>;
  try {
    control = await createControlServer(profile, async (request: ControlRequest): Promise<ControlReply> => {
      if (request.action === 'status') return { ok: true, status: closing ?? snapshot() };
      if (closing) return { ok: false, error: 'Virelo is shutting down.' };
      if (request.action === 'libraries') return {ok:true,status:snapshot(),libraries:db.visibleLibraries().map(({id,label,path,persistent})=>({id,label,path,persistent}))};
      if (request.action === 'stop') {
        setTimeout(() => { void shutdown().catch(error => { console.error(error); process.exitCode = 1; }); }, 70);
        return { ok: true, status: snapshot(), message: 'Stopping server.' };
      }
      if (request.action === 'restart') {
        if (!options.daemonChild)
          return { ok: false, error: 'This server is supervised externally. Restart it using its service manager.' };
        try {
          await ensureTerminalPortAvailable(profile, snapshot());
          const fd = openSync(join(profile.controlDir, 'server.log'), 'a', 0o600);
          try {
            const child = spawn(process.execPath, [
              fileURLToPath(new URL('./cli.js', import.meta.url)),
              'restart', '--background', '--no-open', '--data', profile.dataDir
            ], { detached: true, windowsHide: true, stdio: ['ignore', fd, fd] });
            child.on('error', error => console.error('Could not relaunch Virelo:', error));
            child.unref();
          } finally { closeSync(fd); }
          return { ok: true, status: snapshot(), message: 'Restart requested.' };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Restart failed.' };
        }
      }
      if (request.action === 'scan') {
        const started = await runScan();
        return { ok: true, status: snapshot(), message: started ? 'Scan started.' : 'Scan already in progress.' };
      }
      if (request.action === 'addMedia') {
        if (typeof request.path !== 'string' || !request.path || request.path.length > 4096)
          return { ok: false, error: 'A valid folder path is required.' };
        try {
          await addTemporaryLibrary(request.path);
          return { ok: true, status: snapshot(), message: 'Added temporary folder for this server run.' };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : 'Folder could not be added.' };
        }
      }
      return { ok: false, error: 'Unknown command.' };
    });
  } catch (error) {
    await app.close();
    throw error;
  }

  if (!options.daemonChild && !canUseTui()) await plainUpgradeNotice(profile, hadDatabase);
  console.log(`\nVirelo is ready\n  Local:  ${url}\n  Media:  ${options.mediaPaths.length ? options.mediaPaths.join(', ') : 'Saved libraries only (add folders in the Web UI)'}\n  Data:   ${profile.dataDir}`);
  console.log('  Accounts: sign in to use this server. First-time setup must be completed on this PC using localhost.');
  if (boundHost === '127.0.0.1' || boundHost === '::1' || boundHost.startsWith('127.')) {
    console.log('  Network: local access only. Use --host 0.0.0.0 to share on a trusted network.');
  } else {
    try {
      const addresses = networkUrls(boundHost, port, undefined, boundHost === '::' && await acceptsIpv4(port, app.server));
      console.log('  Network:');
      for (const entry of addresses) console.log(`    ${entry.url}  (${entry.name})`);
      if (!addresses.length) console.log('    No browser-compatible network addresses detected. Check your network connection.');
      console.log('  Access requires a Virelo account. Use HTTPS or a trusted VPN outside your trusted network.');
    } catch {
      console.log('  Network: address detection unavailable. Check your network adapter settings.');
    }
  }
  console.log();
  if (options.openBrowser && !options.daemonChild) void open(url).catch(() => undefined);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function manage(options: CliOptions, profile: ControlProfile) {
  if (options.command === 'status') {
    const status = await runningServer(profile);
    if (!status) { console.log('Virelo is not running for this data directory.'); process.exitCode = 1; return; }
    console.log(`Virelo is running at ${status.url}\n  PID: ${status.pid}\n  Libraries: ${status.libraries}\n  Data: ${status.dataDir}`);
    return;
  }
  if (options.command === 'stop') {
    const stopped = await stopDetached(profile);
    console.log(stopped ? 'Stopping Virelo.' : 'Virelo is not running for this data directory.');
    if (!stopped) process.exitCode = 1;
    else await waitForStop(profile);
    return;
  }
  if (options.command === 'restart') {
    if (isContainer()) throw new CliUsageError('Restart the container through Docker rather than launching a second Virelo process.');
    const before = await runningServer(profile);
    if (before && !before.restartSupported)
      throw new CliUsageError('This server is supervised externally. Restart it using its service manager.');
    if (before) {
      const libraries=await sendControl(profile,{action:'libraries'});
      if(!libraries?.ok||!libraries.libraries)throw new CliUsageError('Could not read active libraries. The running server was not stopped.');
      options.mediaPaths=[...new Set([...libraries.libraries.filter(library=>!library.persistent).map(library=>library.path),...options.mediaPaths])];
      await validateMedia(options.mediaPaths);
      // Apply saved Web Admin settings on restart. Without saved settings,
      // keep the current bind address and port unless the CLI overrides them.
      const saved = await readServerSettings(profile.dataDir);
      if (!options.explicitHost && !saved) options.host = before.host;
      if (!options.explicitPort && !saved) options.port = before.port;
      await ensureRestartPortAvailable(options.host, options.port, before.port);
    }
    const stopped = await stopDetached(profile);
    if (stopped) await waitForStop(profile);
    console.log(stopped ? 'Restarting Virelo...' : 'Starting Virelo...');
  }
  await validateMedia(options.mediaPaths);
  const already = await runningServer(profile);
  const hadDatabase = existsSync(join(profile.dataDir, 'virelo.db'));
  const { status, existing } = await startDetached(profile, options);
  // Explicit --here/--media in a second shell updates the existing session.
  if ((already || existing) && options.mediaPaths.length) {
    for (const path of options.mediaPaths) {
      const reply = await sendControl(profile, { action: 'addMedia', path });
      if (!reply?.ok) throw new Error(reply?.error || 'Failed to add media to the running server.');
    }
  }
  if (!shouldOpenTerminalConsole(options)) {
    await plainUpgradeNotice(profile, hadDatabase);
    console.log(`${existing ? 'Connected to' : 'Started'} Virelo at ${status.url} (PID ${status.pid}).`);
    console.log('The server will keep running. Use "virelo status" or "virelo stop" to manage it.');
    return;
  }
  const changed = await upgradeNotice(profile, hadDatabase);
  await openTerminalUI(profile, status, changed, () => acknowledgeUpgrade(profile));
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  if (options.version) { console.log(VIRELO_VERSION); return; }
  assertSupportedNode();
  if (options.resetPassword) { await recoverAdministrator(options); return; }
  const dataDir = options.dataDir ?? defaultDataDir();
  if (['status','stop'].includes(options.command) && !existsSync(dataDir)) {
    console.log('Virelo is not running for this data directory.');
    process.exitCode = 1;
    return;
  }
  const profile = await controlProfile(dataDir);
  if ((options.command === 'start' || options.command === 'restart') && !options.daemonChild) await rememberNewProfile(profile);
  if (options.command === 'start' || options.command === 'restart') {
    const saved = await readServerSettings(profile.dataDir);
    if (saved) {
      if (!options.explicitHost) options.host = saved.host;
      if (!options.explicitPort) options.port = saved.port;
    }
  }
  const interactiveHost = Boolean(process.stdin.isTTY && process.stdout.isTTY && !process.env.CI && !isContainer());
  // An interactive docker exec session is a management client, not a second PID 1.
  const containerAttach = !options.foreground && !options.daemonChild && isContainer() && canUseTui()
    && Boolean(await runningServer(profile));
  if (options.command !== 'start' || options.background || containerAttach || (!options.foreground && !options.daemonChild && interactiveHost)) {
    if (options.background && isContainer()) throw new CliUsageError('--background is not supported inside containers. Use a Docker restart policy.');
    await manage(options, profile);
  } else {
    // The launching parent owns the lock for a daemon child.
    const release = options.daemonChild ? undefined : await acquireStartupLock(profile);
    try { await serveForeground(options, profile); }
    finally { await release?.(); }
  }
}

void main().catch((error: unknown) => {
  console.error(`Virelo could not start: ${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof CliUsageError) console.error('Run "virelo --help" for usage.');
  process.exitCode = 1;
});
