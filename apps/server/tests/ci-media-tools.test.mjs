import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

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

test('mirror rewrite covers Azure and EC2 without changing security feeds', { skip: process.platform === 'win32' }, () => {
  const expression = installs[0].match(/sudo sed -E -i '([^']+)'/)?.[1];
  assert.ok(expression);
  const mirrors = [
    'http://azure.archive.ubuntu.com/ubuntu',
    'http://us-east-2.ec2.archive.ubuntu.com/ubuntu/',
    'https://archive.ubuntu.com/ubuntu/',
    'http://security.ubuntu.com/ubuntu'
  ];
  const output = execFileSync('sed', ['-E', expression], { input: mirrors.join('\n') + '\n', encoding: 'utf8' });
  assert.deepEqual(output.trim().split('\n'), [
    ...Array(3).fill('https://archive.ubuntu.com/ubuntu/'),
    'http://security.ubuntu.com/ubuntu'
  ]);
});
