// Only gate history; live positions from seeking or source switches must bypass this policy.
export function initialPlaybackPosition(position: number | undefined, resumeFromHistory = true): number {
  return resumeFromHistory && typeof position === 'number' && Number.isFinite(position) && position > 0 ? position : 0;
}
