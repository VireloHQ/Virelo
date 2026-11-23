import { AccountError } from './accounts.js';
import { isHlsManifest } from './iptv-parser.js';

export type IptvResourceKind='manifest'|'segment';

export function relayIptvManifest(text:string,resource:(reference:string,kind:IptvResourceKind)=>string) {
  if(!isHlsManifest(text))throw new AccountError('Only unencrypted HLS streams are supported.',415);
  let nextManifest=false;
  return text.split(/\r?\n/).map(raw=>{
    const line=raw.trim();
    if(line.startsWith('#EXT-X-STREAM-INF:'))nextManifest=true;
    if(/^#EXT-X-KEY:METHOD=NONE$/.test(line))return line;
    if(/^#EXT-X-(?:KEY|SESSION-KEY|DEFINE|CONTENT-STEERING):/.test(line))
      throw new AccountError('Only unencrypted HLS streams are supported.',415);
    // The regular media segments are also present in compatible low-latency streams.
    if(/^#EXT-X-(?:PART(?:-INF)?|SERVER-CONTROL|PRELOAD-HINT|RENDITION-REPORT):/.test(line))return '';
    if(!line)return line;
    if(!line.startsWith('#')){
      const kind=nextManifest?'manifest':'segment';
      nextManifest=false;
      return resource(line,kind);
    }
    if(!/\bURI\s*=/i.test(line))return line;
    const match=/^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|MAP):/.exec(line);
    if(!match||!/(?:[:,])URI="[^"]+"/.test(line))throw new AccountError('Only unencrypted HLS streams are supported.',415);
    return line.replace(/([:,])URI="([^"]+)"/g,(_,separator:string,url:string)=>
      `${separator}URI="${resource(url,match[1]==='MAP'?'segment':'manifest')}"`);
  }).join('\n');
}
