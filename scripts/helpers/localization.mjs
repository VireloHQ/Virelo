import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const languages=[['en','English'],['ja','日本語'],['zh-CN','简体中文'],['ko','한국어'],['ru','Русский']];
export async function auditLocalization({page,context,mode,base,items,artifacts,browser}) {
  const prefix=mode==='web'?'/app':'',repo=mode==='web'?process.env.VIRELO_TEST_WEB_REPO:fileURLToPath(new URL('../../',import.meta.url));
  const catalogs=Object.fromEntries(await Promise.all(languages.map(async([locale])=>[locale,JSON.parse(await readFile(join(repo,'web/src/i18n/messages',locale+'.json'),'utf8'))])));
  const check=(value,label)=>{assert.ok(value,mode+' '+label);console.log('PASS',mode,'localization:',label);};
  const settled=target=>target.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
  const openAppearance=async target=>{
    // The standalone settings page keeps its selected pane in component state, not the URL.
    await target.setViewportSize({width:1440,height:1000});
    await target.locator('#settings-nav-appearance').click();
    await target.locator('#settings-title-appearance').waitFor();
  };
  const choose=async(target,value)=>{
    const picker=target.locator('.appearance-language .picker-trigger');
    await picker.click();
    const write=mode==='npm'?target.waitForResponse(response=>new URL(response.url()).pathname==='/api/account/language'&&response.request().method()==='PUT'):null;
    await target.getByRole('option',{name:languages.find(([locale])=>locale===value)[1],exact:true}).click();
    if(write)assert.equal((await write).status(),200);
    await target.waitForFunction(locale=>document.documentElement.lang===locale,value);
    await target.locator('.appearance-language .language-select[aria-busy="false"]').waitFor();
  };
  const noEnglish=async(target,locale)=>{
    if(locale==='en')return;
    const messages=Object.keys(catalogs.en).filter(key=>typeof catalogs[locale][key]==='string'&&catalogs[locale][key]!==key);
    const remaining=await target.evaluate(messages=>{
      const source=new Set(messages),found=new Set();
      const root=document.querySelector('.settings-view,.watch-view,.playlists-view')??document.body;
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
        const node=walker.currentNode,parent=node.parentElement,text=node.textContent.trim();
        if(!parent||!parent.getClientRects().length||parent.closest('code,pre,input,textarea,.language-select,.appearance-style-label'))continue;
        if(source.has(text))found.add(text);
      }return [...found];
    },messages);
    assert.deepEqual(remaining,[],mode+' '+locale+' visible controls have no untranslated source messages');
  };
  await page.goto(base+prefix+'/settings#appearance');
  await openAppearance(page);
  for(const[locale]of languages){
    await choose(page,locale);
    check(await page.locator('#settings-title-appearance').innerText()===catalogs[locale].Appearance,locale+' selected through the visible language menu');
    for(const width of[1440,960,390,320]){
      await page.setViewportSize({width,height:1000});
      await page.evaluate(async()=>{scrollTo(0,0);await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),locale+' settings fit '+width+'px');
      if(width<=390)check(await page.locator('.mobile-nav a span').evaluateAll(labels=>labels.every(label=>{
        const text=document.createRange();text.selectNodeContents(label);
        const box=text.getBoundingClientRect(),link=label.parentElement.getBoundingClientRect();
        return box.left>=link.left&&box.right<=link.right&&box.bottom<=link.bottom;
      })),locale+' mobile navigation labels stay inside their buttons at '+width+'px');
      await noEnglish(page,locale);
      if(width===1440||width===320)await page.screenshot({path:join(artifacts,'locale-'+mode+'-'+locale+'-'+width+'.png'),fullPage:true,animations:'disabled'});
    }
    await page.reload();await openAppearance(page);
    await page.waitForFunction(locale=>document.documentElement.lang===locale,locale);
    check(await page.locator('#settings-title-appearance').innerText()===catalogs[locale].Appearance,locale+' survives a reload');
    if(mode==='npm'){
      const result=await page.request.get(base+'/api/account/language');assert.equal((await result.json()).locale,locale);
    }else check(await page.evaluate(()=>localStorage.getItem('virelo.language.v1'))===locale,locale+' is stored in this browser');
    await page.setViewportSize({width:1440,height:1000});
    if(mode==='npm')for(const section of['accounts','admin','activity','announcements','libraries']){
      await page.locator('#settings-nav-'+section).click();await noEnglish(page,locale);
    }
    await page.locator('#settings-nav-appearance').click();
  }
  await choose(page,'en');
  await page.goto(base+prefix+'/watch/'+items[0].id+'?queue=false');
  await page.waitForFunction(()=>{const video=document.querySelector('.player video');return video&&video.readyState>=2;});
  await page.evaluate(()=>{
    const video=document.querySelector('.player video');video.pause();video.currentTime=2;video.volume=.37;
    window.__localeVideo=video;window.__localeSource=video.currentSrc;
  });
  const other=await context.newPage();
  try{
    if(mode==='npm'){
      const captured=deferred(),release=deferred(),finished=deferred();let held=false;
      await other.route('**/api/account/language',async route=>{
        if(route.request().method()!=='GET'||held)return route.continue();
        held=true;const response=await route.fetch();captured.resolve();await release.promise;
        await route.fulfill({response});finished.resolve();
      });
      try{
        await other.goto(base+'/settings#appearance');await captured.promise;await openAppearance(other);await choose(other,'ja');
      }finally{release.resolve();}
      await finished.promise;await settled(other);
      check(await other.evaluate(()=>document.documentElement.lang==='ja'),'a late preference read cannot undo a newer language save');
      await other.unroute('**/api/account/language');
    }else{
      await other.goto(base+prefix+'/settings#appearance');await openAppearance(other);await choose(other,'ja');
    }
    await page.waitForFunction(()=>document.documentElement.lang==='ja');
    check(await page.evaluate(()=>{const video=document.querySelector('.player video');return video===window.__localeVideo&&video.currentSrc===window.__localeSource&&video.paused&&Math.abs(video.currentTime-2)<.1&&Math.abs(video.volume-.37)<.001;}),'changing language in another tab preserves video node, source, time, pause and volume');
    await page.locator('.player').hover();
    check(await page.locator('.player-play-button').getAttribute('aria-label')===catalogs.ja.Play,'player controls update in place');
    await page.getByRole('button',{name:catalogs.ja['Playback settings'],exact:true}).click();
    await page.getByRole('menuitem',{name:catalogs.ja.Quality,exact:true}).click();
    check(await page.getByRole('menuitemradio',{name:new RegExp(catalogs.ja['Original Quality'])}).count()>0,'quality menu is localized too');
    await page.keyboard.press('Escape');await page.keyboard.press('Escape');
    await noEnglish(page,'ja');
    await page.screenshot({path:join(artifacts,'locale-'+mode+'-player-ja.png')});
    await choose(other,'en');
    if(mode==='npm'){
      const switchUser=async username=>{
        const response=await other.request.post(base+'/api/auth/login',{headers:{'x-virelo-request':'1'},data:{username,password:'1'}});
        assert.equal(response.status(),200);
        const status=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/status');
        await other.evaluate(()=>window.dispatchEvent(new Event('virelo-auth-expired')));
        assert.equal((await (await status).json()).user.username,username);
        await other.locator('.appearance-language').waitFor();
      };
      await switchUser('viewer');await choose(other,'ko');
      await switchUser('owner');await other.waitForFunction(()=>document.documentElement.lang==='en');
      check(await other.locator('#settings-title-appearance').innerText()==='Appearance','returning to owner does not reuse viewer language');
      assert.equal((await (await other.request.get(base+'/api/account/language')).json()).locale,'en');
      await switchUser('viewer');await choose(other,'en');await switchUser('owner');
      await other.waitForFunction(()=>document.documentElement.lang==='en');
      const captured=deferred(),release=deferred(),finished=deferred();
      await other.route('**/api/account/language',async route=>{
        if(route.request().method()!=='PUT')return route.continue();
        const response=await route.fetch();captured.resolve();await release.promise;
        await route.fulfill({response});finished.resolve();
      });
      try{
        await other.locator('.appearance-language .picker-trigger').click();
        await other.getByRole('option',{name:'日本語',exact:true}).click();await captured.promise;
        await switchUser('viewer');
      }finally{release.resolve();}
      await finished.promise;await settled(other);
      check(await other.evaluate(()=>document.documentElement.lang==='en'),'a pending save from the previous account cannot change the new account language');
      await other.unroute('**/api/account/language');
      await switchUser('owner');await other.waitForFunction(()=>document.documentElement.lang==='ja');await choose(other,'en');
    }
  }finally{await other.close();}
  await page.evaluate(()=>{const video=document.querySelector('.player video');if(video)video.volume=1;});
  await page.goto(base+prefix+'/settings#appearance');await openAppearance(page);await page.waitForFunction(()=>document.documentElement.lang==='en');
  if(mode==='web'){
    await page.goto(base+'/');await page.waitForFunction(()=>document.documentElement.lang==='en');
    const menu=page.locator('.public-language-picker .picker-trigger');await menu.click();
    await page.getByRole('option',{name:'Русский',exact:true}).click();await page.waitForFunction(()=>document.documentElement.lang==='ru');
    check(await page.locator('.landing-hero h1').innerText().then(text=>!text.includes('Your collection.')),'landing page uses the same Russian catalog');
    await page.goto(base+'/app/settings#appearance');await openAppearance(page);await page.waitForFunction(()=>document.documentElement.lang==='ru');await choose(page,'en');
  }else{
    const failure=await browser.newContext({serviceWorkers:'block'});
    try{
      await failure.addInitScript(()=>localStorage.setItem('virelo.language.v1','ja'));
      const broken=await failure.newPage();await broken.route('**/assets/index-*.js',route=>route.abort());
      await broken.goto(base+'/');await broken.locator('#startup-error').waitFor({state:'visible'});
      check(await broken.locator('#startup-error-title').innerText()===catalogs.ja['Virelo couldn’t start'],'missing entry bundle still shows a localized recovery screen');
    }finally{await failure.close();}
  }
  await page.setViewportSize({width:390,height:844});
}
