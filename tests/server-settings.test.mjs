import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readServerSettings, validateServerSettings, writeServerSettings } from '../dist/server-settings.js';

test('server settings validate host and port without permitting arbitrary fields', () => {
  assert.deepEqual(validateServerSettings({ host:'127.0.0.1', port:41777 }), { host:'127.0.0.1', port:41777 });
  for (const bad of [
    { host:'example.com', port:41777 }, { host:'0.0.0.0', port:-1 },
    { host:'0.0.0.0', port:65536 }, { host:'0.0.0.0', port:42.3 },
    { host:'127.0.0.1', port:41777, extra:true }, null, []
  ]) assert.throws(() => validateServerSettings(bad), /Invalid|Host/);
});

test('server settings survive a restart and are stored outside the library database', async () => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-server-settings-'));
  try {
    assert.equal(await readServerSettings(root), null);
    const saved = await writeServerSettings(root, {host:'0.0.0.0',port:8088});
    assert.deepEqual(saved, await readServerSettings(root));
    const edited = await writeServerSettings(root, {host:'127.0.0.1',port:0});
    assert.deepEqual(edited, await readServerSettings(root));
  } finally { await rm(root, { recursive:true, force:true }); }
});
