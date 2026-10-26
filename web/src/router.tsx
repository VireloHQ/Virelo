import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { createRouteView, RouteErrorView, RouteNavigationGuard, RoutePendingView } from './components/RouteRecovery';
import { Header } from './components/Header';
import { AppearanceProvider } from './components/AppearanceProvider';
import { MobileNav } from './components/MobileNav';
import { NotFoundView } from './views/NotFoundView';
import type { SortKey } from './types';
import { validateShortsSearch } from './utils/shorts-navigation';
import { PlaybackAccess, useAccount } from './components/AccountSession';
import { ActivityDisclosure } from './components/ActivityDisclosure';
import { useScanRefresh } from './hooks/useScanRefresh';

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
  const path = pathname.replace(/\/$/, '') || '/';
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
  folder?: string;
  libraryId?: number;
  sort?: SortKey;
  search?: string;
}

function validateWatchSearch(input: Record<string, unknown>): WatchRouteSearch {
  return {
    queue: input.queue === true || input.queue === '1' || input.queue === 'true',
    favorites: input.favorites === true || input.favorites === '1' || input.favorites === 'true',
    playlistId: (typeof input.playlistId === 'number' || typeof input.playlistId === 'string' && /^\d+$/.test(input.playlistId)) && Number.isSafeInteger(Number(input.playlistId)) && Number(input.playlistId) > 0 ? Number(input.playlistId) : undefined,
    folder: typeof input.folder === 'string' && input.folder !== '' ? input.folder.slice(0, 500) : undefined,
    libraryId: typeof input.libraryId === 'string' && /^\d+$/.test(input.libraryId) ? Number(input.libraryId) : undefined,
    sort: (['title', 'newest', 'oldest', 'year', 'duration', 'random'] as string[]).includes(String(input.sort ?? '')) ? input.sort as SortKey : undefined,
    search: typeof input.search === 'string' && input.search !== '' ? input.search.slice(0, 200) : undefined
  };
}

function Shell() {
  useScanRefresh();
  const policy=useAccount()?.monitoring;
  return <AppearanceProvider><div className={'app-shell'+(policy?.enabled?' activity-monitored':'')}><RouteNavigationGuard viewForPath={viewForPath} /><Header /><main className="page-shell"><ActivityDisclosure policy={policy} compact/><Outlet /></main><MobileNav /></div></AppearanceProvider>;
}

const rootRoute = createRootRoute({ component: Shell, notFoundComponent: NotFoundView, errorComponent: RouteErrorView });
const indexRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/', component:HomeRouteView });
const libraryRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/library', component:LibraryRouteView });
const favoritesRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/favorites', component:FavoritesRouteView });
const playlistsRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/playlists', component:PlaylistsRouteView });
const playlistRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/playlists/$playlistId', component:PlaylistRouteView });
const settingsRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/settings', component:SettingsRouteView });
const watchRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/watch/$mediaId', component:()=> <PlaybackAccess><WatchRouteView/></PlaybackAccess>, validateSearch: validateWatchSearch });
const detailRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/title/$mediaId', component:DetailRouteView });
const shortsRoute = createRoute({ getParentRoute:()=>rootRoute, path:'/shorts', component:()=> <PlaybackAccess><ShortsRouteView/></PlaybackAccess>, validateSearch:validateShortsSearch });
const routeTree = rootRoute.addChildren([indexRoute, libraryRoute, favoritesRoute, playlistsRoute, playlistRoute, settingsRoute, watchRoute, detailRoute, shortsRoute]);
export const router = createRouter({
  routeTree, defaultPreload: 'intent', scrollRestoration: true,
  defaultErrorComponent: RouteErrorView,
  defaultPendingComponent: () => <RoutePendingView viewForPath={viewForPath} />,
  defaultPendingMs: 150
});
declare module '@tanstack/react-router' { interface Register { router: typeof router } }
