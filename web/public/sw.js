const CACHE_NAME = 'virelo-shell-transparent-1';

function responseKind(request, url) {
  if (/^\/(?:api|hls|audio|playback|media)(?:\/|$)/.test(url.pathname)) return null;
  if (url.pathname === '/startup.js') return 'script';
  if (url.pathname === '/assets' || url.pathname.startsWith('/assets/')) {
    if (/\.m?js$/i.test(url.pathname)) return 'script';
    if (/\.css$/i.test(url.pathname)) return 'style';
    if (/\.(?:woff2?|ttf|otf)$/i.test(url.pathname)) return 'font';
    if (/\.wasm$/i.test(url.pathname)) return 'wasm';
    if (/\.(?:png|jpe?g|webp|avif|gif|svg|ico)$/i.test(url.pathname)) return 'image';
    return null;
  }
  if (url.pathname === '/manifest.webmanifest') return 'manifest';
  if (/^\/(?:favicon-\d+|virelo-icon(?:-\d+)?)\.png$/.test(url.pathname)) return 'image';
  if (url.pathname === '/' || url.pathname === '/index.html'
    || (request.mode === 'navigate' && !/\.[^/]+$/.test(url.pathname))) return 'document';
  return null;
}

function validResponse(response, kind) {
  if (!response || response.status !== 200 || response.headers.has('Content-Range')) return false;
  const mime = (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  switch (kind) {
    case 'script': return /^(?:text|application)\/(?:javascript|ecmascript|x-javascript)$/.test(mime);
    case 'style': return mime === 'text/css';
    case 'font': return mime.startsWith('font/') || ['application/font-woff', 'application/octet-stream'].includes(mime);
    case 'wasm': return mime === 'application/wasm';
    case 'image': return mime.startsWith('image/');
    case 'manifest': return ['application/manifest+json', 'application/json'].includes(mime);
    case 'document': return mime === 'text/html';
    default: return false;
  }
}

function cacheKey(request, url, kind) {
  // Keep a bounded shell, but retain exact hashed assets for still-open builds.
  if (kind === 'document') return '/';
  if ((kind === 'script' || kind === 'style') && url.searchParams.has('virelo-retry')) {
    const key = new URL(url);
    key.search = key.search.slice(1).split('&').filter((part) => !new URLSearchParams(part).has('virelo-retry')).join('&');
    return new Request(key.href, request);
  }
  return request;
}

async function readCached(key, kind) {
  try {
    const response = await (await caches.open(CACHE_NAME)).match(key);
    return validResponse(response, kind) ? response : null;
  } catch {
    return null;
  }
}

async function writeCached(key, response) {
  try {
    await (await caches.open(CACHE_NAME)).put(key, response);
  } catch {
    // Storage may be unavailable or full; never evict a live build to make room.
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  // Other caches and old hashed modules may still belong to open tabs.
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (
    request.method !== 'GET'
    || url.origin !== self.location.origin
    || request.destination === 'video'
    || request.destination === 'audio'
    || request.headers.has('Range')
  ) return;

  const kind = responseKind(request, url);
  if (!kind) return;
  const key = cacheKey(request, url, kind);
  const result = (async () => {
    let response;
    try {
      response = await fetch(request);
      if (validResponse(response, kind)) return { response, cacheResponse: response.clone() };
    } catch {
      // Network failures and invalid deployment responses use the same fallback.
    }
    const cached = await readCached(key, kind);
    return { response: cached || (response && !response.ok ? response : Response.error()) };
  })();
  event.respondWith(result.then(({ response }) => response));
  event.waitUntil(result.then(({ cacheResponse }) => cacheResponse && writeCached(key, cacheResponse)));
});
