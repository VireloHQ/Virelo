import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';

export interface RuntimeConfig {
  dataDir: string;
  host: string;
  port: number;
  mediaPaths: string[];
}

export function defaultDataDir(): string {
  return resolve(homedir(), '.virelo');
}

export function ensureDataDirs(dataDir: string) {
  for (const dir of [dataDir, resolve(dataDir, 'thumbnails'), resolve(dataDir, 'artwork'), resolve(dataDir, 'cache'), resolve(dataDir, 'cache', 'hls'), resolve(dataDir, 'cache', 'audio')]) {
    mkdirSync(dir, { recursive: true });
  }
}
