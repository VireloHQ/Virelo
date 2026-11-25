import { Link } from '@tanstack/react-router';
import { AppNavigation } from '@virelo/web-ui/components/AppNavigation.tsx';
import { HeaderNavLabel } from '@virelo/web-ui/components/HeaderNavLabel.tsx';
import { t,useLocale } from '../i18n';

export function Header() {
  useLocale();
  return <AppNavigation base="/app" liveTv={<Link to="/app/live-tv" activeProps={{className:'active'}}><HeaderNavLabel section="live-tv">{t("Live TV")}</HeaderNavLabel></Link>}/>;
}
