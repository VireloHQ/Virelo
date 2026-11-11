import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { npm, packRelease } from './pack-release.mjs';

const repo = fileURLToPath(new URL('../', import.meta.url));
const root = await mkdtemp(join(tmpdir(), 'virelo-package-audit-'));
console.log('Package audit fixtures:', root);
const expected = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const sourceAudit = JSON.parse(npm(['audit', '--json']));
assert.equal(sourceAudit.metadata.vulnerabilities.total, 0, 'build and production dependencies have no known npm advisories');
const archive = await packRelease({ destination: process.env.VIRELO_RELEASE_OUTPUT || root });
assert.equal(archive.filename, `virelo-${expected.version}.tgz`);
assert.ok(!archive.files.some(file => /(?:\.wasm(?:\.gz)?$|\/ffmpeg-0\.12\.10\/)/.test(file.path)),
  'browser-only conversion assets are not in the npm package');
const install = join(root, 'install');
npm(['install', '--prefix', install, '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', archive.path]);
const audit = JSON.parse(npm(['audit', '--omit=dev', '--json'], install));
assert.equal(audit.metadata.vulnerabilities.total, 0, 'installed production dependencies have no known npm advisories');
const installed = join(install, 'node_modules/virelo');
const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
assert.equal(metadata.version, expected.version);
assert.equal(metadata.engines.node, expected.engines.node);
assert.equal(metadata.license, expected.license);
const fromInstalled = createRequire(join(installed, 'package.json'));
const staticManifest = fromInstalled.resolve('@fastify/static/package.json');
const fromStatic = createRequire(staticManifest);
const globManifest = fromStatic.resolve('glob/package.json');
const glob = fromStatic('glob/package.json');
const minimatch = createRequire(globManifest)('minimatch/package.json');
const locked = JSON.parse(await readFile(join(repo, 'release-lock.json'), 'utf8'));
assert.equal(glob.version, locked.packages['node_modules/glob'].version, 'consumer installation retains the patched glob');
assert.equal(minimatch.version, locked.packages['node_modules/minimatch'].version, 'consumer installation retains the patched minimatch');
assert.ok(archive.files.some(file => file.path.endsWith('node_modules/minimatch/LICENSE.md')), 'bundled dependency licenses are preserved');
npm(['ls', '--omit=dev', '--all', '--json'], install);
const cli = join(installed, 'dist/cli.js');
const runCli = flag => execFileSync(process.execPath, [cli, flag], { cwd: install, encoding: 'utf8', timeout: 15000, windowsHide: true });
assert.equal(runCli('--version').trim(), expected.version);
assert.match(runCli('--help'), /22\.23\.4\+.*24\.22\.1\+.*26\.12\.1\+/);

process.env.VIRELO_LOG_LEVEL = 'silent';
const media = join(root, 'empty-media');
await mkdir(media);
const { startServer } = await import(pathToFileURL(join(installed, 'dist/server.js')).href);
const { app, port } = await startServer({ dataDir: join(root, 'data'), mediaPaths: [media], host: '127.0.0.1', port: 0 });
try {
  const base = `http://127.0.0.1:${port}`;
  const get = (path, options) => fetch(new URL(path, base), { signal: AbortSignal.timeout(15000), ...options });
  const page = await get('/title/1');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  const html = await page.text();
  const urls = [...html.matchAll(/(?:src|href)="(\/(?:assets\/[^"?]+|startup\.js))/g)].map(match => match[1]);
  assert.ok(urls.length >= 3, 'packaged HTML references scripts and styles');
  for (const url of urls) { const asset = await get(url); assert.equal(asset.status, 200, url); assert.ok((await asset.arrayBuffer()).byteLength, url); }
  assert.equal((await get('/assets/missing-package-audit.js')).status, 404);
  assert.equal((await get('/api/media')).status, 401);
  assert.equal((await (await get('/api/auth/status')).json()).setupRequired, true);
  const setup = await get('/api/auth/setup', { method: 'POST', headers: { 'content-type': 'application/json', 'x-virelo-request': '1' },
    body: JSON.stringify({ username: 'owner', password: '1234' }) });
  assert.equal(setup.status, 200, await setup.clone().text());
  assert.equal((await setup.json()).user.isAdmin, true);
  const cookie = setup.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'initial setup creates a session');
  const health = await get('/api/health', { headers: { cookie } });
  assert.equal(health.status, 200);
  assert.equal((await health.json()).version, expected.version);
  console.log(`PASS ${expected.name}@${expected.version}: clean production install, CLI, HTTP startup, assets and first-administrator setup`);
} finally {
  await app.close();
}

// Install the published predecessor outside the workspace to exercise its actual schema.
const previous = join(root, 'previous');
npm(['install', '--prefix', previous, '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', 'virelo@0.6.0']);
const { startServer: startPrevious } = await import(pathToFileURL(join(previous, 'node_modules/virelo/dist/server.js')).href);
const dataDir = join(root, 'upgrade-data');
const savedMedia = join(root, 'saved-media');
await mkdir(savedMedia);
const options = { dataDir, host: '127.0.0.1', port: 0 };
const credentials = { username: 'upgrade-owner', password: '1234' };
const requestHeaders = { 'x-virelo-request': '1' };
const old = await startPrevious({ ...options, mediaPaths: [media] });
let libraryId;
try {
  const setup = await old.app.inject({ method: 'POST', url: '/api/auth/setup', headers: requestHeaders, payload: credentials });
  assert.equal(setup.statusCode, 200, setup.body);
  const cookie = setup.cookies[0];
  assert.ok(cookie);
  const library = await old.app.inject({ method: 'POST', url: '/api/libraries', cookies: { [cookie.name]: cookie.value }, headers: requestHeaders,
    payload: { path: savedMedia, label: 'Saved fixture' } });
  assert.equal(library.statusCode, 200, library.body);
  libraryId = library.json().id;
  assert.ok(libraryId);
} finally {
  await old.app.close();
}
const upgraded = await startServer({ ...options, mediaPaths: [] });
try {
  assert.equal((await upgraded.app.inject('/api/auth/status')).json().setupRequired, false);
  const login = await upgraded.app.inject({ method: 'POST', url: '/api/auth/login', headers: requestHeaders, payload: credentials });
  assert.equal(login.statusCode, 200, login.body);
  assert.equal(login.json().user.isAdmin, true);
  const cookie = login.cookies[0];
  const libraries = await upgraded.app.inject({ url: '/api/libraries', cookies: { [cookie.name]: cookie.value } });
  assert.equal(libraries.statusCode, 200, libraries.body);
  assert.ok(libraries.json().some(library => library.id === libraryId && library.label === 'Saved fixture'));
  console.log('PASS upgrade from published virelo@0.6.0 preserves the administrator and saved library ID');
} finally {
  await upgraded.app.close();
}
console.log('Audited tarball:', archive.path, archive.integrity);
console.log('SHA-256:', createHash('sha256').update(await readFile(archive.path)).digest('hex'));
