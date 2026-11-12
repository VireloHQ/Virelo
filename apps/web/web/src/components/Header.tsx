import { t, useLocale } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Button, Input } from '@heroui/react';
import { MagnifyingGlass, Gear, X } from '@phosphor-icons/react';
import { useUIStore } from '@virelo/web-ui/store.ts';

export function Header() {
  useLocale();
  const navigate = useNavigate();
  const pathname = useLocation({select:location=>location.pathname});
  const isHome = pathname === '/app' || pathname === '/app/';
  const isFavorites = pathname === '/app/favorites';
  const searchDestination = isFavorites ? '/app/favorites' : '/app/library';
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
    if (!isHome) void navigate({to:'/app'});
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
        <Link to="/app" className="brand" aria-label={t("Virelo app home")} onClick={()=>setHomeFilter('all')}>
          <span className="brand-mark"><img src="/virelo-icon-180.png?v=ribbon-1" alt="" width="42" height="42" decoding="async" /></span>
          <span className="brand-name">{t("Virelo")}</span>
        </Link>
        <nav className="desktop-nav" aria-label={t("Main navigation")}>
          <Link to="/app" activeOptions={{exact:true}} activeProps={homeFilter==='all'?{className:'active'}:{}} onClick={()=>setHomeFilter('all')}>{t("Home")}</Link>
          <button className="home-header-category" aria-pressed={isHome&&homeFilter==='movie'} onClick={()=>selectHomeCategory('movie')}>{t("Movies")}</button>
          <button className="home-header-category" aria-pressed={isHome&&homeFilter==='series'} onClick={()=>selectHomeCategory('series')}>{t("Series")}</button>
          <Link to="/app/library" activeProps={{className:'active'}}>{t("Library")}</Link>
          <Link to="/app/shorts" search={{}} activeProps={{className:'active'}}>{t("Shorts")}</Link>
          <Link to="/app/favorites" activeProps={{className:'active'}}>{t("Favorites")}</Link>
          <Link to="/app/playlists" activeProps={{className:'active'}}>{t("Playlists")}</Link>
        </nav>
        <div className="topbar-actions">
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
          <Button className="desktop-only icon-button settings-button" isIconOnly variant="ghost" aria-label={t("Settings")} onPress={()=>void navigate({to:'/app/settings'})}>
            <Gear size={28}/>
          </Button>
        </div>
      </div>
    </header>
  );
}
