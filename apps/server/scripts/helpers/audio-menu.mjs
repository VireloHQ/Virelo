import {join} from 'node:path';
import {openPlaybackSetting} from './playback-settings.mjs';

export async function auditAudioMenu(page,mode,artifacts,check){
  const row=page.getByRole('menuitemcheckbox',{name:/Volume leveling/});
  const settled=()=>page.getByRole('menu',{name:'Audio',exact:true}).evaluate(async menu=>{
    await document.fonts.ready;
    await Promise.all(menu.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})));
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  });
  const measure=()=>row.evaluate(button=>{
    const icon=button.querySelector('svg').getBoundingClientRect(),label=button.querySelector('strong').getBoundingClientRect();
    const state=button.querySelector('small').getBoundingClientRect(),bounds=button.getBoundingClientRect();
    const check=button.querySelector('svg:last-child')?.getBoundingClientRect();
    return {left:label.left,aligned:getComputedStyle(button).display==='grid'&&label.left-icon.right>=9&&label.left-icon.right<=16&&Math.abs(label.left-state.left)<1&&label.right<=bounds.right-20&&(!check||check.right<=bounds.right-6)};
  });
  const verify=async label=>{
    await settled();
    const before=await measure();check(before.aligned,label+' aligns icon, left-aligned label, status and checkmark');
    const initial=await row.getAttribute('aria-checked');await row.focus();await page.keyboard.press('Space');
    await page.waitForFunction(initial=>document.querySelector('.playback-settings-menu:not([hidden]) .playback-toggle-row')?.getAttribute('aria-checked')!==initial,initial);
    await settled();
    const after=await measure();check(after.aligned&&Math.abs(before.left-after.left)<1,label+' stays aligned when toggled by keyboard: '+JSON.stringify({before,after}));
    await page.screenshot({path:join(artifacts,label.replaceAll(' ','-')+'.png')});
    await page.keyboard.press('Space');
    await page.waitForFunction(initial=>document.querySelector('.playback-settings-menu:not([hidden]) .playback-toggle-row')?.getAttribute('aria-checked')===initial,initial);
    check(!/No pre-scan|file changes|Live volume adjustment/.test(await page.getByRole('menu',{name:'Audio',exact:true}).innerText()),label+' omits implementation commentary');
  };
  for(const width of[1440,390,320]){
    await page.setViewportSize({width,height:1000});await page.locator('.player').hover();await openPlaybackSetting(page,'Audio');
    await verify(mode+' audio '+width);await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.player video').click({button:'right',position:{x:90,y:70}});
  await page.locator('.player-action-menu').getByRole('menuitem',{name:'Settings',exact:true}).click();
  await page.getByRole('menu',{name:'Settings',exact:true}).getByRole('menuitem',{name:'Audio',exact:true}).click();
  await verify(mode+' context audio');
  await page.keyboard.press('Escape');await page.keyboard.press('Escape');await page.keyboard.press('Escape');
  await page.setViewportSize({width:390,height:844});
}
