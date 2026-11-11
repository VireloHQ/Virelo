import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VireloDB } from '../dist/db.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

for (const {args,expectedCount} of [
  { args: [], expectedCount: 0 },
  { args: ['--here'], expectedCount: 1 }
]) {
  test(`CLI ${args.length ? '--here opt-in' : 'no-argument startup'} respects media selection`, { timeout: 25000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'virelo-no-implicit-media-'));
    const cwd = join(root, 'unrelated-working-directory');
    const data = join(root, 'data');
    let child;
    try {
      await mkdir(cwd);
      child = spawn(process.execPath,
        [cli, ...args, '--data', data, '--random-port', '--no-open'],
        { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('CLI startup timed out: ' + stdout + stderr)), 15000);
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('CLI exited: ' + code + ' ' + stdout + stderr)); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });
        child.stdout.on('data', chunk => {
          stdout += chunk.toString();
          if (stdout.includes('Network: local access only.')) {
            clearTimeout(timer); accept();
          }
        });
      });
      if (expectedCount === 0) {
        assert.match(stdout, /Media:\s+Saved libraries only/);
        assert.ok(!stdout.includes(cwd), 'The working directory should not appear as a media library');
      } else {
        assert.ok(stdout.includes(cwd));
      }
      const libraries = new VireloDB(data);
      try {
        assert.equal(libraries.listLibraries().length, expectedCount);
        if (expectedCount) {
          const [registered, requested] = await Promise.all([
            realpath(libraries.listLibraries()[0].path), realpath(cwd)
          ]);
          const normalizeCase = path => process.platform === 'win32' ? path.toLowerCase() : path;
          assert.equal(normalizeCase(registered), normalizeCase(requested));
        }
      } finally {
        libraries.close();
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
      await rm(root, { recursive: true, force: true });
    }
  });
}
