import type { Stats } from 'node:fs';
import { realpathSync, statSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, isAbsolute, relative, sep } from 'node:path';

const VIDEO_EXTENSIONS = new Set(['.mp4','.m4v','.mkv','.webm','.mov','.avi','.wmv','.mpg','.mpeg','.ts','.m2ts','.flv','.ogv','.3gp']);

export function resolveLibraryFile(path:string,root:string):string|null {
  try {
    // Roots are canonical at registration; a later junction must not retarget a grant.
    if(relative(root,realpathSync.native(root)))return null;
    const actual=realpathSync.native(path),rest=relative(root,actual);
    if(!rest||rest==='..'||rest.startsWith('..'+sep)||isAbsolute(rest)||!statSync(actual).isFile())return null;
    return actual;
  }catch{return null;}
}

export function ignoredMediaEntry(name: string) {
  return name.startsWith('.') || name.toLowerCase() === 'node_modules';
}

export function isVideoPath(path: string) {
  return VIDEO_EXTENSIONS.has(extname(path).toLowerCase());
}

export async function isMediaFile(path: string) {
  if (!isVideoPath(path)) return false;
  if (extname(path).toLowerCase() !== '.ts') return true;
  // Transport streams and TypeScript share .ts; check packet sync before invoking media tools.
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(4096);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    for (const stride of [188, 192, 204]) {
      for (let offset = 0; offset < stride && offset + stride * 2 < bytesRead; offset++) {
        if (buffer[offset] === 0x47 && buffer[offset + stride] === 0x47 && buffer[offset + stride * 2] === 0x47) return true;
      }
    }
    return false;
  } finally { await file.close(); }
}

export function mediaWatchFilter(roots: string[]) {
  const ordered = [...roots].sort((a, b) => b.length - a.length);
  return (path: string, stats?: Stats) => {
    const root = ordered.find(root => {
      const rest = relative(root, path);
      return rest !== '..' && !rest.startsWith('..' + sep) && !isAbsolute(rest);
    });
    if (!root) return false;
    const rest = relative(root, path);
    if (rest && rest.split(/[\\/]/).some(ignoredMediaEntry)) return true;
    return Boolean(stats && !stats.isDirectory() && (!stats.isFile() || !isVideoPath(path)));
  };
}
