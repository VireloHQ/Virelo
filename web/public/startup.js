// This stays independent of the module bundle so missing entry files cannot leave a blank page.
(() => {
  const root = document.getElementById('root');
  const fallback = document.getElementById('startup-error');
  const detail = document.getElementById('startup-error-detail');
  const loading = document.getElementById('startup-loading');
  if (!root || !fallback || !detail) return;
  let catalogs={en:{}};
  try{const text=document.getElementById('startup-catalogs')?.content.textContent;if(text)catalogs=JSON.parse(text);}catch{}
  let saved;try{saved=localStorage.getItem('virelo.language.v1')||localStorage.getItem('virelo-public-locale:v1');}catch{}
  const preferred=[saved,...(navigator.languages||[navigator.language])].filter(Boolean);
  let locale='en';
  for(const value of preferred){
    const code=value.toLowerCase(),candidate=Object.keys(catalogs).find(key=>key.toLowerCase()===code||code.startsWith(key.toLowerCase()+'-'))
      ||(/^zh(?:$|-(?:cn|sg|hans)(?:-|$))/.test(code)?'zh-CN':null);
    if(candidate){locale=candidate;break;}
  }
  const t=(message,values={})=>(catalogs[locale]?.[message]||message).replace(/\{(\w+)\}/g,(token,key)=>Object.hasOwn(values,key)?String(values[key]):token);
  document.documentElement.lang=locale;
  document.querySelectorAll('[data-startup-message]').forEach(element=>{element.textContent=t(element.dataset.startupMessage);});
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
  const timer = setTimeout(() => fail(t('The app did not finish starting. Check that the server is still running.')), 15000);
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
      if (!hasRules(link)) { fail(t('Could not load {url}',{url:link.href})); return; }
      link.media = 'all'; pendingStyles.delete(link); reveal();
    };
    if (hasRules(link)) loaded();
    else {
      link.addEventListener('load', loaded, {once:true});
      link.addEventListener('error', () => fail(t('Could not load {url}',{url:link.href})), {once:true});
    }
  }
  const observer = new MutationObserver(() => {
    if (root.hasChildNodes()) reveal();
    else { root.hidden = true; fail(lastError || t('The app stopped before it could display a page. Try again.')); }
  });
  observer.observe(root, {childList:true});
  reveal();
  window.addEventListener('error', event => {
    const target = event.target;
    if (target instanceof HTMLScriptElement) fail(t('Could not load {url}',{url:target.src}));
    else if (event.message) fail(event.message);
  }, true);
  window.addEventListener('unhandledrejection', event => fail(event.reason instanceof Error ? event.reason.message : String(event.reason)));
  document.getElementById('startup-reload')?.addEventListener('click', () => location.reload());
})();
