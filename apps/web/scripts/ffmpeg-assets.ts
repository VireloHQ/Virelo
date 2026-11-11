import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';
import { AVI_CORE_PATH } from '../web/src/utils/avi.ts';

export function ffmpegAssets(): Plugin {
  let assets: Promise<Map<string, { bytes: Uint8Array; mime: string }>> | undefined;
  const load = () => assets ??= (async () => {
    const umd = pathToFileURL(createRequire(import.meta.url).resolve('@ffmpeg/core'));
    const directory = new URL('../esm/', umd);
    const wasm = await readFile(new URL('ffmpeg-core.wasm', directory));
    return new Map([
      ['ffmpeg-core.js', { bytes: await readFile(new URL('ffmpeg-core.js', directory)), mime: 'text/javascript' }],
      ['ffmpeg-core.wasm.gz', { bytes: gzipSync(wasm, { level: 9 }), mime: 'application/gzip' }],
      ['LICENSE.txt', { bytes: await readFile(new URL('../LICENSES/FFmpeg-GPL-3.0.txt', import.meta.url)), mime: 'text/plain' }],
      ['NOTICE.txt', { bytes: await readFile(new URL('../LICENSES/FFmpeg-NOTICE.txt', import.meta.url)), mime: 'text/plain' }]
    ]);
  })();
  return {
    name: 'local-avi-codecs',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0];
        if (!path?.startsWith(AVI_CORE_PATH + '/')) return next();
        void load().then(files => {
          const file = files.get(path.slice(AVI_CORE_PATH.length + 1));
          if (!file) { response.statusCode = 404; response.end(); return; }
          response.setHeader('Content-Type', file.mime); response.end(file.bytes);
        }).catch(error => next(error));
      });
    },
    async generateBundle() {
      for (const [name, file] of await load()) this.emitFile({ type: 'asset', fileName: AVI_CORE_PATH.slice(1) + '/' + name, source: file.bytes });
    }
  };
}
