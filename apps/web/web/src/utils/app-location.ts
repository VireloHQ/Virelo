export const APP_ORIGIN = 'https://app.virelo.dev';
export const LEGACY_HOST = 'virelo.riyo.me';

export function publicAppPath(path: string) {
  return path.replace(/^\/app(?=\/|$)/, '') || '/';
}

export function newAppUrl(current: string | URL) {
  const source = new URL(current), target = new URL(APP_ORIGIN);
  target.pathname = publicAppPath(source.pathname);
  target.search = source.search;
  target.searchParams.delete('legacy');
  target.hash = source.hash;
  return target;
}

export const appLocationRewrite = {
  input: ({ url }: { url: URL }) => {
    if (url.origin !== APP_ORIGIN) return;
    if (!/^\/app(?:\/|$)/.test(url.pathname)) url.pathname = '/app' + (url.pathname === '/' ? '' : url.pathname);
    return url;
  },
  output: ({ url }: { url: URL }) => {
    if (url.origin !== APP_ORIGIN) return;
    url.pathname = publicAppPath(url.pathname);
    return url;
  }
};
