export async function auditPlaylistField(page,input,label,check) {
  await input.click();
  const box=await input.boundingBox();
  const styles=await input.evaluate(element=>{
    const style=getComputedStyle(element);
    return {outline:style.outlineStyle,shadow:style.boxShadow,border:parseFloat(style.borderTopWidth),radius:parseFloat(style.borderTopLeftRadius)};
  });
  check(styles.outline==='none'&&styles.border===0&&(styles.shadow==='none'||styles.shadow.includes('inset')),label+' playlist field has no outer focus ring or border');
  check(styles.radius<=8,label+' playlist field uses the app corner radius');
  await input.press('Tab');await page.keyboard.press('Shift+Tab');
  check(await input.evaluate(element=>element===document.activeElement&&getComputedStyle(element).boxShadow.includes('inset')),label+' keyboard focus retains a neutral underline');
  const focused=await input.boundingBox();
  check(Math.abs(box.width-focused.width)<.5&&Math.abs(box.height-focused.height)<.5,label+' focus never changes field dimensions');
}
