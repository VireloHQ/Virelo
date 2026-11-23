import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function playerPreview(): Plugin {
  return {
    name: 'player-preview',
    config(_config, environment) { if (environment.isPreview) return { appType: 'mpa' }; },
    configurePreviewServer(server) {
      const headers = readFileSync(resolve(server.config.root, server.config.build.outDir, '_headers'), 'utf8');
      const csp = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
      const liveTvCsp=headers.split(/^\/media\/iptv\/\*\s*$/m)[1]?.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
      if (!csp||!liveTvCsp) throw new Error('Production CSP missing from preview build');
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        response.setHeader('Content-Security-Policy',url.pathname.startsWith('/media/iptv/')?liveTvCsp:csp);
        if (/^\/(?:app(?:\/|$)|(?:library|favorites|playlists|settings|shorts)\/?$|(?:watch|title|playlists)\/)/.test(url.pathname)) request.url = '/app.html' + url.search;
        next();
      });
    }
  };
}
