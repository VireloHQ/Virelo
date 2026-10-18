// This stays independent of the module bundle so missing entry files cannot leave a blank page.
(() => {
  const root = document.getElementById('root');
  const fallback = document.getElementById('startup-error');
  const detail = document.getElementById('startup-error-detail');
  if (!root || !fallback || !detail) return;
  let lastError = '';
  function fail(message) {
    lastError = message;
    if (root.hasChildNodes()) return;
    detail.textContent = message;
    fallback.hidden = false;
  }
  const timer = setTimeout(() => fail('The app did not finish starting. Check that the server is still running.'), 15000);
  const observer = new MutationObserver(() => {
    if (root.hasChildNodes()) { clearTimeout(timer); fallback.hidden = true; }
    else fail(lastError || 'The app stopped before it could display a page. Try again.');
  });
  observer.observe(root, {childList:true});
  window.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLScriptElement) fail('Could not load ' + target.src);
    else if (event.message) fail(event.message);
  }, true);
  window.addEventListener('unhandledrejection', event => fail(event.reason instanceof Error ? event.reason.message : String(event.reason)));
  document.getElementById('startup-reload')?.addEventListener('click', () => location.reload());
})();
