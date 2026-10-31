import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const path = require.resolve('@fastify/static/package.json');
assert.equal(path, fileURLToPath(new URL('../node_modules/@fastify/static/package.json', import.meta.url)), 'only prepare the local installed dependency');
const metadata = JSON.parse(await readFile(path, 'utf8'));
const fromStatic = createRequire(path);
const glob = fromStatic('glob/package.json');
assert.equal(Number(glob.version.split('.')[0]), 14, 'bundle the tested glob major');
assert.ok(root.bundleDependencies.includes('@fastify/static'));
const range = root.overrides.glob;
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const original = lock.packages['node_modules/@fastify/static'].dependencies.glob;
assert.ok(['^13.0.0', range].includes(original), 'review changed upstream dependency requirements');
assert.ok([original, range].includes(metadata.dependencies.glob));
const desired = process.argv.includes('--restore') ? original : range;
// Bundled dependencies do not inherit the publisher's overrides in a consumer project.
// Keep the shipped manifest consistent with the tested, bundled glob 14 implementation.
if (metadata.dependencies.glob !== desired) {
  metadata.dependencies.glob = desired;
  await writeFile(path, JSON.stringify(metadata, null, 2) + '\n');
}
