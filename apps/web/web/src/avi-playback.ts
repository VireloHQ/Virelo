import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { AVI_CORE_PATH, AVI_MAX_FILE_BYTES, aviPlaybackInfo } from './utils/avi';
import type { PlaybackInfo } from './types';
import { thumbnailTimes, validThumbnail, type VideoProbe } from './utils/video-thumbnail';
import type { BrowserStreamOptions } from './browser-stream';

const SEGMENT_SECONDS = 4;
let engine: Promise<FFmpeg> | undefined;
let tail: Promise<unknown> = Promise.resolve();
let idleTimer: ReturnType<typeof setTimeout> | undefined;
const probes = new WeakMap<File, Promise<PlaybackInfo>>();
const aborted = () => new DOMException('AVI playback preparation cancelled.', 'AbortError');

async function loadEngine() {
  if (!engine) {
    const pending = (async () => {
      const response = await fetch(AVI_CORE_PATH + '/ffmpeg-core.wasm.gz', { signal: AbortSignal.timeout(60_000) });
      if (!response.ok || !response.body) throw new Error('AVI playback support could not be loaded. Check the connection and try again.');
      const downloaded = new Uint8Array(await response.arrayBuffer());
      // Some static hosts transparently decompress .gz assets before fetch exposes the body.
      const decoded = downloaded[0] === 0 && downloaded[1] === 97 && downloaded[2] === 115 && downloaded[3] === 109;
      if (!decoded && !(downloaded[0] === 31 && downloaded[1] === 139)) throw new Error('The AVI decoder download is invalid. Reload the app and try again.');
      const bytes = decoded ? downloaded : await new Response(new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      const wasmURL = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
      const ffmpeg = new FFmpeg();
      try {
        await ffmpeg.load({ coreURL: new URL(AVI_CORE_PATH + '/ffmpeg-core.js', location.origin).href, wasmURL }, { signal: AbortSignal.timeout(30_000) });
        await ffmpeg.createDir('/input');
        return ffmpeg;
      } catch (error) { ffmpeg.terminate(); throw error; }
      finally { URL.revokeObjectURL(wasmURL); }
    })();
    engine = pending;
    void pending.catch(() => { if (engine === pending) engine = undefined; });
  }
  return engine;
}

function withAvi<T>(file: File, signal: AbortSignal | undefined, action: (ffmpeg: FFmpeg) => Promise<T>): Promise<T> {
  const job = tail.then(async () => {
    if (signal?.aborted) throw aborted();
    if (file.size >= AVI_MAX_FILE_BYTES) throw new Error('Browser AVI playback supports files smaller than 2 GB. Use the local Virelo server for larger AVI files.');
    clearTimeout(idleTimer);
    const pending = loadEngine(), ffmpeg = await pending;
    const cancel = () => { ffmpeg.terminate(); engine = undefined; };
    if (signal?.aborted) { cancel(); throw aborted(); }
    signal?.addEventListener('abort', cancel, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { reject(new Error('AVI decoding timed out. Try a lower quality, or use the local Virelo server.')); cancel(); }, 60_000);
    });
    try {
      return await Promise.race([(async () => {
        // WORKERFS reads slices from the immutable Blob instead of copying the full video into WASM memory.
        if (!await ffmpeg.mount(FFFSType.WORKERFS, { blobs: [{ name: 'source.avi', data: file }] }, '/input')) throw new Error('This browser cannot read AVI files safely.');
        return action(ffmpeg);
      })(), deadline]);
    } catch (error) {
      ffmpeg.terminate(); engine = undefined;
      if (signal?.aborted) throw aborted();
      throw error instanceof Error ? error : new Error('The AVI could not be decoded.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      if (ffmpeg.loaded) {
        for (const path of ['probe.json', 'segment.mp4', 'frame.jpg']) await ffmpeg.deleteFile(path).catch(() => {});
        await ffmpeg.unmount('/input').catch(() => {});
        idleTimer = setTimeout(() => { ffmpeg.terminate(); engine = undefined; }, 30_000);
      }
    }
  });
  tail = job.catch(() => {});
  return job;
}

export function probeAvi(file: File) {
  let result = probes.get(file);
  if (!result) {
    result = withAvi(file, undefined, async ffmpeg => {
      // Core 0.12.10 may return -1 after writing valid ffprobe output; validate the complete JSON instead.
      await ffmpeg.ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', '-o', 'probe.json', '/input/source.avi'], 30_000);
      return aviPlaybackInfo(JSON.parse(await ffmpeg.readFile('probe.json', 'utf8') as string));
    });
    probes.set(file, result);
    void result.catch(() => { if (probes.get(file) === result) probes.delete(file); });
  }
  return result;
}

export async function probeAviThumbnail(file: File): Promise<VideoProbe> {
  const info = await probeAvi(file);
  const thumbnail = await withAvi(file, undefined, async ffmpeg => {
    for (const position of thumbnailTimes(info.duration!)) {
      const code = await ffmpeg.exec(['-hide_banner', '-loglevel', 'error', '-ss', String(position), '-i', '/input/source.avi',
        '-frames:v', '1', '-vf', 'scale=min(480\\,iw):-2', '-q:v', '4', 'frame.jpg'], 30_000);
      if (code !== 0) continue;
      const bytes = await ffmpeg.readFile('frame.jpg');
      if (typeof bytes === 'string') continue;
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' });
      if (await validThumbnail(blob)) return blob;
    }
    return null;
  });
  return { duration: info.duration!, width: info.width, height: info.height, thumbnail };
}

