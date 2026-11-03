import type { Plugin } from 'vite';

export function publicPreview(): Plugin {
  return {
    name: 'public-and-app-preview',
    config(_config, environment) { if (environment.isPreview) return { appType: 'mpa' }; },
    configurePreviewServer(server) {
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if (/^\/(?:app(?:\/|$)|(?:library|favorites|settings|shorts)\/?$|(?:watch|title)\/)/.test(url.pathname)) request.url = '/app.html' + url.search;
        next();
      });
    }
  };
}
