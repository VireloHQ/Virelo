import { readFileSync } from 'node:fs';

interface PackageMetadata { version?: string }

function readVersion() {
  try {
    const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as PackageMetadata;
    return packageJson.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export const VIRELO_VERSION = readVersion();
