import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function publicPreview(): Plugin {
  return {
    name: 'public-and-app-preview',
    config(_config, environment) { if (environment.isPreview) return { appType: 'mpa' }; },
    configurePreviewServer(server) {
      const headers = readFileSync(resolve(server.config.root, server.config.build.outDir, '_headers'), 'utf8');
      const csp = headers.match(/^\s+Content-Security-Policy:\s*(.+)$/m)?.[1]?.trim();
      if (!csp) throw new Error('Production CSP missing from preview build');
      server.middlewares.use((request, response, next) => {
        response.setHeader('Content-Security-Policy', csp);
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (/^\/(?:app(?:\/|$)|(?:library|favorites|settings|shorts)\/?$|(?:watch|title)\/)/.test(url.pathname)) request.url = '/app.html' + url.search;
        next();
      });
    }
  };
}
