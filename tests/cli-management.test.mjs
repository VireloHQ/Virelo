import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { VireloDB } from '../dist/db.js';

const entry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));

async function command(args, cwd, timeout = 25000) {
  const child = spawn(process.execPath, [entry, ...args], {
    cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const timer = setTimeout(() => child.kill(), timeout);
  try {
    const [code] = await once(child, 'exit');
    return { code, stdout, stderr };
  } finally { clearTimeout(timer); }
}

async function waitForStop(data) {
  for (let i = 0; i < 60; i++) {
    const status = await command(['status', '--data', data], data, 4000);
    if (status.code !== 0) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Server did not stop.');
}

async function unusedLocalPort() {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const address = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  if (!address || typeof address === 'string') throw new Error('Could not allocate a test port.');
  return address.port;
}

test('background Virelo can be reattached, updated and stopped from another folder', { timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-cli-management-'));
  const data = join(root, 'data');
  const media = join(root, 'movies');
  const elsewhere = join(root, 'elsewhere');
  try {
    await mkdir(media);
    await mkdir(elsewhere);
    const started = await command(['--background','--data',data,'--random-port','--no-open'], elsewhere);
    assert.equal(started.code, 0, started.stderr + started.stdout);
    assert.match(started.stdout, /Started Virelo at http:\/\/127\.0\.0\.1:\d+/);
    assert.equal((await readFile(join(data,'.control','cli-upgrade-1'),'utf8')).trim(),'new');
    const url = started.stdout.match(/(http:\/\/127\.0\.0\.1:\d+)/)[1];
    assert.equal((await fetch(url + '/api/auth/status')).status, 200);

    const status = await command(['status','--data',data], media);
    assert.equal(status.code, 0, status.stderr);
    assert.ok(status.stdout.includes(url));

    const reattach = await command(['--background','--data',data,'--random-port','--no-open'], media);
    assert.equal(reattach.code, 0, reattach.stderr);
    assert.match(reattach.stdout, /Connected to Virelo/);
    assert.ok(reattach.stdout.includes(url));

    const add = await command(['--background','--here','--data',data,'--random-port','--no-open'], media);
    assert.equal(add.code, 0, add.stderr);
    const db = new VireloDB(data);
    try {
      assert.equal(db.listLibraries().length, 1);
      assert.equal(db.listLibraries()[0].persistent, 0);
    } finally { db.close(); }

    const stopped = await command(['stop','--data',data], elsewhere);
    assert.equal(stopped.code, 0, stopped.stderr);
    await waitForStop(data);
    const gone = await command(['status','--data',data], elsewhere);
    assert.notEqual(gone.code, 0);
  } finally {
    // Always stop the daemon before removing test data, including after failures.
    await command(['stop','--data',data], root).catch(() => {});
    await waitForStop(data).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});

test('concurrent startup requests share a single daemon', { timeout: 50000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-cli-concurrent-'));
  const data = join(root, 'data');
  try {
    const opts = ['--background','--data',data,'--random-port','--no-open'];
    const [first, second] = await Promise.all([command(opts, root), command(opts, root)]);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    assert.equal(second.code, 0, second.stdout + second.stderr);
    const a = first.stdout.match(/PID (\d+)/)?.[1];
    const b = second.stdout.match(/PID (\d+)/)?.[1];
    assert.ok(a, first.stdout);
    assert.equal(a, b);
    const status = await command(['status', '--data', data], root);
    assert.equal(status.code, 0);
    assert.ok(status.stdout.includes('PID: ' + a));
  } finally {
    await command(['stop','--data',data], root).catch(() => {});
    await waitForStop(data).catch(() => {});
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
});

test('Web Admin can restart a detached server without changing its port, then stop it', {timeout:60000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-web-server-actions-'));
  const data = join(root, 'data');
  try {
    const started = await command(['--background','--data',data,'--random-port','--no-open'], root);
    assert.equal(started.code, 0, started.stdout + started.stderr);
    const url = started.stdout.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert.ok(url, started.stdout);
    const login = await fetch(url + '/api/auth/setup', {
      method:'POST',
      headers:{'content-type':'application/json','x-virelo-request':'1'},
      body:JSON.stringify({username:'owner',password:'test-only-password'})
    });
    assert.equal(login.status,200,await login.text());
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const headers = { 'x-virelo-request':'1', cookie };
    const before = await fetch(url + '/api/server/management', { headers });
    assert.equal(before.status,200);
    const originalPid = (await before.json()).pid;
    const restart = await fetch(url + '/api/server/management/restart', {method:'POST',headers});
    assert.equal(restart.status,200,await restart.text());

    let afterPid = originalPid;
    for (let i=0; i<70; i++) {
      await new Promise(resolve=>setTimeout(resolve,200));
      const next = await command(['status','--data',data], root, 4000);
      const match = next.stdout.match(/PID: (\d+)/);
      if (next.code===0 && match && Number(match[1]) !== originalPid) {
        afterPid=Number(match[1]);
        assert.ok(next.stdout.includes(url), 'a restart should preserve the published port');
        break;
      }
    }
    assert.notEqual(afterPid,originalPid,'server was not restarted');
    const stop = await fetch(url + '/api/server/management/stop', {method:'POST',headers});
    assert.equal(stop.status,200,await stop.text());
    await waitForStop(data);
  } finally {
    await command(['stop','--data',data], root).catch(()=>{});
    await waitForStop(data).catch(()=>{});
    await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200});
  }
});

test('Web Admin applies saved host and port after restarting a detached server', {timeout:70000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-web-restart-config-'));
  const data = join(root, 'data');
  try {
    const started = await command(['--background', '--data', data, '--random-port', '--no-open'], root);
    assert.equal(started.code, 0, started.stdout + started.stderr);
    const originalUrl = started.stdout.match(/(http:\/\/127\.0\.0\.1:\d+)/)?.[1];
    assert.ok(originalUrl, started.stdout);

    const login = await fetch(originalUrl + '/api/auth/setup', {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-virelo-request': '1'},
      body: JSON.stringify({username: 'owner', password: 'test-only-password'})
    });
    assert.equal(login.status, 200, await login.text());
    const cookie = login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie);
    const headers = {'x-virelo-request': '1', cookie};

    let nextPort = await unusedLocalPort();
    while (nextPort === Number(new URL(originalUrl).port)) nextPort = await unusedLocalPort();
    const save = await fetch(originalUrl + '/api/server/management/config', {
      method: 'POST',
      headers: {...headers, 'content-type': 'application/json'},
      body: JSON.stringify({host: '0.0.0.0', port: nextPort})
    });
    const pending = await save.json();
    assert.equal(save.status, 200, JSON.stringify(pending));
    assert.equal(pending.restartRequired, true);
    assert.deepEqual(pending.desired, {host: '0.0.0.0', port: nextPort});

    const restart = await fetch(originalUrl + '/api/server/management/restart', {method: 'POST', headers});
    assert.equal(restart.status, 200, await restart.text());
    const nextUrl = `http://127.0.0.1:${nextPort}`;
    let startedWithSavedSettings = false;
    for (let i = 0; i < 80; i++) {
      await new Promise(resolve => setTimeout(resolve, 200));
      const next = await command(['status', '--data', data], root, 4000);
      if (next.code === 0 && next.stdout.includes(nextUrl)) {
        startedWithSavedSettings = true;
        break;
      }
    }
    assert.equal(startedWithSavedSettings, true, 'restart must use the saved Web Admin port');

    const updated = await fetch(nextUrl + '/api/server/management', {headers});
    const live = await updated.json();
    assert.equal(updated.status, 200, JSON.stringify(live));
    assert.equal(live.host, '0.0.0.0');
    assert.equal(live.port, nextPort);
    assert.equal(live.restartRequired, false);
  } finally {
    await command(['stop', '--data', data], root).catch(() => {});
    await waitForStop(data).catch(() => {});
    await rm(root, {recursive: true, force: true, maxRetries: 20, retryDelay: 200});
  }
});

test('older profiles see the startup change once without blocking a background launch', {timeout:30000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-cli-migration-'));
  const data = join(root,'data');
  try {
    await mkdir(data);
    const db = new VireloDB(data);
    db.close();
    const first = await command(['--background','--data',data,'--random-port','--no-open'],root);
    assert.equal(first.code,0,first.stderr+first.stdout);
    assert.match(first.stdout,/no longer scans the current directory automatically/);
    const second = await command(['--background','--data',data,'--no-open'],root);
    assert.equal(second.code,0,second.stderr+second.stdout);
    assert.doesNotMatch(second.stdout,/no longer scans the current directory automatically/);
    assert.equal((await readFile(join(data,'.control','cli-upgrade-1'),'utf8')).trim(),'migrated');
  } finally {
    await command(['stop','--data',data],root).catch(()=>{});
    await waitForStop(data).catch(()=>{});
    await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200});
  }
});

test('Docker restart does not try to create a second detached server', {timeout:10000}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-container-restart-'));
  try {
    const result = spawnSync(process.execPath, [entry,'restart','--data',join(root,'data')], {
      cwd:root, encoding:'utf8', env:{...process.env,CONTAINER:'true'}, timeout:5000
    });
    assert.equal(result.status,1,result.stdout);
    assert.match(result.stderr,/Restart the container through Docker/);
  } finally { await rm(root,{recursive:true,force:true,maxRetries:20,retryDelay:200}); }
});

test('status and stop never start an uninitialized server', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-cli-empty-manager-'));
  try {
    for (const action of ['status','stop']) {
      const result = await command([action,'--data',root], root);
      assert.notEqual(result.code, 0, result.stdout + result.stderr);
      assert.match(result.stdout, /not running/);
    }
  } finally { await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 }); }
});
