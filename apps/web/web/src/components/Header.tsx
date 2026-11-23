import { AppNavigation } from '@virelo/web-ui/components/AppNavigation.tsx';
import { HeaderNavLabel } from '@virelo/web-ui/components/HeaderNavLabel.tsx';
import { t,useLocale } from '../i18n';

export function Header() {
  useLocale();
  return <AppNavigation base="/app" liveTv={<a href="/media/iptv/"><HeaderNavLabel section="live-tv">{t("Live TV")}</HeaderNavLabel></a>}/>;
}
