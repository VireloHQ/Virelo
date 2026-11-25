import assert from 'node:assert/strict';

export async function auditMiniplayerDrag(page, mini, label, touch=false) {
  const outer=page.locator('.playback-dock[data-minimized="true"]');
  const pause=mini.getByRole('button',{name:'Pause',exact:true});
  await page.mouse.move(1,1);
  const controls=()=>pause.evaluate(button=>getComputedStyle(button).pointerEvents);
  assert.equal(await controls(),'none',label+' controls do not intercept idle taps');
  assert.equal((await mini.textContent()).trim(),'',label+' the picture has no title strip');
  const start=await mini.boundingBox(), x=start.x+start.width*.25, y=start.y+start.height*.65;
  const viewport=page.viewportSize();
  const destination={x:viewport.width*.12,y:viewport.height*.18};
  if(touch){
    const cdp=await page.context().newCDPSession(page);
    try {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      for(let step=1;step<=8;step++)
        await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+(destination.x-x)*step/8,y:y+(destination.y-y)*step/8}]});
      assert.equal(await mini.getAttribute('data-dragging'),'true',label+' touch tracks before release');
      await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    } finally { await cdp.detach(); }
  }else{
    await page.mouse.move(x,y);await page.mouse.down();
    await page.mouse.move(destination.x,destination.y,{steps:10});
    assert.equal(await mini.getAttribute('data-dragging'),'true',label+' pointer tracks before release');
    await page.mouse.up();
  }
  assert.equal(await outer.getAttribute('data-corner'),'top-left',label+' releases into the closest corner');
  await outer.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished)));
  const end=await outer.boundingBox();
  assert.ok(end.y<start.y&&end.x<=start.x,label+' the picture moves to the top-left');
  await mini.press('ArrowRight');assert.equal(await outer.getAttribute('data-corner'),'top-right');
  await mini.press('ArrowDown');assert.equal(await outer.getAttribute('data-corner'),'bottom-right');
  await mini.press('ArrowLeft');assert.equal(await outer.getAttribute('data-corner'),'bottom-left');
  await outer.evaluate(node=>Promise.all(node.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  assert.ok(await pause.count(),label+' dragging and moving with arrow keys never pauses playback');
  await mini.evaluate(node=>node.blur());
  if(touch) await mini.tap({position:{x:20,y:80}});
  else await mini.hover({position:{x:20,y:80}});
  assert.equal(await controls(),'auto',label+' touching or hovering the picture reveals the actions');
  console.log('PASS',label+' drag snaps to the corners; the overlay stays out of the picture until interaction');
}

export async function auditMiniplayer(page, label) {
  const player=page.locator('.playback-dock .player video');
  const origin=page.url();
  const original=await player.elementHandle();
  const src=await player.evaluate(video=>{
    window.__miniplayerResets=0;
    for(const event of ['emptied','loadstart'])video.addEventListener(event,()=>window.__miniplayerResets++);
    return video.currentSrc;
  });
  const assertSameVideo=async()=>{
    assert.ok(await player.evaluate((video,start)=>video===start,original),label+' keeps the exact playing element');
    assert.equal(await player.evaluate(video=>video.currentSrc),src,label+' keeps the same media URL');
    assert.equal(await page.evaluate(()=>window.__miniplayerResets),0,label+' never reloads or empties the video');
    assert.equal(await page.evaluate(()=>document.pictureInPictureElement),null,label+' does not use browser PiP');
  };
  const mini=page.getByRole('group',{name:'Miniplayer',exact:true});
  await page.getByRole('link',{name:'Library',exact:true}).first().click();
  await mini.waitFor();
  await assertSameVideo();
  const time=await player.evaluate(video=>video.currentTime);
  await page.waitForFunction(({original,time})=>!original.paused&&original.currentTime>time+.12,{original,time});
  assert.ok(await mini.evaluate(controls=>{
    const rect=controls.closest('.playback-dock').getBoundingClientRect();
    const video=controls.closest('.player').querySelector('video'), picture=video.getBoundingClientRect();
    const nav=document.querySelector('.mobile-nav')?.getBoundingClientRect();
    const bottom=nav?.height ? nav.top : innerHeight;
    return rect.top>=0&&rect.left>=0&&rect.right<=innerWidth&&rect.bottom<=bottom+1
      &&picture.height>=64&&picture.top>=rect.top&&rect.bottom-picture.bottom<=2
      &&controls.contains(document.elementFromPoint(picture.x+picture.width/2,picture.y+picture.height/2))
      &&[...controls.querySelectorAll('button')].every(button=>button.offsetWidth>=44&&button.offsetHeight>=44);
  }),label+' miniplayer and touch targets fit above navigation');
  if(process.env.VIRELO_TEST_MINIPLAYER_SCREENSHOT)
    await page.screenshot({path:process.env.VIRELO_TEST_MINIPLAYER_SCREENSHOT});
  await auditMiniplayerDrag(page,mini,label,await page.evaluate(()=>matchMedia('(pointer:coarse)').matches));
  await assertSameVideo();
  await mini.getByRole('button',{name:'Pause',exact:true}).click();
  assert.ok(await player.evaluate(video=>video.paused),label+' its pause button works');
  await mini.getByRole('button',{name:'Play',exact:true}).click();
  await page.waitForFunction(video=>!video.paused,original);
  await mini.getByRole('button',{name:'Expand player',exact:true}).click();
  await page.waitForURL(origin);
  await mini.waitFor({state:'hidden'});
  await assertSameVideo();
  console.log('PASS',label+' playback survives navigation, pause, resume and restore without PiP');
}

export async function auditMinimizedQueue(page, label) {
  const player=page.locator('.playback-dock .player video');
  await page.waitForFunction(()=>{const video=document.querySelector('.playback-dock .player video');return video&&!video.paused&&video.currentTime>.1;});
  await page.locator('.playback-dock .player').hover();
  await page.getByRole('button',{name:'Minimize player',exact:true}).click();
  const mini=page.getByRole('group',{name:'Miniplayer',exact:true});
  await mini.waitFor();
  const url=page.url(), title=await player.evaluate(video=>video.closest('.player').getAttribute('aria-label'));
  assert.ok(await player.evaluate(video=>Number.isFinite(video.duration)));
  await player.evaluate(video=>video.currentTime=video.duration-.1);
  await page.waitForFunction(title=>document.querySelector('.playback-dock .player')?.getAttribute('aria-label')!==title,title);
  await page.waitForFunction(()=>{const video=document.querySelector('.playback-dock .player video');return video&&!video.paused&&video.currentTime>.1&&video.currentTime<5;});
  assert.equal(page.url(),url,label+' queue advances without interrupting browsing');
  await mini.press('ArrowRight');
  await mini.getByRole('button',{name:'Close miniplayer',exact:true}).click();
  await player.waitFor({state:'detached'});
  assert.equal(page.url(),url,label+' closing leaves the browsing page in place');
  console.log('PASS',label+' queue advances in the miniplayer and closes in place');
}
