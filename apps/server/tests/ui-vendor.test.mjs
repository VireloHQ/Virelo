import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
async function sources(directory) {
  const files = [];
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) files.push(...await sources(url));
    else if (/\.tsx?$/.test(entry.name)) files.push(url);
  }
  return files;
}

test('scoped HeroUI styles cover every imported component and shared foundations', async () => {
  const css = await readFile(new URL('web/src/heroui.css', root), 'utf8');
  const styles = await readFile(new URL('web/src/styles.css', root), 'utf8');
  assert.match(styles, /@import ["']\.\/heroui\.css["']/);
  assert.doesNotMatch(styles, /@import ["']@heroui\/styles["']/);
  for (const foundation of ['base','themes/default','utilities','variants'])
    assert.ok(css.includes('"@heroui/styles/' + foundation + '"'), foundation);
  const components = {Button:'button',buttonVariants:'button',Input:'input',Switch:'switch',Modal:'modal',Popover:'popover'};
  for (const file of await sources(new URL('web/src/', root))) {
    const source = await readFile(file, 'utf8');
    for (const match of source.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]@heroui\/react['"]/g)) {
      for (const name of match[1].split(',').map(value=>value.trim()).filter(value=>value&&!value.startsWith('type '))) {
        const imported = name.split(/\s+as\s+/)[0];
        assert.ok(Object.hasOwn(components, imported), 'Map the stylesheet for ' + imported + ' in ' + file.pathname);
        assert.ok(css.includes('/components/' + components[imported] + '.css'), imported);
      }
    }
  }
  for (const component of ['close-button','empty-state','skeleton'])
    assert.ok(css.includes('/components/' + component + '.css'), component + ' is a nested primitive or shared class');
});

test('production CSS retains controls without shipping unused calendar and color-picker styles', async () => {
  const metadata = JSON.parse(await readFile(new URL('package.json', root),'utf8'));
  const output = new URL(metadata.name === 'virelo' ? 'dist/web/' : 'dist/', root);
  const html = await readFile(new URL('index.html',output),'utf8');
  const paths = [...html.matchAll(/<link\b[^>]*href="([^"?]+\.css)(?:\?[^" ]*)?"/g)].map(match=>match[1]);
  assert.ok(paths.length, 'built HTML references CSS');
  const css = (await Promise.all(paths.map(path=>readFile(new URL(path.replace(/^\//,''), output),'utf8')))).join('\n');
  for (const component of ['button','input','switch__thumb','modal__dialog','popover__dialog','close-button'])
    assert.ok(css.includes('.' + component), component + ' styles remain available');
  assert.doesNotMatch(css, /\.(?:calendar|date-picker|color-picker|input-otp)(?:__|--|[\s{:.])/);
});
