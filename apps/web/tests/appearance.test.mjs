import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL("../web/src/utils/appearance.ts", import.meta.url), 'utf8');
const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const { DEFAULT_APPEARANCE: defaults, normalizeAppearance: normalize, isAppearance: valid, appearanceVariables: variables, CONTROLLER_STYLES: styles } = await import(moduleUrl);

test('appearance defaults and validation are bounded, normalized and injection-safe', () => {
  assert.deepEqual(defaults, { controllerStyle: 'classic', accentColor: '#c3a6ff' });
  assert.ok(Object.isFrozen(defaults));
  for (const controllerStyle of styles) assert.ok(valid({ controllerStyle, accentColor: '#AB12EF' }));
  for (const invalid of [null, [], {}, { ...defaults, controllerStyle: 'unknown' }, { ...defaults, userId: 2 },
    { ...defaults, accentColor: 'red' }, { ...defaults, accentColor: '#fff' }, { ...defaults, accentColor: '#ffffff;display:none' }]) assert.equal(valid(invalid), false);
  assert.deepEqual(normalize({ controllerStyle: 'unknown', accentColor: 'url(secret)' }), defaults);
  assert.deepEqual(normalize({ controllerStyle: 'theater', accentColor: '#AB12EF' }), { controllerStyle: 'theater', accentColor: '#ab12ef' });
  assert.deepEqual(variables('url(secret)'), {});
  for (const suffix of ['\n', '\r', '\r\n']) {
    const accentColor = '#abcdef' + suffix;
    assert.equal(valid({ ...defaults, accentColor }), false, 'trailing line breaks are not hex colors');
    assert.deepEqual(normalize({ ...defaults, accentColor }), defaults);
    assert.deepEqual(variables(accentColor), {});
  }
});
test('custom accents remain readable, including black and saturated colors', () => {
  const luminance = hex => [1, 3, 5].reduce((sum, index, i) => {
    const channel = parseInt(hex.slice(index, index + 2), 16) / 255;
    return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][i];
  }, 0);
  for (const color of ['#000000', '#ffffff', '#0000ff', '#ff0000', '#008000', '#123456', '#c3a6ff']) {
    const tokens = variables(color);
    for (const token of Object.values(tokens)) assert.match(token, /^#[0-9a-f]{6}$/);
    for (const key of ['--color-brand', '--color-brand-strong', '--color-focus'])
      assert.ok((luminance(tokens[key]) + .05) / (luminance('#303034') + .05) >= (color === '#c3a6ff' && key === '--color-brand-strong' ? 3 : 4.5), color + ' ' + key);
  }
});

test('Appearance settings have a single divider before Library view', async () => {
  const [languageCss, settingsCss, source] = await Promise.all([
    readFile(new URL('../web/src/i18n/language.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../web/src/components/AppearanceSettings.tsx', import.meta.url), 'utf8')
  ]);
  const languageRule = languageCss.match(/\.appearance-language\s*\{([^}]*)\}/)?.[1];
  assert.ok(languageRule, 'language settings style exists');
  assert.doesNotMatch(languageRule, /\bborder(?:-bottom)?\s*:/, 'language settings do not draw a second divider');
  assert.match(settingsCss, /\.setting-row\s*\{[^}]*border-top:\s*1px solid/, 'the settings row draws one divider');
  assert.match(source, /<LanguageSettings\s*\/>\s*<div className="setting-row">/, 'the divider belongs to the next row');
});
