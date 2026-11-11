import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const server = fileURLToPath(new URL('../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const files = ['dist', 'README.md', 'PRIVACY.md', 'SECURITY.md', 'CHANGELOG.md', 'LICENSE', 'LICENSES'];
const bundled = ['@fastify/static'];
const bundleScript = 'scripts/prepare-static-bundle.mjs';
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));

export function npm(args, cwd = workspace) {
  assert.ok(process.env.npm_execpath, 'Run this command through npm');
  return execFileSync(process.execPath, [process.env.npm_execpath, ...args], {
    cwd, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024, windowsHide: true
  });
}

export async function packRelease({ destination = join(workspace, '.release'), dryRun = false } = {}) {
  const { devDependencies: _, scripts: _scripts, ...manifest } = await readJson(join(server, 'package.json'));
  const { overrides } = await readJson(join(workspace, 'package.json'));
  const lockFile = join(server, 'release-lock.json');
  const lock = await readJson(lockFile);
  assert.equal(manifest.name, 'virelo');
  assert.equal(manifest.version, lock.version);
  assert.equal(manifest.version, lock.packages[''].version);
  assert.equal(manifest.engines.node, lock.packages[''].engines.node);
  assert.deepEqual(manifest.dependencies, lock.packages[''].dependencies);
  assert.deepEqual(manifest.files, files);
  assert.deepEqual(lock.packages[''].bundleDependencies, bundled);
  assert.equal(overrides.glob, lock.packages['node_modules/glob'].version,
    'pin the bundled glob override to the exact release-lock version');
  assert.ok(Object.values(manifest.dependencies).every(value => !/^(?:workspace|file|link):/.test(value)));
  const stage = await mkdtemp(join(tmpdir(), 'virelo-npm-stage-'));
  try {
    await mkdir(join(stage, 'scripts'));
    await cp(join(server, bundleScript), join(stage, bundleScript));
    await cp(lockFile, join(stage, 'package-lock.json'));
    await Promise.all(files.map(file => cp(join(server, file), join(stage, file), { recursive: true })));
    await writeFile(join(stage, 'package.json'), JSON.stringify({
      ...manifest, overrides, bundleDependencies: bundled,
      scripts: { prepack: 'node ' + bundleScript, postpack: 'node ' + bundleScript + ' --restore' }
    }, null, 2) + '\n');
    npm(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], stage);
    const out = resolve(destination);
    if (!dryRun) await mkdir(out, { recursive: true });
    const [archive] = JSON.parse(npm(['pack', '--json', ...(dryRun ? ['--dry-run'] : ['--pack-destination', out])], stage));
    assert.equal(archive.filename, `virelo-${manifest.version}.tgz`);
    assert.ok(archive.files.every(({ path }) => ['package.json', ...files].some(file => path === file || path.startsWith(file + '/'))
      || path.startsWith('node_modules/')), 'package contains only published artifacts');
    return { ...archive, path: join(out, archive.filename) };
  } finally {
    const target = relative(resolve(tmpdir()), stage);
    assert.ok(/^virelo-npm-stage-[^/\\]+$/.test(target), 'only remove the temporary release staging directory');
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dryRun = process.argv.includes('--dry-run');
  const archive = await packRelease({ dryRun });
  console.log(dryRun ? `Would pack ${archive.filename} (${archive.files.length} files)` : archive.path);
  console.log(`Integrity: ${archive.integrity}`);
}
