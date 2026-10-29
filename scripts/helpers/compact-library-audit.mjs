export async function auditDropdownJoin(page, picker, label, check) {
  await picker.evaluate(element=>Promise.all(element.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{}))));
  const metrics=await picker.evaluate(element=>{
    const trigger=element.querySelector('.picker-trigger'),menu=element.querySelector('.picker-menu'),a=trigger.getBoundingClientRect(),b=menu.getBoundingClientRect(),s=getComputedStyle(menu),t=getComputedStyle(trigger);
    return {joined:b.top<=a.bottom&&a.bottom-b.top<=2,edges:Math.abs(a.left-b.left)<1&&Math.abs(a.right-b.right)<1,
      corners:[s.borderTopLeftRadius,s.borderTopRightRadius,t.borderBottomLeftRadius,t.borderBottomRightRadius],background:s.backgroundColor===t.backgroundColor};
  });
  check(metrics.joined&&metrics.edges&&metrics.background&&metrics.corners.every(value=>parseFloat(value)===0),label+' dropdown joins its trigger without rounded gaps: '+JSON.stringify(metrics));
}
export async function auditExplorerLayout(page,label,width,check) {
  const divider=page.getByRole('separator',{name:'Folders',exact:true});
  const tiles=page.locator('.explorer-folder-grid .folder-chip');
  if(width<760){
    check(!await divider.isVisible(),label+' mobile keeps the divider out of the full-width video pane');
    check(await tiles.evaluateAll(elements=>elements.every(element=>element.getBoundingClientRect().height>=44)),label+' compact folders retain touch-sized targets');
    return;
  }
  const sidebar=page.locator('.explorer-sidebar'),sideWidth=()=>sidebar.evaluate(element=>element.getBoundingClientRect().width);
  check(await tiles.evaluateAll(elements=>elements.every(element=>element.getBoundingClientRect().height<=44)),label+' folder tiles are compact');
  check(await sidebar.locator('.folder-chip').evaluateAll(elements=>elements.every(element=>element.getBoundingClientRect().height<=36)),label+' desktop tree rows are compact');
  const before=await sideWidth(),box=await divider.boundingBox(),x=box.x+box.width/2,y=box.y+30;
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+120,y,{steps:12});await page.mouse.up();
  const after=await sideWidth();
  check(Math.abs(after-before-120)<2,label+' dragging the divider widens the folder tree under the pointer: '+JSON.stringify({before,after,box,state:await divider.getAttribute('data-dragging')}));
  check(await divider.getAttribute('data-dragging')===null,label+' releasing the divider clears its drag state');
  await divider.focus();await page.keyboard.press('ArrowRight');
  check(Math.abs(await sideWidth()-before-136)<2,label+' keyboard arrows resize the tree');
  await page.keyboard.press('Home');check(await sideWidth()===160,label+' divider has a bounded minimum');
  await page.keyboard.press('End');const wide=await sideWidth();check(wide<=720,label+' divider has a bounded maximum');
  await page.setViewportSize({width:820,height:900});
  check(await page.locator('.explorer-content').evaluate(element=>element.getBoundingClientRect().width>=319),label+' resizing the window preserves space for videos');
  await page.setViewportSize({width,height:900});
  await page.waitForFunction(expected=>Math.abs(document.querySelector('.explorer-sidebar').getBoundingClientRect().width-expected)<1,wide);
  await page.reload();await divider.waitFor();await page.locator('.splash-screen').waitFor({state:'hidden'});
  check(Math.abs(await sideWidth()-wide)<1,label+' chosen divider width survives reload');
  await divider.dblclick({position:{x:4,y:30}});
  check(await sideWidth()===230,label+' double-click restores the default divider width');
  const input=page.getByRole('combobox',{name:'Path',exact:true});
  await input.fill('/Clips');await input.press('Enter');
  await page.getByRole('heading',{name:'Clips',exact:true}).waitFor();
}
export async function auditPlaylistListLayout(panel,label,check) {
  check(await panel.locator('.playback-queue-list').evaluate(element=>{
    const s=getComputedStyle(element);return parseFloat(s.paddingTop)>=8&&parseFloat(s.paddingBottom)>=8&&parseFloat(s.rowGap)===0;
  }),label+' list has breathing room at its outer edges without gaps between videos');
  check(await panel.locator('.playback-queue-title>div').evaluate(element=>{
    const children=[...element.children];return children.length>=2&&Math.abs(children[0].getBoundingClientRect().top-children[1].getBoundingClientRect().top)<12;
  }),label+' playlist heading and count share a compact row');
  check(await panel.locator('.queue-footer').count()===0,label+' an unchanged vertical playlist does not show a drag instruction or empty footer');
}

