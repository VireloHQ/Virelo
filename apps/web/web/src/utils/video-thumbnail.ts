import { isAviFile } from './avi.ts';

export const THUMBNAIL_VERSION = 3;

export interface VideoProbe {
  duration: number | null;
  width: number | null;
  height: number | null;
  thumbnail: Blob | null;
}

export function thumbnailTimes(duration: number) {
  if (!Number.isFinite(duration) || duration <= 0) return [0];
  const last = Math.max(0, duration - Math.min(0.05, duration / 4));
  return [...new Set([Math.min(5, duration * 0.1), Math.min(30, duration * 0.25), duration * 0.5, duration * 0.8]
    .map(time => Math.min(last, time)))];
}

function frameCanvas(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  const scale = Math.min(480 / width, 720 / height, 1);
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function hasVisibleFrame(canvas: HTMLCanvasElement) {
  const sample = document.createElement('canvas');
  sample.width = 32;
  sample.height = 18;
  const context = sample.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  context.drawImage(canvas, 0, 0, 32, 18);
  const pixels = context.getImageData(0, 0, 32, 18).data;
  let visible = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] > 0 && Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 18) visible++;
  }
  return visible > 32 * 18 * 0.02;
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Thumbnail creation failed.')), 'image/jpeg', 0.78));
}

export async function validThumbnail(blob: Blob) {
  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(blob);
    return bitmap.width > 1 && bitmap.height > 1 && hasVisibleFrame(frameCanvas(bitmap, bitmap.width, bitmap.height));
  } catch { return false; }
  finally { bitmap?.close(); }
}

async function probeDecoded(file: File): Promise<VideoProbe> {
  // Video-only demuxing also works when the audio/container cannot be opened by <video>.
  const { Input, BlobSource, ALL_FORMATS, CanvasSink } = await import('mediabunny');
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        const track = await input.getPrimaryVideoTrack();
        if (!track) throw new Error('No video track.');
        const [width, height, metadataDuration, first] = await Promise.all([
          track.getDisplayWidth(), track.getDisplayHeight(), input.getDurationFromMetadata([track]), track.getFirstTimestamp()
        ]);
        const duration = metadataDuration ?? await input.computeDuration([track]);
        const result: VideoProbe = { duration: Number.isFinite(duration) ? duration : null, width, height, thumbnail: null };
        if (!width || !height || !await track.canDecode()) return result;
        const scale = Math.min(480 / width, 720 / height, 1);
        const sink = new CanvasSink(track, { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), fit: 'contain', poolSize: 1 });
        for (const time of thumbnailTimes(Math.max(0, duration - first))) {
          const frame = await sink.getCanvas(first + time);
          if (!frame) continue;
          const canvas = frameCanvas(frame.canvas, frame.canvas.width, frame.canvas.height);
          if (hasVisibleFrame(canvas)) { result.thumbnail = await canvasBlob(canvas); break; }
        }
        return result;
      })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Thumbnail decode timed out.')), 12_000); })
    ]);
  } finally { clearTimeout(timer); input.dispose(); }
}

function waitForVideo(video: HTMLVideoElement, event: 'loadedmetadata' | 'seeked' | 'loadeddata', action?: () => void) {
  return new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener('error', failed);
      error ? reject(error) : resolve();
    };
    const ready = () => finish();
    const failed = () => finish(new Error('Video cannot be decoded.'));
    const timer = setTimeout(() => finish(new Error('Video frame timed out.')), 5_000);
    // Install listeners before assigning src/currentTime; never draw after a timed-out seek.
    video.addEventListener(event, ready, { once: true });
    video.addEventListener('error', failed, { once: true });
    try { action?.(); } catch (error) { finish(error instanceof Error ? error : new Error('Video read failed.')); }
  });
}

async function probeNative(file: File): Promise<VideoProbe> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto'; video.muted = true; video.playsInline = true;
  try {
    await waitForVideo(video, 'loadedmetadata', () => { video.src = url; });
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const width = video.videoWidth || null, height = video.videoHeight || null;
    const result: VideoProbe = { duration, width, height, thumbnail: null };
    if (!width || !height) return result;
    for (const time of thumbnailTimes(duration ?? 0)) {
      try {
        if (Math.abs(video.currentTime - time) > 0.001) await waitForVideo(video, 'seeked', () => { video.currentTime = time; });
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitForVideo(video, 'loadeddata');
        const canvas = frameCanvas(video, width, height);
        if (hasVisibleFrame(canvas)) { result.thumbnail = await canvasBlob(canvas); break; }
      } catch { /* Try another position, but do not save an undecoded black canvas. */ }
    }
    return result;
  } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url); }
}

export async function probeVideo(file: File): Promise<VideoProbe> {
  if (await isAviFile(file)) {
    try { return await (await import('../avi-playback')).probeAviThumbnail(file); }
    catch { return { duration: null, width: null, height: null, thumbnail: null }; }
  }
  let decoded: VideoProbe | undefined;
  try { decoded = await probeDecoded(file); if (decoded.thumbnail) return decoded; } catch { /* Native decoding is the fallback. */ }
  try { const native = await probeNative(file); return native.thumbnail ? native : decoded ?? native; }
  catch { return decoded ?? { duration: null, width: null, height: null, thumbnail: null }; }
}
