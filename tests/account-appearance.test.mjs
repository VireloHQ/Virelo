import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { createVireloServer } from '../dist/server.js';
import { hashPassword } from '../dist/accounts.js';
import { DEFAULT_APPEARANCE } from '../dist/appearance.js';
process.env.VIRELO_LOG_LEVEL = 'silent';

test('appearance belongs to the signed-in account, persists and never requires admin privileges', async t => {
  const root = await mkdtemp(join(tmpdir(), 'virelo-appearance-test-'));
  const options = { dataDir: root, mediaPaths: [], host: '127.0.0.1', port: 0 };
  let server = await createVireloServer(options);
  t.after(async () => {
    await server.app.close();
    const path = relative(resolve(tmpdir()), resolve(root));
    assert.ok(path.startsWith('virelo-appearance-test-') && !path.includes('..'));
    await rm(root, { recursive: true, force: true });
  });
  const hash = await hashPassword('1');
  const admin = server.accounts.save({ username: 'owner', allLibraries: true }, hash, undefined, true);
  const user = server.accounts.save({ username: 'viewer', permissions: { play: false } }, hash);
  const cookie = account => 'virelo_session=' + server.accounts.createSession(account);
  const adminCookie = cookie(admin), userCookie = cookie(user);
  const call = (method, body, cookieValue, csrf = true) => server.app.inject({
    method, url: '/api/account/appearance', payload: body,
    headers: { host: 'localhost', ...(csrf ? { 'x-virelo-request': '1' } : {}), ...(cookieValue ? { cookie: cookieValue } : {}) }
  });
  assert.equal((await call('GET')).statusCode, 401);
  assert.equal((await call('PUT', DEFAULT_APPEARANCE)).statusCode, 401);
  assert.deepEqual((await call('GET', undefined, userCookie)).json(), DEFAULT_APPEARANCE);
  const selected = { controllerStyle: 'theater', accentColor: '#12ABEF' };
  assert.equal((await call('PUT', selected, userCookie, false)).statusCode, 403);
  const result = await call('PUT', selected, userCookie);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.json(), { ...selected, accentColor: '#12abef' });
  assert.deepEqual((await call('GET', undefined, adminCookie)).json(), DEFAULT_APPEARANCE);
  for (const body of [{ ...selected, userId: admin.id }, { ...selected, accentColor: 'url(secret)' }, { ...selected, controllerStyle: 'bogus' }])
    assert.equal((await call('PUT', body, userCookie)).statusCode, 400);
  assert.deepEqual((await call('GET', undefined, userCookie)).json(), { ...selected, accentColor: '#12abef' });
  assert.equal(server.accounts.get(user.id).revision, user.revision);
  assert.equal((await call('PUT', { controllerStyle: 'streamline', accentColor: '#abcdef' }, adminCookie)).statusCode, 200);
  await server.app.close();
  server = await createVireloServer(options);
  assert.deepEqual((await call('GET', undefined, userCookie)).json(), { ...selected, accentColor: '#12abef' });
  assert.equal((await call('GET', undefined, adminCookie)).json().controllerStyle, 'streamline');
  server.accounts.remove(user.id);
  assert.equal(server.accounts.db.prepare('SELECT COUNT(*) n FROM account_appearance WHERE user_id=?').get(user.id).n, 0);
  assert.equal((await call('GET', undefined, userCookie)).statusCode, 401);
});
