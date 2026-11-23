import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { isAviFile } from './utils/avi';

export const DIRECT_AUDIO_CODECS = new Set(['aac', 'flac', 'mp3', 'opus', 'vorbis']);

export interface PlaybackCompatibility {
  requiresConversion: boolean;
  videoCodec: string | null;
  audioCodec: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
}

export function needsSoftwarePlayback(videoCodec: string | null, audioSupported = true) {
  return videoCodec === null || !audioSupported;
}

// Header inspection only: no frames, thumbnails, audio decoding or FFmpeg worker.
export async function inspectPlaybackCompatibility(file: File): Promise<PlaybackCompatibility | null> {
  if (await isAviFile(file)) return { requiresConversion: true, videoCodec: null, audioCodec: null, duration: null, width: null, height: null };
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const [video, audio] = await Promise.all([input.getPrimaryVideoTrack(), input.getPrimaryAudioTrack()]);
        if (!video) return null;
        const [videoCodec, audioCodec, width, height, duration] = await Promise.all([
          video.getCodec(), audio?.getCodec(), video.getDisplayWidth(), video.getDisplayHeight(), input.getDurationFromMetadata([video])
        ]);
        const audioSupported = !audio || DIRECT_AUDIO_CODECS.has(audioCodec ?? '') || audioCodec === 'ac3' || audioCodec === 'eac3' || await audio.canDecode();
        return { requiresConversion: needsSoftwarePlayback(videoCodec, audioSupported),
          videoCodec: videoCodec ?? String(await video.getInternalCodecId() ?? 'unknown'),
          audioCodec: audio ? audioCodec ?? String(await audio.getInternalCodecId() ?? 'unknown') : null,
          width, height, duration: duration !== null && Number.isFinite(duration) ? duration : null };
      })(),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); })
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); input.dispose(); }
}
