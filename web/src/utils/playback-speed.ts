export const PLAYBACK_SPEEDS = [.25, .5, .75, 1, 1.25, 1.5, 1.75, 2] as const;
export const PLAYBACK_SPEED_KEY = 'virelo.playback-speed:v1';
export function playbackSpeed(value: unknown): number {
  const speed = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return PLAYBACK_SPEEDS.some(option => option === speed) ? speed : 1;
}
export function speedLabel(speed: number) { return speed === 1 ? 'Normal (1×)' : speed + '×'; }
