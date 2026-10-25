import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Button, Input } from '@heroui/react';
import { MagnifyingGlass, Gear, X } from '@phosphor-icons/react';
import { useUIStore } from '../store';

export function Header() {
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
  const toggleSearch = () => {
    const nextOpen = !searchOpen;
    setMobileSearchOpen(nextOpen);
    if (nextOpen) void navigate({to:searchDestination});
  };
  return (
    <header className={'topbar'+(isHome?' home-header':'')}>
      <div className="topbar-inner">
        <Link to="/" className="brand" aria-label="Virelo home" onClick={()=>setHomeFilter('all')}>
          <span className="brand-mark"><img src="/virelo-icon.png?v=transparent-1" alt="" /></span>
          <span className="brand-name">Virelo</span>
        </Link>
        <nav className="desktop-nav" aria-label="Main navigation">
          <Link to="/" activeOptions={{exact:true}} activeProps={homeFilter==='all'?{className:'active'}:{}} onClick={()=>setHomeFilter('all')}>Home</Link>
          {isHome&&<><button className="home-header-category" aria-pressed={homeFilter==='movie'} onClick={()=>setHomeFilter('movie')}>Movies</button>
            <button className="home-header-category" aria-pressed={homeFilter==='series'} onClick={()=>setHomeFilter('series')}>Series</button></>}
          <Link to="/library" activeProps={{className:'active'}}>Library</Link>
          <Link to="/shorts" search={{}} activeProps={{className:'active'}}>Shorts</Link>
          <Link to="/favorites" activeProps={{className:'active'}}>Favorites</Link>
          <Link to="/playlists" activeProps={{className:'active'}}>Playlists</Link>
        </nav>
        <div className="topbar-actions">
          <div className={`header-search-shell ${searchOpen ? 'open' : ''}`} data-animate={animateSearch}
            onKeyDownCapture={event=>{
              if(event.key==='Escape'&&searchOpen){
                event.preventDefault();event.stopPropagation();setAnimateSearch(false);setMobileSearchOpen(false);
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
                aria-label={searchOpen ? 'Close search' : 'Search'}
                aria-expanded={searchOpen}
                onPressStart={event=>setAnimateSearch(event.pointerType==='mouse'||event.pointerType==='touch'||event.pointerType==='pen')}
                onPress={toggleSearch}
              >
                {searchOpen?<X size={20}/>:<MagnifyingGlass size={20}/>}
              </Button>
              <Input
                className="header-search-input"
                aria-label={isFavorites ? 'Search favorites' : 'Search library'}
                placeholder="Search"
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
          <Button className="desktop-only icon-button settings-button" isIconOnly variant="ghost" aria-label="Settings" onPress={()=>void navigate({to:'/settings'})}>
            <Gear size={28}/>
          </Button>
        </div>
      </div>
    </header>
  );
}
