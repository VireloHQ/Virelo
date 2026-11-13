import { createRootRoute, createRoute, createRouter, Outlet, redirect } from '@tanstack/react-router';
import { createRouteView, RouteErrorView, RouteNavigationGuard, RoutePendingView } from './components/RouteRecovery';
import { Header } from './components/Header';
import { AppearanceProvider } from './components/AppearanceProvider';
import { MobileNav } from './components/MobileNav';
import { NotFoundView } from './views/NotFoundView';
import type { SortKey } from './types';
import { validateShortsSearch } from '@virelo/core/shorts-navigation';
import { useScanRefresh } from './hooks/useScanRefresh';
import { MediaServicesProvider } from '@virelo/web-ui/media-services.tsx';
import { api, artwork } from './api';
const mediaServices = { api, artwork };
import { appLocationRewrite, APP_ORIGIN, publicAppPath } from './utils/app-location';
import { isLocale, LANGUAGE_KEY, type Locale } from './i18n/locale';
const HomeRouteView = createRouteView(() => import('./views/HomeView'), 'HomeView', 'home');
const FavoritesRouteView = createRouteView(() => import('./views/FavoritesView'), 'FavoritesView', 'library');
const PlaylistsRouteView = createRouteView(() => import('./views/PlaylistsView'), 'PlaylistsView', 'library');
const PlaylistRouteView = createRouteView(() => import('./views/PlaylistsView'), 'PlaylistView', 'library');
const LibraryRouteView = createRouteView(() => import('./views/LibraryView'), 'LibraryView', 'library');
const SettingsRouteView = createRouteView(() => import('./views/SettingsView'), 'SettingsView', 'settings');
const WatchRouteView = createRouteView(() => import('./views/WatchView'), 'WatchView', 'watch');
const DetailRouteView = createRouteView(() => import('./views/DetailView'), 'DetailView', 'detail');
const ShortsRouteView = createRouteView(() => import('./views/ShortsView'), 'ShortsView', 'shorts');

function viewForPath(pathname: string) {
  const path = pathname.replace(/^\/app(?=\/|$)/, '').replace(/\/$/, '') || '/';
  if (path === '/') return HomeRouteView;
  if (path === '/favorites') return FavoritesRouteView;
  if (path === '/playlists') return PlaylistsRouteView;
  if (/^\/playlists\/[^/]+$/.test(path)) return PlaylistRouteView;
  if (path === '/library') return LibraryRouteView;
  if (path === '/settings') return SettingsRouteView;
  if (path === '/shorts') return ShortsRouteView;
  if (/^\/watch\/[^/]+$/.test(path)) return WatchRouteView;
  if (/^\/title\/[^/]+$/.test(path)) return DetailRouteView;
}

export interface WatchRouteSearch {
  queue?: boolean;
  favorites?: boolean;
  playlistId?: number;
  seriesTitle?: string;
  folder?: string;
  exactFolder?: boolean;
  libraryId?: number;
  sort?: SortKey;
  search?: string;
}

function validateWatchSearch(input: Record<string, unknown>): WatchRouteSearch {
  return {
    queue: input.queue === true || input.queue === '1' || input.queue === 'true',
    favorites: input.favorites === true || input.favorites === '1' || input.favorites === 'true',
    playlistId: (typeof input.playlistId === 'number' || typeof input.playlistId === 'string' && /^\d+$/.test(input.playlistId)) && Number.isSafeInteger(Number(input.playlistId)) && Number(input.playlistId) > 0 ? Number(input.playlistId) : undefined,
    seriesTitle: typeof input.seriesTitle === 'string' && input.seriesTitle.trim() ? input.seriesTitle.trim().slice(0, 512) : undefined,
    folder: typeof input.folder === 'string' ? input.folder.slice(0, 4096) : undefined,
    exactFolder: input.exactFolder === true || input.exactFolder === '1' || input.exactFolder === 'true' || undefined,
    libraryId: Number.isSafeInteger(Number(input.libraryId)) && Number(input.libraryId)>0 ? Number(input.libraryId) : undefined,
    sort: (['title', 'newest', 'oldest', 'year', 'duration', 'random'] as string[]).includes(String(input.sort ?? '')) ? input.sort as SortKey : undefined,
    search: typeof input.search === 'string' && input.search !== '' ? input.search.slice(0, 200) : undefined
  };
}

