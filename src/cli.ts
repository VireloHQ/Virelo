#!/usr/bin/env node
import { stat } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import open from 'open';
import { defaultDataDir, ensureDataDirs } from './config.js';
import { CliUsageError, DEFAULT_PORT, parseCliArgs } from './cli-options.js';
import { VIRELO_VERSION } from './version.js';
import { acceptsIpv4, networkUrls, serverUrl } from './network-urls.js';
import { assertSupportedNode, NODE_REQUIREMENT } from './runtime.js';

function usage() {
  console.log(`Virelo — personal media server

Usage:
  npx virelo [options]
  virelo [options]

Options:
  -m, --media <path>  Use a media directory (repeatable)
  -d, --data <path>   Store data and cache in this directory (default: ~/.virelo)
  -H, --host <host>   Bind address (default: 127.0.0.1)
  -p, --port <port>   HTTP port (default: ${DEFAULT_PORT}; use 0 for an available port)
      --random-port   Select an available HTTP port automatically
      --no-open       Do not open a browser
      --reset-password <username>
                      Recover an administrator's password locally, then exit
  -h, --help          Show help
  -v, --version       Show version

With no --media option, Virelo serves the directory where the command is run.
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
  try {
    return await import('./server.js');
  } finally {
    process.emitWarning = emitWarning;
  }
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) { usage(); return; }
  if (options.version) { console.log(VIRELO_VERSION); return; }
  assertSupportedNode();
  if (options.resetPassword) {
    const dataDir = options.dataDir ?? defaultDataDir();
    try { await stat(join(dataDir, 'virelo.db')); } catch { throw new CliUsageError('No Virelo database found. Check --data.'); }
    const { VireloDB } = await import('./db.js');
    const { Accounts, hashPassword } = await import('./accounts.js');
    const db = new VireloDB(dataDir);
    try {
      const accounts = new Accounts(db.db), id = accounts.findUsername(options.resetPassword);
      if (id === undefined || !accounts.get(id)?.isAdmin) throw new CliUsageError('Administrator not found. Check the username and --data.');
      const password = randomBytes(20).toString('base64url');
      accounts.save({enabled:true}, await hashPassword(password), id);
      console.log(`Administrator recovered. All sessions were revoked.\nUsername: ${accounts.get(id)!.username}\nTemporary password: ${password}\nRestart Virelo, sign in on localhost and change this password in Settings > Account.`);
    } finally { db.close(); }
    return;
  }

  for (const path of options.mediaPaths) {
    let readable = false;
    try { readable = (await stat(path)).isDirectory(); } catch { /* handled below */ }
    if (!readable) throw new CliUsageError(`Media directory cannot be read: ${path}`);
  }

  const dataDir = options.dataDir ?? defaultDataDir();
  ensureDataDirs(dataDir);
  const { startServer } = await loadServer();
  const { app, port } = await startServer({ dataDir, host: options.host, port: options.port, mediaPaths: options.mediaPaths });
  const address = app.server.address();
  const boundHost = address && typeof address === 'object' ? address.address : options.host;
  const browserHost = boundHost === '0.0.0.0' ? '127.0.0.1' : boundHost === '::' ? '::1' : options.host;
  const url = serverUrl(browserHost, port);
  console.log(`\nVirelo is ready\n  Local:  ${url}\n  Media:  ${options.mediaPaths.join(', ')}\n  Data:   ${dataDir}`);
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
  if (options.openBrowser) void open(url).catch(() => undefined);

  const shutdown = async () => {
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await app.close();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Virelo could not start: ${message}`);
  if (error instanceof CliUsageError) console.error('Run "virelo --help" for usage.');
  process.exitCode = 1;
});
