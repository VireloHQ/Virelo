import assert from 'node:assert/strict';

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
      &&picture.height>=64&&picture.top>=rect.top&&picture.bottom<=controls.getBoundingClientRect().top+1
      &&document.elementFromPoint(picture.x+picture.width/2,picture.y+picture.height/2)===video
      &&[...controls.querySelectorAll('button')].every(button=>button.offsetWidth>=44&&button.offsetHeight>=44);
  }),label+' miniplayer and touch targets fit above navigation');
  if(process.env.VIRELO_TEST_MINIPLAYER_SCREENSHOT)
    await page.screenshot({path:process.env.VIRELO_TEST_MINIPLAYER_SCREENSHOT});
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
  const url=page.url(), title=await mini.locator('span').textContent();
  assert.ok(await player.evaluate(video=>Number.isFinite(video.duration)));
  await player.evaluate(video=>video.currentTime=video.duration-.1);
  await page.waitForFunction(title=>document.querySelector('.miniplayer-controls span')?.textContent!==title,title);
  await page.waitForFunction(()=>{const video=document.querySelector('.playback-dock .player video');return video&&!video.paused&&video.currentTime>.1&&video.currentTime<5;});
  assert.equal(page.url(),url,label+' queue advances without interrupting browsing');
  await mini.getByRole('button',{name:'Close miniplayer',exact:true}).click();
  await player.waitFor({state:'detached'});
  assert.equal(page.url(),url,label+' closing leaves the browsing page in place');
  console.log('PASS',label+' queue advances in the miniplayer and closes in place');
}
