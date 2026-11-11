import { t, useLocale } from '../i18n';
import { Link } from '@tanstack/react-router';
import { useUIStore } from '../store';
import { House, SquaresFour, Gear, MonitorPlay, Heart } from '@phosphor-icons/react';

export function MobileNav() {
  useLocale();
  const setHomeFilter = useUIStore(s=>s.setHomeFilter);
  return (
    <nav className="mobile-nav" aria-label={t("Mobile navigation")}>
      <Link to="/app" activeOptions={{exact:true}} activeProps={{className:'active'}} onClick={()=>setHomeFilter('all')}><House weight="fill"/><span>{t("Home")}</span></Link>
      <Link to="/app/shorts" search={{}} activeProps={{className:'active'}}><MonitorPlay weight="fill"/><span>{t("Shorts")}</span></Link>
      <Link to="/app/library" activeProps={{className:'active'}}><SquaresFour weight="fill"/><span>{t("Library")}</span></Link>
      <Link to="/app/favorites" activeProps={{className:'active'}}><Heart weight="fill"/><span>{t("Favorites")}</span></Link>
      <Link to="/app/settings" activeProps={{className:'active'}}><Gear weight="fill"/><span>{t("Settings")}</span></Link>
    </nav>
  );
}
