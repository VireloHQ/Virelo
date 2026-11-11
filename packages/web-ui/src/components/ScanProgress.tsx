import { t, useLocale } from '@edition/i18n';
import { LoadingSpinner } from './LoadingSpinner';
import type { ScanStatus } from '@edition/types';

export function ScanProgress({ status, compact = false }: { status?: ScanStatus; compact?: boolean }) {
  useLocale();
  if (!status?.running) return null;
  const audio = status.audioTotal !== undefined;
  const total = audio ? status.audioTotal! : status.total;
  const scanned = audio ? status.audioAnalyzed ?? 0 : status.scanned;
  const hasTotal = total > 0;
  const progress = hasTotal ? Math.min(100, Math.round((scanned / total) * 100)) : 0;

  return <div className={`scan-progress${compact ? ' compact' : ''}`} role="status" aria-live="polite">
    <div className="scan-progress-head">
      <span><LoadingSpinner/><strong>{t(audio ? "Analyzing audio" : "Scanning")}</strong></span>
      <span>{hasTotal ? `${scanned} / ${total}` : t("Discovering files…")}</span>
    </div>
    <div
      className={`scan-progress-track${hasTotal ? '' : ' indeterminate'}`}
      role="progressbar"
      aria-label={t("Scan progress")}
      aria-valuemin={0}
      aria-valuemax={hasTotal ? total : undefined}
      aria-valuenow={hasTotal ? scanned : undefined}
    >
      <span style={hasTotal ? { width: '100%', transform: `scaleX(${progress / 100})` } : undefined}/>
    </div>
    <p>{t(status.message)}</p>
  </div>;
}
