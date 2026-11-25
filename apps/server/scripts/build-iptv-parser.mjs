import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

// The npm package ships one compiled copy of the same parser used by Web.
const source=await readFile(new URL('../../../packages/core/src/utils/iptv.ts',import.meta.url),'utf8');
await writeFile(new URL('../dist/iptv-parser.js',import.meta.url),stripTypeScriptTypes(source));
