import { Link } from '@tanstack/react-router';
import { UserCircle } from '@phosphor-icons/react';
import { AppNavigation } from '@virelo/web-ui/components/AppNavigation.tsx';
import { useAccount } from './AccountSession';
import { NotificationBell } from './Notifications';
import { t, useLocale } from '../i18n';

export function Header() {
  useLocale();
  const session=useAccount();
  return <AppNavigation base="" notifications={<NotificationBell/>} account={session&&
    <Link to="/settings" hash="account" aria-label={t("Account")}><UserCircle aria-hidden="true"/><span>{session.user.displayName||session.user.username}</span></Link>}/>;
}
