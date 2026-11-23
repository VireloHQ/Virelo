import { useState } from 'react';
import { Button } from '@heroui/react';
import { WarningCircle, X } from '@phosphor-icons/react';
import { t, useLocale } from '../i18n';
import type { ScanStatus } from '../types';

export function BrowserScanWarning({ status }: { status?: ScanStatus }) {
  useLocale();
  const [dismissed, setDismissed] = useState<number | null>(null);
  const count = status?.playbackWarnings ?? 0;
  if (!count || status?.startedAt === dismissed) return null;
  return <aside className="browser-scan-warning" role="status" aria-live="polite">
    <WarningCircle aria-hidden="true"/>
    <div><strong>{t("Playback may be slower")}</strong>
      <p>{t("{count} videos need browser conversion.", { count })}</p>
      <p>{t("Conversion happens on this device during playback and may slow startup or seeking. Scanning will continue. Original files are unchanged.")}</p>
      <p>{t("For files 2 GB or larger, use the local Virelo server.")}</p>
    </div>
    <Button variant="ghost" isIconOnly aria-label={t("Dismiss message")} onPress={() => setDismissed(status?.startedAt ?? null)}><X/></Button>
  </aside>;
}
