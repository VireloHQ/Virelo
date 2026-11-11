import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

export function sourceUrl(path, testUrl) {
  const local = new URL('../web/src/' + path, testUrl);
  const shared = new URL('../packages/web-ui/src/' + path, import.meta.url);
  return existsSync(local) ? local : shared;
}

export function readSource(path, testUrl) {
  return readFile(sourceUrl(path, testUrl), 'utf8');
}
