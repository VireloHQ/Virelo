import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { ALL_FORMATS, BlobSource, Input } from 'mediabunny';
import { AVI_CORE_PATH, AVI_MAX_FILE_BYTES, isAviFile } from './utils/avi';
import { parseLoudnorm } from './utils/audio-analysis';
import { readAudioAnalysis, type AudioLoudnessAnalysis } from './utils/volume-leveling';

const FILE_TIMEOUT = 30 * 60_000;

// Separate from AVI playback: only the scan queue owns this worker and its lifetime.
export class BrowserAudioAnalyzer {
  private engine: FFmpeg | undefined;

  dispose() { this.engine?.terminate(); this.engine = undefined; }

  private async load(signal: AbortSignal) {
    if (this.engine?.loaded) return this.engine;
    const response = await fetch(AVI_CORE_PATH + '/ffmpeg-core.wasm.gz', { signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]) });
    if (!response.ok) throw new Error('Audio analysis support could not be loaded.');
    const downloaded = new Uint8Array(await response.arrayBuffer());
    const decoded = downloaded[0] === 0 && downloaded[1] === 97 && downloaded[2] === 115 && downloaded[3] === 109;
    if (!decoded && !(downloaded[0] === 31 && downloaded[1] === 139)) throw new Error('Audio analysis support could not be loaded.');
    const bytes = decoded ? downloaded : await new Response(new Blob([downloaded]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
    signal.throwIfAborted();
    const wasmURL = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    const engine = this.engine = new FFmpeg();
    try {
      await engine.load({ coreURL: new URL(AVI_CORE_PATH + '/ffmpeg-core.js', location.origin).href, wasmURL },
        { signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
      await engine.createDir('/input');
      return engine;
    } finally { URL.revokeObjectURL(wasmURL); }
  }

  async analyze(file: File, signal: AbortSignal): Promise<AudioLoudnessAnalysis> {
    signal.throwIfAborted();
    // shortcut: conservative pinned-core support limit; lift after testing large WORKERFS recordings.
    if (file.size >= AVI_MAX_FILE_BYTES) throw new Error('Browser audio analysis supports files smaller than 2 GB.');
    const deadline = new AbortController();
    const timer = setTimeout(() => deadline.abort(new Error('Audio analysis timed out.')), FILE_TIMEOUT);
    const combined = AbortSignal.any([signal, deadline.signal]);
    const cancel = () => this.dispose();
    combined.addEventListener('abort', cancel, { once: true });
    let engine: FFmpeg | undefined;
    try {
      engine = await this.load(combined);
      combined.throwIfAborted();
      // Immutable Blob slices are read inside the worker; never copy the movie into MEMFS.
      if (!await engine.mount(FFFSType.WORKERFS, { blobs: [{ name: 'source', data: file }] }, '/input'))
        throw new Error('Read-only audio analysis is unavailable in this browser.');
      await engine.ffprobe(['-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_entries', 'stream=index,codec_type,channels,sample_rate:stream_disposition=default',
        '-of', 'json', '-o', 'probe.json', '/input/source'], 30_000);
      // This core can return -1 after a successful ffprobe; validate its JSON instead.
      const probe = JSON.parse(await engine.readFile('probe.json', 'utf8') as string);
      if (!Array.isArray(probe.streams)) throw new Error('Audio tracks could not be inspected.');
      const streams = probe.streams.filter((track: { codec_type?: string }) => track.codec_type === 'audio') as
        Array<{ index: number; channels?: number; sample_rate?: string; disposition?: { default?: number } }>;
      if (streams.length > 64 || streams.some(track => !Number.isInteger(track.index) || track.index < 0 || (track.channels ?? 0) > 8 || Number(track.sample_rate) > 192000))
        throw new Error('Audio tracks exceed browser analysis limits (64 tracks, 8 channels, 192 kHz).');
      let indexes: number[], defaultAudioStream: number | null;
      if (await isAviFile(file)) {
        indexes = streams.map(track => track.index);
        defaultAudioStream = (streams.find(track => track.disposition?.default) ?? streams[0])?.index ?? null;
      } else {
        const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
        const dispose = () => input.dispose();
        combined.addEventListener('abort', dispose, { once: true });
        try {
          const [allTracks, audioTracks, primary] = await Promise.all([input.getTracks(), input.getAudioTracks(), input.getPrimaryAudioTrack()]);
          if (audioTracks.length !== streams.length) throw new Error('Audio tracks could not be inspected.');
          // Audio ordinal maps FFmpeg's source stream to the exact indexes used by probeBrowserPlayback.
          indexes = audioTracks.map(track => allTracks.indexOf(track));
          defaultAudioStream = primary ? allTracks.indexOf(primary) : indexes[0] ?? null;
        } finally { combined.removeEventListener('abort', dispose); input.dispose(); }
      }
      const tracks: AudioLoudnessAnalysis['tracks'] = [];
      let failed = false;
      for (const [ordinal, stream] of streams.entries()) {
        combined.throwIfAborted();
        let log = '';
        const logger = ({ message }: { message: string }) => { log = (log + '\n' + message).slice(-16384); };
        engine.on('log', logger);
        try {
          const code = await engine.exec(['-hide_banner', '-nostats', '-v', 'info', '-threads', '1', '-protocol_whitelist', 'file,pipe', '-i', '/input/source',
            '-map', `0:${stream.index}`, '-vn', '-sn', '-dn', '-filter_threads', '1',
            '-af', 'loudnorm=I=-18:TP=-3:LRA=11:print_format=json', '-f', 'null', '-'], FILE_TIMEOUT);
          if (code !== 0) throw new Error('Some audio tracks could not be measured.');
          tracks.push({ index: indexes[ordinal], loudness: parseLoudnorm(log) });
        } catch {
          combined.throwIfAborted();
          failed = true;
        } finally { engine.off('log', logger); }
      }
      combined.throwIfAborted();
      if (failed) throw new Error('Some audio tracks could not be measured.');
      const analysis = { version: 1 as const, size: file.size, mtime: file.lastModified, defaultAudioStream, tracks };
      if (!readAudioAnalysis(JSON.stringify(analysis), file.size, file.lastModified)) throw new Error('Audio analysis returned an invalid loudness measurement.');
      return analysis;
    } catch (error) {
      this.dispose();
      combined.throwIfAborted();
      throw error;
    } finally {
      clearTimeout(timer);
      combined.removeEventListener('abort', cancel);
      if (engine?.loaded) {
        await engine.deleteFile('probe.json').catch(() => {});
        await engine.unmount('/input').catch(() => {});
      }
    }
  }
}
