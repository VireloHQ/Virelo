import type { ReactNode } from 'react';
import { Broadcast, FilmStrip, Heart, House, ListBullets, DeviceMobile, SquaresFour, Television, type Icon } from '@phosphor-icons/react';
import '../header-nav.css';

type HeaderNavSection = 'home' | 'movies' | 'series' | 'library' | 'shorts' | 'favorites' | 'playlists' | 'live-tv';

const icons: Record<HeaderNavSection, Icon> = {
  home: House,
  movies: FilmStrip,
  series: Television,
  library: SquaresFour,
  shorts: DeviceMobile,
  favorites: Heart,
  playlists: ListBullets,
  'live-tv': Broadcast,
};

export function HeaderNavLabel({ section, children }: { section: HeaderNavSection; children: ReactNode }) {
  const Icon = icons[section];
  return <><Icon className="header-nav-icon" aria-hidden="true" /><span>{children}</span></>;
}
