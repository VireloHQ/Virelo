import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { once } from 'node:events';
import { networkUrls } from '../dist/network-urls.js';

for (const host of ['127.0.0.1', '0.0.0.0']) {
  test(`CLI startup explains actual addresses for ${host} with an automatic port`, { timeout: 20000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'virelo-cli-network-'));
    const media = join(root, 'media');
    let child;
    try {
      await mkdir(media);
      child = spawn(process.execPath, ['dist/cli.js', '--media', media, '--data', join(root, 'data'),
        '--host', host, '--random-port', '--no-open'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '', error = '';
      const ready = await new Promise((accept, reject) => {
        const timer = setTimeout(() => reject(new Error('CLI did not become ready: ' + error + output)), 10000);
        child.once('error', reason => { clearTimeout(timer); reject(reason); });
        child.once('exit', code => { clearTimeout(timer); reject(new Error('CLI exited: ' + code + error + output)); });
        child.stderr.on('data', chunk => { error += chunk; });
        child.stdout.on('data', chunk => {
          output += chunk;
          if (output.includes('Network: local access only.') || output.includes('Access requires a Virelo account.')) {
            clearTimeout(timer); accept(output);
          }
        });
      });
      assert.ok(!ready.includes('<your-lan-ip>'));
      const local = ready.match(/Local:\s+(http:\/\/127\.0\.0\.1:(\d+))/);
      assert.ok(local, ready);
      const port = Number(local[2]);
      assert.ok(port > 0 && port <= 65535);
      assert.equal((await fetch(local[1] + '/api/settings')).status, 401);
      assert.equal((await fetch(local[1] + '/api/auth/status')).status, 200);
      if (host === '127.0.0.1') {
        assert.match(ready, /--host 0\.0\.0\.0/);
        assert.ok(!ready.includes('  Network:\n'));
      } else {
        const expected = networkUrls(host, port);
        for (const entry of expected) assert.ok(ready.includes(`${entry.url}  (${entry.name})`), entry.name);
        if (!expected.length) assert.match(ready, /No browser-compatible network addresses detected/);
        assert.match(ready, /Access requires a Virelo account/);
      }
    } finally {
      if (child && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit'); child.kill(); await exited;
      }
      const target = relative(resolve(tmpdir()), resolve(root));
      assert.ok(target.startsWith('virelo-cli-network-') && !target.includes('..'));
      await rm(root, { recursive: true, force: true });
    }
  });
}
