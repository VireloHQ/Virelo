import { t, useLocale } from '@edition/i18n';
import { useNavigationLayout } from '../hooks/useNavigationLayout';
import { Select } from './Select';

export function NavigationLayoutSetting() {
  useLocale();
  const layout=useNavigationLayout(s=>s.layout),setLayout=useNavigationLayout(s=>s.setLayout);
  return <div className="setting-row desktop-only"><div className="setting-copy"><div>
    <strong>{t("Navigation layout")}</strong><p>{t("Choose a header or sidebar on desktop.")}</p>
  </div></div>
    <Select className="settings-picker" label={t("Navigation layout")} value={layout} align="end"
      options={[{value:'header',label:t("Header")},{value:'sidebar',label:t("Sidebar")}]}
      onChange={value=>setLayout(value==='sidebar'?'sidebar':'header')}/>
  </div>;
}
