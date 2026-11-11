import { playbackQualities } from './playback-quality.ts';
import type { PlaybackInfo } from '../types.ts';

export const AVI_CORE_PATH = '/assets/ffmpeg-0.12.10';
export const AVI_MAX_FILE_BYTES = 2_000_000_000;

export async function isAviFile(file: File) {
  if (!/\.avi$/i.test(file.name) || file.size < 12) return false;
  const bytes = new DataView(await file.slice(0, 12).arrayBuffer());
  return bytes.getUint32(0) === 0x52494646 && bytes.getUint32(8) === 0x41564920;
}

export function aviPlaybackInfo(value: unknown): PlaybackInfo {
  const data = value as { streams?: Array<Record<string, any>>; format?: Record<string, any> };
  if (!data || !Array.isArray(data.streams) || data.format?.format_name !== 'avi') throw new Error('This file could not be read as an AVI video.');
  const video = data.streams.find(track => track?.codec_type === 'video');
  const width = Number(video?.width), height = Number(video?.height), videoDuration = Number(video?.duration);
  const duration = Number.isFinite(videoDuration) && videoDuration > 0 ? videoDuration : Number(data.format.duration);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 16384 || height > 16384 || width * height > 33_177_600
    || !Number.isFinite(duration) || duration <= 0 || duration > 7 * 86400) throw new Error('The AVI resolution or duration is not supported by browser playback.');
  const audioTracks = data.streams.filter(track => track?.codec_type === 'audio').map((track, typeIndex) => ({
    index: Number(track.index), typeIndex, codec: String(track.codec_name || 'unknown'),
    language: typeof track.tags?.language === 'string' ? track.tags.language : null,
    title: typeof track.tags?.title === 'string' ? track.tags.title : null,
    channels: Number.isInteger(track.channels) ? track.channels : null,
    channelLayout: typeof track.channel_layout === 'string' ? track.channel_layout : null,
    default: Boolean(track.disposition?.default), forced: Boolean(track.disposition?.forced), supported: true
  }));
  if (audioTracks.some(track => !Number.isSafeInteger(track.index) || track.index < 0)) throw new Error('The AVI audio tracks could not be inspected.');
  return { videoCodec: String(video?.codec_name || 'unknown'), width, height, duration,
    qualityOptions: playbackQualities(height, true), audioTracks, subtitleTracks: [],
    defaultAudioStream: (audioTracks.find(track => track.default) || audioTracks[0])?.index ?? null,
    requiresVideoTranscode: true, requiresAudioTranscode: audioTracks.length > 0, requiresTranscode: true };
}
