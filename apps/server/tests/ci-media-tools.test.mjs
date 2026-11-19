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
    // Match hosted x64 runner bounds so a stalled URI yields to the next mirror promptly.
    assert.ok(line?.includes('Acquire::Retries=1') && line.includes('Acquire::http::Timeout=15') && line.includes('Acquire::https::Timeout=15'));
  }
  assert.match(installs[0], /ffmpeg -version/);
  assert.match(installs[0], /ffprobe -version/);
});

test('CI prefers an Ubuntu archive without removing runner fallbacks or signature checks', () => {
  const mirror = "printf '%s\\tpriority:0\\n' 'https://mirrors.kernel.org/ubuntu/'";
  assert.ok(installs[0].includes(mirror + ' | sudo tee -a /etc/apt/apt-mirrors.txt > /dev/null'));
  assert.doesNotMatch(workflow, /(?:sources\.list|ubuntu\.sources|allow-unauthenticated|trusted=yes|sudo sed)/);
  assert.equal(workflow.match(/npx playwright install --with-deps chromium/g)?.length, 2);
});

test('both full media suites budget for bounded tool setup and all browser audits', () => {
  const sections = workflow.split(/^  (?=\S)/m);
  for (const name of ['media-regressions', 'web-regressions']) {
    const job = sections.find(section => section.startsWith(name + ':'));
    assert.ok(job, `Missing ${name} job`);
    assert.match(job, /^    timeout-minutes: 20\r?$/m);
  }
});