function Shell() {
  useScanRefresh();
  return <MediaServicesProvider services={mediaServices}><AppearanceProvider><div className="app-shell"><Header /><main className="page-shell"><Outlet /></main><MobileNav /></div></AppearanceProvider></MediaServicesProvider>;
}

function Root() {
  return <><RouteNavigationGuard viewForPath={viewForPath} /><Outlet /></>;
}

const rootRoute = createRootRoute({ component: Root, notFoundComponent: NotFoundView, errorComponent: RouteErrorView });
const indexRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/', beforeLoad:()=>{ throw redirect({to:'/app'}); } });
const appRoute = createRoute({ getParentRoute:()=>rootRoute, path:'app', component:Shell });
const appIndexRoute = createRoute({ getParentRoute:()=>appRoute, path:'/', component:HomeRouteView });
const libraryRoute = createRoute({ getParentRoute:()=>appRoute, path:'library', component:LibraryRouteView });
const favoritesRoute = createRoute({ getParentRoute:()=>appRoute, path:'favorites', component:FavoritesRouteView });
const playlistsRoute = createRoute({ getParentRoute:()=>appRoute, path:'playlists', component:PlaylistsRouteView });
const playlistRoute = createRoute({ getParentRoute:()=>appRoute, path:'playlists/$playlistId', component:PlaylistRouteView });
const settingsRoute = createRoute({ getParentRoute:()=>appRoute, path:'settings', component:SettingsRouteView });
const watchRoute = createRoute({ getParentRoute:()=>appRoute, path:'watch/$mediaId', component:WatchRouteView, validateSearch: validateWatchSearch });
const detailRoute = createRoute({ getParentRoute:()=>appRoute, path:'title/$mediaId', component:DetailRouteView });
const shortsRoute = createRoute({ getParentRoute:()=>appRoute, path:'shorts', component:ShortsRouteView, validateSearch:validateShortsSearch });
const legacyLibraryRoute = createRoute({ getParentRoute:()=>rootRoute, path:'library', beforeLoad:()=>{ throw redirect({to:'/app/library'}); } });
const legacyFavoritesRoute = createRoute({ getParentRoute:()=>rootRoute, path:'favorites', beforeLoad:()=>{ throw redirect({to:'/app/favorites'}); } });
const legacySettingsRoute = createRoute({ getParentRoute:()=>rootRoute, path:'settings', beforeLoad:()=>{ throw redirect({to:'/app/settings'}); } });
const legacyShortsRoute = createRoute({ getParentRoute:()=>rootRoute, path:'shorts', validateSearch:validateShortsSearch, beforeLoad:({search})=>{ throw redirect({to:'/app/shorts',search}); } });
const legacyWatchRoute = createRoute({
  getParentRoute:()=>rootRoute,
  path:'watch/$mediaId',
  validateSearch: validateWatchSearch,
  beforeLoad:({params,search})=>{ throw redirect({to:'/app/watch/$mediaId',params,search}); }
});
const legacyDetailRoute = createRoute({
  getParentRoute:()=>rootRoute,
  path:'title/$mediaId',
  beforeLoad:({params})=>{ throw redirect({to:'/app/title/$mediaId',params}); }
});
const routeTree = rootRoute.addChildren([
  indexRoute,
  appRoute.addChildren([appIndexRoute, libraryRoute, favoritesRoute, playlistsRoute, playlistRoute, settingsRoute, watchRoute, detailRoute, shortsRoute]),
  legacyLibraryRoute,
  legacyFavoritesRoute,
  legacySettingsRoute,
  legacyShortsRoute,
  legacyWatchRoute,
  legacyDetailRoute
]);
export const initialLocale: Locale | null = (() => {
  if (typeof window === 'undefined' || window.location.origin !== APP_ORIGIN) return null;
  const url = new URL(window.location.href);
  url.pathname = publicAppPath(url.pathname);
  const value = url.searchParams.get('lang');
  const language = isLocale(value) ? value : null;
  if (language) {
    try { localStorage.setItem(LANGUAGE_KEY, language); } catch { /* Apply the handoff to this visit even without storage. */ }
    url.searchParams.delete('lang');
  }
  if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url);
  return language;
})();
export const router = createRouter({
  rewrite: appLocationRewrite,
  routeTree, defaultPreload: 'intent', scrollRestoration: true,
  defaultErrorComponent: RouteErrorView,
  defaultPendingComponent: () => <RoutePendingView viewForPath={viewForPath} />,
  defaultPendingMs: 150
});
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
