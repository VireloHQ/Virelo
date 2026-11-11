type Importer<T> = () => Promise<T>;

export class RouteLoadError extends Error {
  readonly retry: () => Promise<unknown>;
  constructor(cause: unknown, retry: () => Promise<unknown>) {
    super('This page could not be downloaded.', { cause });
    this.name = 'RouteLoadError';
    this.retry = retry;
  }
}

export function isImportFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|failed to load module script|loading chunk .* failed|unable to preload css|disallowed mime type/i.test(message);
}

// Browsers can remember a failed module URL. Retry the same build's entry URL,
// never substitute a newer build (which could load a second React runtime).
export function retryModuleUrl(error: unknown, origin: string, attempt: number): string | null {
  if (!isImportFailure(error)) return null;
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/https?:\/\/[^\s"'<>]+\.m?js(?:\?[^\s"'<>]*)?/i);
  if (!match) return null;
  const url = new URL(match[0]);
  if (url.origin !== origin || !url.pathname.startsWith('/assets/')) return null;
  url.searchParams.set('virelo-retry', String(attempt));
  return url.href;
}

export function retryStylesheetUrl(error: unknown, origin: string, attempt: number): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/unable to preload css for ([^\s"'<>]+)/i);
  if (!match) return null;
  const url = new URL(match[1], origin);
  if (url.origin !== origin || !url.pathname.startsWith('/assets/') || !url.pathname.endsWith('.css')) return null;
  url.searchParams.set('virelo-retry', String(attempt));
  return url.href;
}

function reloadStylesheet(url: string) {
  return new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    const timer = window.setTimeout(fail, 8000);
    function fail() {
      window.clearTimeout(timer);
      link.remove();
      reject(new Error('Unable to preload CSS for ' + url));
    }
    link.rel = 'stylesheet';
    link.href = url;
    link.onerror = fail;
    link.onload = () => { window.clearTimeout(timer); resolve(); };
    document.head.append(link);
  });
}

export function createRouteLoader<T>(importer: Importer<T>, options: {
  delays?: number[];
  wait?: (milliseconds: number) => Promise<void>;
  retryImport?: (error: unknown, attempt: number) => Promise<T>;
  validate?: (module: T) => void;
} = {}) {
  const delays = options.delays ?? [300, 900];
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  let module: T | undefined;
  let pending: Promise<T> | undefined;
  let failure: unknown;
  let failed = false;
  let retrySequence = 0;

  function load(): Promise<T> {
    if (module !== undefined) return Promise.resolve(module);
    if (pending) return pending;
    failure = undefined;
    failed = false;
    pending = (async () => {
      let lastError: unknown;
      for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
          const retry = attempt && typeof window !== 'undefined' ? ++retrySequence : 0;
          const url = retry ? retryModuleUrl(lastError, window.location.origin, retry) : null;
          const css = retry ? retryStylesheetUrl(lastError, window.location.origin, retry) : null;
          // Vite remembers failed CSS preloads too. Restore the stylesheet before
          // allowing navigation, rather than displaying a recovered unstyled page.
          if (css) await reloadStylesheet(css);
          const result = attempt && options.retryImport
            ? await options.retryImport(lastError, attempt)
            : url ? await import(/* @vite-ignore */ url) as T : await importer();
          options.validate?.(result);
          module = result;
          return result;
        } catch (error) {
          lastError = error;
          if (!isImportFailure(error)) throw error;
          if (attempt < delays.length) await wait(delays[attempt]);
        }
      }
      throw new RouteLoadError(lastError, load);
    })().catch(error => {
      failed = true;
      failure = error;
      throw error;
    }).finally(() => { pending = undefined; });
    return pending;
  }

  return {
    load,
    read(): T {
      if (module !== undefined) return module;
      if (failed) throw failure;
      throw load();
    }
  };
}
