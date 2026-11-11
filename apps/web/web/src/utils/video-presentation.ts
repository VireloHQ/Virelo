import type { CSSProperties } from 'react';

export interface VideoPresentation {
  fit: 'contain' | 'cover';
  rotation: number;
  brightness: number;
  contrast: number;
  saturation: number;
}

export const DEFAULT_VIDEO_PRESENTATION: Readonly<VideoPresentation> = Object.freeze({
  fit: 'contain', rotation: 0, brightness: 100, contrast: 100, saturation: 100
});

export function normalizeVideoPresentation(value: VideoPresentation): VideoPresentation {
  const percent = (number: number) => Number.isFinite(number) ? Math.max(0, Math.min(200, number)) : 100;
  const rotation = Number.isFinite(value.rotation) ? Math.round(value.rotation / 90) * 90 : 0;
  return {
    fit: value.fit === 'cover' ? 'cover' : 'contain',
    rotation: ((rotation % 360) + 360) % 360,
    brightness: percent(value.brightness), contrast: percent(value.contrast), saturation: percent(value.saturation)
  };
}

// Swap the video's layout box before a quarter turn; object-fit then preserves its aspect ratio.
export function videoPresentationStyle(value: VideoPresentation, size: { width: number; height: number }): CSSProperties {
  const settings = normalizeVideoPresentation(value);
  const quarterTurn = settings.rotation === 90 || settings.rotation === 270;
  return {
    width: quarterTurn ? size.height : '100%',
    height: quarterTurn ? size.width : '100%',
    objectFit: settings.fit,
    transform: `translate(-50%, -50%) rotate(${settings.rotation}deg)`,
    filter: settings.brightness === 100 && settings.contrast === 100 && settings.saturation === 100 ? 'none'
      : `brightness(${settings.brightness}%) contrast(${settings.contrast}%) saturate(${settings.saturation}%)`
  };
}
