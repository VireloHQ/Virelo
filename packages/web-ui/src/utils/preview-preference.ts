export const PREVIEW_ENABLED_KEY = 'virelo-preview-enabled:v1';
let preference: boolean | undefined;
let sessionOnly = false;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };

export function readPreviewEnabled() {
  if (preference !== undefined) return preference;
  try { return preference = localStorage.getItem(PREVIEW_ENABLED_KEY) !== 'false'; }
  catch { return preference = true; }
}

export function savePreviewEnabled(value: boolean) {
  const previous = readPreviewEnabled();
  preference = value;
  try { localStorage.setItem(PREVIEW_ENABLED_KEY, String(value)); sessionOnly = false; }
  catch { sessionOnly = true; /* Keep this session's choice when storage is blocked. */ }
  if (previous !== value) notify();
}

export function refreshPreviewEnabled() {
  const previous = preference;
  preference = undefined;
  sessionOnly = false;
  if (readPreviewEnabled() !== previous) notify();
}

function storage(event: StorageEvent) {
  if (event.key !== PREVIEW_ENABLED_KEY && event.key !== null) return;
  try { if (event.storageArea && event.storageArea !== localStorage) return; }
  catch { return; }
  const previous = preference;
  preference = event.newValue !== 'false';
  sessionOnly = false;
  if (preference !== previous) notify();
}

export function subscribePreviewEnabled(listener: () => void) {
  if (!listeners.size) {
    if (!sessionOnly) preference = undefined;
    window.addEventListener('storage', storage);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('storage', storage);
      if (!sessionOnly) preference = undefined;
    }
  };
}
