import test from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { terminalMediaPath } from '../dist/terminal-ui.js';

test('TUI folder entry resolves relative to the client terminal, not the server', () => {
  const cwd = resolve('my-terminal');
  assert.equal(terminalMediaPath('movies', cwd), resolve(cwd, 'movies'));
  assert.equal(terminalMediaPath('  ./anime  ', cwd), resolve(cwd, 'anime'));
  assert.equal(terminalMediaPath('~/Videos', cwd), resolve(homedir(), 'Videos'));
  assert.equal(terminalMediaPath('~', cwd), homedir());
  assert.equal(terminalMediaPath('  ', cwd), null);
});
