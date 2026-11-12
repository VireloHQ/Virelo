import { t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Button, Input } from '@heroui/react';
import { MagnifyingGlass, Gear, X } from '@phosphor-icons/react';
import { useUIStore } from '@virelo/web-ui/store.ts';
import { HeaderNavLabel } from '@virelo/web-ui/components/HeaderNavLabel.tsx';
import { NotificationBell } from './Notifications';

export function Header() {
  useLocale();
  const navigate = useNavigate();
  const pathname = useLocation({select:location=>location.pathname});
  const isHome = pathname === '/';
  const isFavorites = pathname === '/favorites';
  const searchDestination = isFavorites ? '/favorites' : '/library';
  const homeFilter = useUIStore(s=>s.homeFilter);
  const setHomeFilter = useUIStore(s=>s.setHomeFilter);
  const search = useUIStore((s)=>s.search);
  const setSearch = useUIStore((s)=>s.setSearch);
  const searchOpen = useUIStore((s)=>s.mobileSearchOpen);
  const setMobileSearchOpen = useUIStore((s)=>s.setMobileSearchOpen);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchToggleRef = useRef<HTMLButtonElement>(null);
  const [animateSearch,setAnimateSearch] = useState(false);

  useEffect(() => {
    if (!searchOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [searchOpen]);
  const selectHomeCategory = (category: 'movie' | 'series') => {
    setHomeFilter(category);
    if (!isHome) void navigate({to:'/'});
  };
  const toggleSearch = () => {
    const nextOpen = !searchOpen;
    setMobileSearchOpen(nextOpen);
    if (nextOpen) void navigate({to:searchDestination});
    else setSearch('');
  };
  return (
    <header className={'topbar'+(isHome?' home-header':'')}>
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label={t("Virelo home")} onClick={()=>setHomeFilter('all')}>
          <span className="brand-mark"><img src="/virelo-icon-180.png?v=ribbon-1" alt="" width="42" height="42" decoding="async" /></span>
          <span className="brand-name">{t("Virelo")}</span>
        </Link>
        <nav className="desktop-nav" aria-label={t("Main navigation")}>
          <Link to="/" activeOptions={{exact:true}} activeProps={homeFilter==='all'?{className:'active'}:{}} onClick={()=>setHomeFilter('all')}><HeaderNavLabel section="home">{t("Home")}</HeaderNavLabel></Link>
          <button className="home-header-category" aria-pressed={isHome&&homeFilter==='movie'} onClick={()=>selectHomeCategory('movie')}><HeaderNavLabel section="movies">{t("Movies")}</HeaderNavLabel></button>
          <button className="home-header-category" aria-pressed={isHome&&homeFilter==='series'} onClick={()=>selectHomeCategory('series')}><HeaderNavLabel section="series">{t("Series")}</HeaderNavLabel></button>
          <Link to="/library" activeProps={{className:'active'}}><HeaderNavLabel section="library">{t("Library")}</HeaderNavLabel></Link>
          <Link to="/shorts" search={{}} activeProps={{className:'active'}}><HeaderNavLabel section="shorts">{t("Shorts")}</HeaderNavLabel></Link>
          <Link to="/favorites" activeProps={{className:'active'}}><HeaderNavLabel section="favorites">{t("Favorites")}</HeaderNavLabel></Link>
          <Link to="/playlists" activeProps={{className:'active'}}><HeaderNavLabel section="playlists">{t("Playlists")}</HeaderNavLabel></Link>
        </nav>
        <div className="topbar-actions">
          <NotificationBell/>
          <div className={`header-search-shell ${searchOpen ? 'open' : ''}`} data-animate={animateSearch}
            onKeyDownCapture={event=>{
              if(event.key==='Escape'&&searchOpen){
                event.preventDefault();event.stopPropagation();setAnimateSearch(false);setMobileSearchOpen(false);setSearch('');
                searchToggleRef.current?.focus({preventScroll:true});
              }
            }}>
            <div className="header-search-motion">
              <MagnifyingGlass className="header-search-icon" aria-hidden="true"/>
              <Button
                ref={searchToggleRef}
                className="header-search-toggle"
                isIconOnly
                variant="ghost"
                aria-label={searchOpen ? t("Close search") : t("Search")}
                aria-expanded={searchOpen}
                onPressStart={event=>setAnimateSearch(event.pointerType==='mouse'||event.pointerType==='touch'||event.pointerType==='pen')}
                onPress={toggleSearch}
              >
                {searchOpen?<X size={20}/>:<MagnifyingGlass size={20}/>}
              </Button>
              <Input
                className="header-search-input"
                aria-label={isFavorites ? t("Search favorites") : t("Search library")}
                placeholder={t("Search")}
                value={search}
                ref={searchInputRef}
                tabIndex={searchOpen ? 0 : -1}
                inert={!searchOpen}
                aria-hidden={!searchOpen}
                onChange={(e)=>setSearch(e.target.value)}
                onKeyDown={(e)=>{
                  if (e.key === 'Enter') void navigate({to:searchDestination});
                }}
              />
            </div>
          </div>
          <Button className="desktop-only icon-button settings-button" isIconOnly variant="ghost" aria-label={t("Settings")} onPress={()=>void navigate({to:'/settings'})}>
            <Gear size={28}/>
          </Button>
        </div>
      </div>
    </header>
  );
}
