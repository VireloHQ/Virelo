import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const root = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const path = require.resolve('@fastify/static/package.json');
const metadata = JSON.parse(await readFile(path, 'utf8'));
const fromStatic = createRequire(path);
const glob = fromStatic('glob/package.json');
assert.equal(Number(glob.version.split('.')[0]), 14, 'bundle the tested glob major');
assert.ok(root.bundleDependencies.includes('@fastify/static'));
const range = root.overrides['@fastify/static'].glob;
assert.ok(['^13.0.0', range].includes(metadata.dependencies.glob), 'review changed upstream dependency requirements');
// Bundled dependencies do not inherit the publisher's overrides in a consumer project.
// Keep the shipped manifest consistent with the tested, bundled glob 14 implementation.
if (metadata.dependencies.glob !== range) {
  metadata.dependencies.glob = range;
  await writeFile(path, JSON.stringify(metadata, null, 2) + '\n');
}
