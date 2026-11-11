import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8');

test('package and lockfile agree on AGPL version 3 only', () => {
  assert.equal(pkg.license, 'AGPL-3.0-only');
  assert.equal(lock.packages[''].license, pkg.license);
  if (pkg.name === 'virelo') {
    assert.ok(pkg.files.includes('LICENSE'));
    assert.ok(pkg.files.includes('LICENSES'));
  }
});

test('the full AGPL is identical in source and deployed web assets', async () => {
  const publicLicense = await readFile(new URL('../web/public/LICENSE.txt', import.meta.url), 'utf8');
  const builtLicense = await readFile(new URL(pkg.name === 'virelo' ? '../dist/web/LICENSE.txt' : '../dist/LICENSE.txt', import.meta.url), 'utf8');
  assert.equal(publicLicense, license);
  assert.equal(builtLicense, license);
  assert.match(license, /GNU AFFERO GENERAL PUBLIC LICENSE/);
  assert.match(license, /Version 3, 19 November 2007/);
  assert.match(license, /13\. Remote Network Interaction/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
});

test('legacy permissions and contributor copyright notices survive the change', async () => {
  const legacy = await readFile(new URL('../LICENSES/LEGACY-MIT.txt', import.meta.url), 'utf8');
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  const contributing = await readFile(new URL('../CONTRIBUTING.md', import.meta.url), 'utf8');
  assert.match(legacy, /^MIT License/);
  assert.match(legacy, /Copyright \(c\) 2026 Virelo contributors/);
  assert.match(readme, /AGPL-3\.0-only/);
  assert.match(readme, /Commercial use and sale are permitted/);
  assert.match(readme, /Third-party dependencies and assets retain their own licenses/);
  assert.match(contributing, /New contributions are licensed under AGPL-3\.0-only/);
});

test('settings offer the matching project source and a local full license', async () => {
  const settings = await readFile(new URL('../web/src/views/SettingsView.tsx', import.meta.url), 'utf8');
  const source = pkg.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  assert.ok(settings.includes('href="' + source + '"'));
  assert.ok(settings.includes('href="/LICENSE.txt"'));
  assert.ok(settings.includes('Copyright (c) 2026 Virelo contributors. No warranty.'));
});
