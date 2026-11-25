import { Link } from '@tanstack/react-router';
import { CaretRight, UserCircle } from '@phosphor-icons/react';
import { AppNavigation } from '@virelo/web-ui/components/AppNavigation.tsx';
import { HeaderNavLabel } from '@virelo/web-ui/components/HeaderNavLabel.tsx';
import { useAccount } from './AccountSession';
import { NotificationBell } from './Notifications';
import { t, useLocale } from '../i18n';

export function Header() {
  useLocale();
  const session=useAccount();
  return <AppNavigation base="" notifications={<NotificationBell/>}
    liveTv={<Link to="/live-tv" activeProps={{className:'active'}}><HeaderNavLabel section="live-tv">{t("Live TV")}</HeaderNavLabel></Link>} account={session&&
    <Link to="/settings" hash="account" aria-label={t("Account")}>
      <span className="navigation-account-avatar"><UserCircle weight="duotone" aria-hidden="true"/></span>
      <span className="navigation-account-copy"><strong>{session.user.displayName||session.user.username}</strong>
        {session.user.isAdmin&&<small>{t("Administrator")}</small>}
      </span>
      <CaretRight className="navigation-account-arrow" aria-hidden="true"/>
    </Link>}/>;
}
