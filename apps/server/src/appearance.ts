export const CONTROLLER_STYLES = ['classic', 'streamline', 'theater', 'centerstage'] as const;
export type ControllerStyle = typeof CONTROLLER_STYLES[number];
export interface Appearance { controllerStyle: ControllerStyle; accentColor: string }
export const DEFAULT_APPEARANCE: Readonly<Appearance> = Object.freeze({ controllerStyle: 'classic', accentColor: '#c3a6ff' });
const hexColor = /^#[0-9a-f]{6}$/i;
export function isAppearance(value: unknown): value is Appearance {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every(key => key === 'controllerStyle' || key === 'accentColor')
    && CONTROLLER_STYLES.includes(record.controllerStyle as ControllerStyle)
    && typeof record.accentColor === 'string' && hexColor.test(record.accentColor);
}
export function normalizeAppearance(value: unknown): Appearance {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    controllerStyle: CONTROLLER_STYLES.includes(record.controllerStyle as ControllerStyle) ? record.controllerStyle as ControllerStyle : 'classic',
    accentColor: typeof record.accentColor === 'string' && hexColor.test(record.accentColor) ? record.accentColor.toLowerCase() : DEFAULT_APPEARANCE.accentColor
  };
}
export function appearanceVariables(color: string): Record<string, string> {
  if (!hexColor.test(color)) return {};
  if (color.toLowerCase() === DEFAULT_APPEARANCE.accentColor) return { '--color-brand': '#c3a6ff', '--color-brand-strong': '#a980f5', '--color-brand-soft': '#24202d', '--color-focus': '#d8c7ff' };
  const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
  const luminance = (channels: number[]) => channels.reduce((sum, channel, index) => {
    const value = channel / 255;
    return sum + (value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
  }, 0);
  const mix = (amount: number, target = 255) => rgb.map(channel => Math.round(channel * (1 - amount) + target * amount));
  const hex = (channels: number[]) => '#' + channels.map(channel => channel.toString(16).padStart(2, '0')).join('');
  let readable = rgb;
  for (let step = 1; (luminance(readable) + .05) / (luminance([48, 48, 52]) + .05) < 4.5 && step <= 100; step++) readable = mix(step / 100);
  return { '--color-brand': hex(readable), '--color-brand-strong': hex(readable), '--color-brand-soft': hex(mix(.86, 16)), '--color-focus': hex(readable.map(channel => Math.round(channel * .8 + 51))) };
}
