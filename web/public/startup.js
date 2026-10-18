// This stays independent of the module bundle so missing entry files cannot leave a blank page.
(() => {
  const root = document.getElementById('root');
  const fallback = document.getElementById('startup-error');
  const detail = document.getElementById('startup-error-detail');
  const loading = document.getElementById('startup-loading');
  if (!root || !fallback || !detail) return;
  const pendingStyles = new Set(document.querySelectorAll('link[data-startup-style]'));
  let lastError = '';
  const ready = () => root.hasChildNodes() && pendingStyles.size === 0;
  function fail(message) {
    lastError = message;
    if (ready()) return;
    detail.textContent = message;
    if (loading) loading.hidden = true;
    fallback.hidden = false;
  }
  const timer = setTimeout(() => fail('The app did not finish starting. Check that the server is still running.'), 15000);
  function reveal() {
    if (!ready()) return;
    root.hidden = false;
    if (loading) loading.hidden = true;
    clearTimeout(timer);
    fallback.hidden = true;
  }
  function hasRules(link) {
    try { return Boolean(link.sheet?.cssRules.length); }
    catch { return false; }
  }
  for (const link of pendingStyles) {
    const loaded = () => {
      if (!hasRules(link)) { fail('Could not load ' + link.href); return; }
      link.media = 'all'; pendingStyles.delete(link); reveal();
    };
    if (hasRules(link)) loaded();
    else {
      link.addEventListener('load', loaded, {once:true});
      link.addEventListener('error', () => fail('Could not load ' + link.href), {once:true});
    }
  }
  const observer = new MutationObserver(() => {
    if (root.hasChildNodes()) reveal();
    else { root.hidden = true; fail(lastError || 'The app stopped before it could display a page. Try again.'); }
  });
  observer.observe(root, {childList:true});
  reveal();
  window.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLScriptElement) fail('Could not load ' + target.src);
    else if (event.message) fail(event.message);
  }, true);
  window.addEventListener('unhandledrejection', event => fail(event.reason instanceof Error ? event.reason.message : String(event.reason)));
  document.getElementById('startup-reload')?.addEventListener('click', () => location.reload());
})();
