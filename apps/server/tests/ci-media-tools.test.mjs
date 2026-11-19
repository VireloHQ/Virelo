import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile(new URL('../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const installs = [...workflow.matchAll(/- name: Install FFmpeg\r?\n([\s\S]*?)(?=\r?\n      - )/g)].map(match => match[1]);

test('both media jobs use the same bounded FFmpeg installation and verify both tools', () => {
  assert.equal(installs.length, 2);
  assert.equal(installs[0], installs[1]);
  assert.match(installs[0], /timeout-minutes: 8/);
  for (const command of ['update', 'install']) {
    const line = installs[0].split('\n').find(line => line.includes('apt-get ' + command));
    assert.ok(line?.includes('Acquire::Retries=3') && line.includes('Acquire::https::Timeout=30'));
  }
  assert.match(installs[0], /ffmpeg -version/);
  assert.match(installs[0], /ffprobe -version/);
});

test('CI preserves runner package mirrors for FFmpeg and Playwright dependencies', () => {
  assert.doesNotMatch(workflow, /(?:apt-mirrors\.txt|sources\.list|ubuntu\.sources|archive\.ubuntu\.com)/);
  assert.equal(workflow.match(/npx playwright install --with-deps chromium/g)?.length, 2);
});
