import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { CliUsageError, DEFAULT_PORT, parseCliArgs } from '../dist/cli-options.js';
import { shouldOpenTerminalConsole } from '../dist/server-process.js';

test('starts without implicitly scanning the current directory', () => {
  const cwd = resolve('test-media');
  const options = parseCliArgs([], cwd);
  assert.deepEqual(options.mediaPaths, []);
  assert.equal(options.host, '127.0.0.1');
  assert.equal(options.port, DEFAULT_PORT);
  assert.equal(options.openBrowser, true);
});

test('--here opts into the current directory, including when combined with explicit media paths', () => {
  const cwd = resolve('workspace');
  assert.deepEqual(parseCliArgs(['--here'], cwd).mediaPaths, [cwd]);
  assert.deepEqual(
    parseCliArgs(['-m', 'movies', '--here', '--media=shorts', '--here', '--media', '.'], cwd).mediaPaths,
    [resolve(cwd, 'movies'), cwd, resolve(cwd, 'shorts')]
  );
});

test('parses repeated media paths and short options without adding CWD', () => {
  const cwd = resolve('workspace');
  const options = parseCliArgs(['-m', 'movies', '--media=shorts', '-d', '.data', '-H', '0.0.0.0', '-p', '8080', '--no-open'], cwd);
  assert.deepEqual(options.mediaPaths, [resolve(cwd, 'movies'), resolve(cwd, 'shorts')]);
  assert.equal(options.dataDir, resolve(cwd, '.data'));
  assert.equal(options.host, '0.0.0.0');
  assert.equal(options.port, 8080);
  assert.equal(options.openBrowser, false);
});

test('--background never opens the TUI, even in an interactive terminal', () => {
  assert.equal(shouldOpenTerminalConsole(parseCliArgs([]), true), true);
  assert.equal(shouldOpenTerminalConsole(parseCliArgs(['--background']), true), false);
  assert.equal(shouldOpenTerminalConsole(parseCliArgs(['--no-tui']), true), false);
  assert.equal(shouldOpenTerminalConsole(parseCliArgs([]), false), false);
});

test('supports automatic port selection', () => {
  assert.equal(parseCliArgs(['--port', '0']).port, 0);
  assert.equal(parseCliArgs(['--random-port']).port, 0);
});

test('parses local administrator recovery without treating an empty username as a server start', () => {
  assert.equal(parseCliArgs(['--reset-password','owner']).resetPassword,'owner');
  assert.throws(()=>parseCliArgs(['--reset-password',' ']),CliUsageError);
  assert.deepEqual(parseCliArgs(['--reset-password','owner']).mediaPaths,[]);
});

test('rejects unknown options and invalid ports', () => {
  assert.throws(() => parseCliArgs(['--wat']), CliUsageError);
  assert.throws(() => parseCliArgs(['--port', '-1']), CliUsageError);
  assert.throws(() => parseCliArgs(['--media']), CliUsageError);
  assert.throws(() => parseCliArgs(['--here=folder']), CliUsageError);
});

test('published CLI help documents explicit media selection', async () => {
  const help = spawnSync(process.execPath, ['dist/cli.js', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /npx virelo/);
  assert.match(help.stdout, /--random-port/);
  assert.match(help.stdout, /--here/);
  assert.match(help.stdout, /without scanning the current directory/);
  assert.doesNotMatch(help.stdout, /serves the directory where the command is run/);

  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const version = spawnSync(process.execPath, ['dist/cli.js', '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), metadata.version);
});