async function encodeSegment(file: File, height: number, audio: number | null, start: number, length: number, signal: AbortSignal) {
  return withAvi(file, signal, async ffmpeg => {
    const args = ['-hide_banner', '-loglevel', 'error', '-ss', String(start), '-i', '/input/source.avi', '-t', String(length),
      '-map', '0:v:0', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22', '-pix_fmt', 'yuv420p', '-bf', '0',
      '-vf', `scale=-2:${Math.max(2, Math.round(height / 2) * 2)}`, '-g', '30'];
    if (audio === null) args.push('-an');
    else args.push('-map', `0:${audio}`, '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-af', 'aresample=async=1:first_pts=0');
    args.push('-movflags', 'frag_keyframe+empty_moov+default_base_moof', '-f', 'mp4', '-fs', String(32 * 1024 * 1024), 'segment.mp4');
    if (await ffmpeg.exec(args, 45_000) !== 0) throw new Error('AVI conversion failed or timed out. Try a lower quality, or use the local Virelo server.');
    const bytes = await ffmpeg.readFile('segment.mp4');
    if (typeof bytes === 'string' || !bytes.length || bytes.length >= 32 * 1024 * 1024) throw new Error('The converted AVI segment exceeds browser playback limits. Choose a lower quality.');
    return new Uint8Array(bytes);
  });
}

export async function streamAvi(file: File, height: number, audio: number | null, options: BrowserStreamOptions): Promise<string> {
  if (options.signal.aborted) throw aborted();
  if (typeof MediaSource === 'undefined') throw new Error('AVI playback requires a browser with MediaSource support.');
  const info = await probeAvi(file), duration = info.duration!;
  if (!info.qualityOptions.some(quality => quality.height === height) || (audio !== null && !info.audioTracks.some(track => track.index === audio))) throw new Error('The selected AVI quality or audio track is unavailable.');
  const start = Math.max(0, Math.min(Math.floor(options.position), Math.max(0, duration - 1)));
  const source = new MediaSource(), url = URL.createObjectURL(source);
  let buffer: SourceBuffer | null = null, element: HTMLMediaElement | null = null, disposed = false, redirected = false;
  const controller = new AbortController();
  const cancel = () => {
    if (disposed) return;
    disposed = true; controller.abort();
    source.removeEventListener('sourceopen', opened); source.removeEventListener('sourceclose', cancel);
    element?.removeEventListener('seeking', seek); options.signal.removeEventListener('abort', cancel);
    URL.revokeObjectURL(url);
  };
  const update = (operation: () => void) => new Promise<void>((resolve, reject) => {
    if (!buffer || disposed) { reject(aborted()); return; }
    const cleanup = () => { buffer?.removeEventListener('updateend', done); buffer?.removeEventListener('error', failed); controller.signal.removeEventListener('abort', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(disposed ? aborted() : new Error('The converted AVI could not be buffered.')); };
    buffer.addEventListener('updateend', done, { once: true }); buffer.addEventListener('error', failed, { once: true }); controller.signal.addEventListener('abort', failed, { once: true });
    try { operation(); } catch (error) { cleanup(); reject(error); }
  });
  const seek = () => {
    if (disposed || redirected || !element || element.currentSrc !== url || !buffer?.buffered.length) return;
    for (let i = 0; i < buffer.buffered.length; i++) if (element.currentTime >= buffer.buffered.start(i) - .3 && element.currentTime <= buffer.buffered.end(i) + .3) return;
    if (Math.abs(element.currentTime - options.position) < .3) return;
    redirected = true; options.onSeek(element.currentTime);
  };
  const wait = () => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 150); controller.signal.addEventListener('abort', done, { once: true });
  });
  const run = async () => {
    source.duration = duration; element = options.getElement(); element?.addEventListener('seeking', seek);
    for (let position = start; position < duration && !disposed; position += SEGMENT_SECONDS) {
      const bytes = await encodeSegment(file, height, audio, position, Math.min(SEGMENT_SECONDS, duration - position), controller.signal);
      if (disposed) return;
      if (!buffer) {
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([bytes], { type: 'video/mp4' })) });
        try {
          const mime = await input.getMimeType();
          if (!MediaSource.isTypeSupported(mime)) throw new Error('This browser cannot play the converted AVI format.');
          buffer = source.addSourceBuffer(mime);
        } finally { input.dispose(); }
      }
      buffer.timestampOffset = position;
      await update(() => buffer!.appendBuffer(bytes));
      const current = element?.currentTime ?? start;
      if (current > 16 && buffer.buffered.length && buffer.buffered.start(0) < current - 14) await update(() => buffer!.remove(0, current - 12));
      if (position + SEGMENT_SECONDS >= duration) { source.duration = duration; source.endOfStream(); return; }
      while (!disposed && position + SEGMENT_SECONDS - (element?.currentTime ?? start) > 12) await wait();
    }
  };
  const opened = () => { void run().catch(reason => {
    if (!disposed && !options.signal.aborted) options.onError(reason instanceof Error ? reason : new Error('AVI playback failed.'));
    cancel();
  }); };
  options.signal.addEventListener('abort', cancel, { once: true });
  source.addEventListener('sourceopen', opened, { once: true }); source.addEventListener('sourceclose', cancel, { once: true });
  if (options.signal.aborted) { cancel(); throw aborted(); }
  return url;
}
