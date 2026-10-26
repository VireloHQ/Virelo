import { t, useLocale } from '../i18n';
import { LoadingSpinner } from './LoadingSpinner';
import type { ScanStatus } from '../types';

export function ScanProgress({ status, compact = false }: { status?: ScanStatus; compact?: boolean }) {
  useLocale();
  if (!status?.running) return null;
  const hasTotal = status.total > 0;
  const progress = hasTotal ? Math.min(100, Math.round((status.scanned / status.total) * 100)) : 0;

  return <div className={`scan-progress${compact ? ' compact' : ''}`} role="status" aria-live="polite">
    <div className="scan-progress-head">
      <span><LoadingSpinner/><strong>{t("Scanning")}</strong></span>
      <span>{hasTotal ? `${status.scanned} / ${status.total}` : t("Discovering files…")}</span>
    </div>
    <div
      className={`scan-progress-track${hasTotal ? '' : ' indeterminate'}`}
      role="progressbar"
      aria-label={t("Scan progress")}
      aria-valuemin={0}
      aria-valuemax={hasTotal ? status.total : undefined}
      aria-valuenow={hasTotal ? status.scanned : undefined}
    >
      <span style={hasTotal ? { width: '100%', transform: `scaleX(${progress / 100})` } : undefined}/>
    </div>
    <p>{t(status.message)}</p>
  </div>;
}
