import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';

export function attachmentHeader(filename:string) {
  const name=filename.replace(/[\\/\u0000-\u001f\u007f]/g,'_')||'video';
  const fallback=name.replace(/[^\x20-\x7e]|["%]/g,'_');
  const encoded=encodeURIComponent(Buffer.from(name).toString()).replace(/[!'()*]/g,char=>'%'+char.charCodeAt(0).toString(16).toUpperCase());
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export function downloadRevision(info:Stats) {
  return '"'+createHash('sha256').update([info.dev,info.ino,info.size,info.mtimeMs,info.ctimeMs].join(':')).digest('base64url')+'"';
}
