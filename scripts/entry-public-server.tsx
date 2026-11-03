import { renderToString } from 'react-dom/server';
import { RouterProvider } from '@tanstack/react-router';
import { createPublicRouter } from '../web/src/public-router';
import { LocaleRoot } from '../web/src/i18n/LocaleRoot';
import { setLocale } from '../web/src/i18n';
import { publicLocation, publicMetadata } from '../web/src/public-site';

export async function renderPublicPage(pathname: string) {
  const location = publicLocation(pathname);
  if (!location) throw new Error('Public page not found: ' + pathname);
  // Build-time generation is sequential; no request data or live SSR state is shared.
  await setLocale(location.locale, false);
  const router = createPublicRouter(pathname);
  await router.load();
  const html = renderToString(<LocaleRoot><RouterProvider router={router} /></LocaleRoot>);
  if (!html.includes(location.page === 'landing' ? 'id="landing-title"' : 'id="setup-title"')) throw new Error('Public page did not render: ' + pathname);
  return { html, meta: publicMetadata(location.locale, location.page), locale: location.locale, page: location.page };
}

export { publicGraph, publicPaths } from '../web/src/public-site';
