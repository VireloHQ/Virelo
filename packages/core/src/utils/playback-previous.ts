// A previous-track press first restarts a video if playback is underway.
// At the beginning, it selects the preceding item when one is available.
export const PREVIOUS_RESTART_THRESHOLD_SECONDS = 3;
export type PreviousVideoAction = 'restart' | 'previous' | 'none';

export function previousVideoAction(currentSeconds: number, hasPreviousVideo: boolean): PreviousVideoAction {
  if (Number.isFinite(currentSeconds) && currentSeconds >= PREVIOUS_RESTART_THRESHOLD_SECONDS) return 'restart';
  return hasPreviousVideo ? 'previous' : 'none';
}
