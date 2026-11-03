import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { LandingView } from './views/LandingView';
import { SetupGuideView } from './views/SetupGuideView';
import { publicPaths } from './public-site';

export function createPublicRouter(pathname?: string) {
  const root = createRootRoute({ component: Outlet });
  const routes = Object.values(publicPaths).flatMap(paths => [
    createRoute({ getParentRoute: () => root, path: paths.landing, component: LandingView }),
    createRoute({ getParentRoute: () => root, path: paths.setup, component: SetupGuideView })
  ]);
  // The static document must not emit TanStack's self-removing inline scroll script.
  // Our CSP disallows executable inline scripts; client-side restoration remains enabled.
  const router = createRouter({ routeTree: root.addChildren(routes), scrollRestoration: !pathname,
    ...(pathname ? { history: createMemoryHistory({ initialEntries: [pathname] }), isServer: true } : {}) });
  // These eager, data-free routes are loaded before rendering on both sides.
  // Keep TanStack's SSR boundary shape during hydration; no serialized loader data is needed.
  router.ssr = { manifest: undefined };
  return router;
}
