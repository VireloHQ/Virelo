import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = fileURLToPath(new URL('../', import.meta.url));
assert.ok(process.env.npm_execpath, 'Run this audit with npm run audit:package');
const npm = (args, cwd = repo) => execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
});
const root = await mkdtemp(join(tmpdir(), 'virelo-package-audit-'));
console.log('Package audit fixtures:', root);
const expected = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const sourceAudit = JSON.parse(npm(['audit', '--json']));
assert.equal(sourceAudit.metadata.vulnerabilities.total, 0, 'build and production dependencies have no known npm advisories');
const packed = JSON.parse(npm(['pack', '--json', '--pack-destination', root]));
const archive = Array.isArray(packed) ? packed[0] : packed[expected.name] ?? packed;
assert.equal(archive.filename, `virelo-${expected.version}.tgz`);
const install = join(root, 'install');
npm(['install', '--prefix', install, '--omit=dev', '--ignore-scripts', '--no-fund', '--no-audit', join(root, archive.filename)]);
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
const locked = JSON.parse(await readFile(join(repo, 'package-lock.json'), 'utf8'));
const localStatic = JSON.parse(await readFile(join(repo, 'node_modules/@fastify/static/package.json'), 'utf8'));
assert.equal(localStatic.dependencies.glob, locked.packages['node_modules/@fastify/static'].dependencies.glob, 'postpack restores the development dependency manifest');
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
