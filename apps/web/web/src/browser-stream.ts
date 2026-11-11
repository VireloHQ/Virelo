import { AppendOnlyStreamTarget, Mp4OutputFormat, Output, type Conversion } from 'mediabunny';

export interface BrowserStreamOptions {
  position: number;
  duration: number;
  signal: AbortSignal;
  getElement: () => HTMLMediaElement | null;
  onError: (error: Error) => void;
  onSeek: (position: number) => void;
}
type PreparedConversion = { conversion: Conversion; dispose: () => void };

export async function streamBrowserConversion(options: BrowserStreamOptions,
  configure: (output: Output, start: number) => Promise<PreparedConversion>): Promise<string> {
  if(options.signal.aborted)throw new DOMException('Playback preparation cancelled.', 'AbortError');
  const start = Math.max(0, Math.min(Math.floor(options.position), Math.max(0, options.duration - 1)));
  const source = new MediaSource(), chunks: Uint8Array<ArrayBuffer>[] = [];
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'fragmented', minimumFragmentDuration: 1 }),
    target: new AppendOnlyStreamTarget(new WritableStream({ write: data => { chunks.push(new Uint8Array(data)); } }))
  });
  const prepared = await configure(output, start);
  const { conversion } = prepared;
  if (options.signal.aborted) { await conversion.cancel(); prepared.dispose(); throw new DOMException('Playback preparation cancelled.', 'AbortError'); }
  const url = URL.createObjectURL(source);
  let buffer: SourceBuffer | null = null, element: HTMLMediaElement | null = null;
  let redirected = false, disposed = false;
  let released = false;
  const release = () => { if (!released) { released = true; prepared.dispose(); } };

  const update = (operation: () => void) => new Promise<void>((resolve, reject) => {
    if (!buffer || options.signal.aborted) { reject(new DOMException('Playback preparation cancelled.', 'AbortError')); return; }
    const cleanup = () => { buffer?.removeEventListener('updateend', done); buffer?.removeEventListener('error', failed); options.signal.removeEventListener('abort', failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(options.signal.aborted ? 'Playback preparation cancelled.' : 'Converted playback could not be buffered.')); };
    buffer.addEventListener('updateend', done, { once: true }); buffer.addEventListener('error', failed, { once: true });
    options.signal.addEventListener('abort', failed, { once: true });
    try { operation(); } catch (error) { cleanup(); reject(error); }
  });
  const wait = () => new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); options.signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, 150); options.signal.addEventListener('abort', done, { once: true });
  });
  const seek = () => {
    if (disposed || redirected || !element || element.currentSrc !== url || !buffer?.buffered.length) return;
    const position = element.currentTime;
    for (let i = 0; i < buffer.buffered.length; i++)
      if (position >= buffer.buffered.start(i) - .3 && position <= buffer.buffered.end(i) + .3) return;
    if (Math.abs(position - options.position) < .3) return;
    redirected = true; options.onSeek(position);
  };
  const cancel = () => {
    if (disposed) return; disposed = true;
    source.removeEventListener('sourceopen', opened);
    source.removeEventListener('sourceclose', cancel);
    element?.removeEventListener('seeking', seek);
    options.signal.removeEventListener('abort', cancel);
    chunks.length = 0;
    void conversion.cancel().catch(() => {}).finally(release);
    URL.revokeObjectURL(url);
  };
  const run = async () => {
    source.duration = options.duration;
    element = options.getElement(); element?.addEventListener('seeking', seek);
    let through = 0;
    // MIME becomes known after the encoder emits its first packets, not before execution.
    const initialized = output.getMimeType().then(mime => {
      if (disposed || options.signal.aborted) return;
      if (!MediaSource.isTypeSupported(mime)) throw new Error('This browser cannot stream the converted format.');
      buffer = source.addSourceBuffer(mime); buffer.timestampOffset = start;
    });
    // Observe rejection immediately while execute is still producing its first fragment.
    void initialized.catch(() => {});
    while (!disposed && !options.signal.aborted) {
      through += 2;
      await conversion.execute({ until: through });
      await initialized;
      if (disposed || options.signal.aborted || !buffer) return;
      while (chunks.length) {
        const chunk = chunks.shift()!;
        await update(() => buffer!.appendBuffer(chunk));
      }
      const position = element?.currentTime ?? start;
      if (position > start + 14 && buffer.buffered.length && buffer.buffered.start(0) < position - 14)
        await update(() => buffer!.remove(0, position - 12));
      if (conversion.state === 'done') {
        if (source.readyState === 'open' && !buffer.updating) source.endOfStream();
        release(); return;
      }
      // Bound conversion work and decoded buffering while paused or viewing a long file.
      while (!disposed && !options.signal.aborted && start + through - (element?.currentTime ?? start) > 12) await wait();
    }
  };
  const opened = () => { void run().catch(reason => {
    try { if (!disposed && !options.signal.aborted) options.onError(reason instanceof Error ? reason : new Error('Converted playback failed.')); }
    finally { cancel(); }
  }); };
  options.signal.addEventListener('abort', cancel, { once: true });
  source.addEventListener('sourceopen', opened, { once: true });
  source.addEventListener('sourceclose', cancel, { once: true });
  return url;
}
