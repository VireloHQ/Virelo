import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const data = source => 'data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64');
const source = await readFile(new URL('../web/src/i18n/locale.ts', import.meta.url), 'utf8');
const { resolveLocale: resolve, translate, languages: publicLanguages, isLocale: isPublicLocale } = await import(data(source));
const catalogs=Object.fromEntries(await Promise.all(publicLanguages.map(async language=>[language.value,JSON.parse(await readFile(new URL('../web/src/i18n/messages/'+language.value+'.json',import.meta.url),'utf8'))])));
const publicMessages=catalogs.en;
const t=(locale,message,values)=>translate(catalogs[locale],locale,message,values);

test('explicit locale wins, browser language order is respected, and unsupported languages fall back safely', () => {
  assert.equal(resolve('ko', ['ja-JP', 'en-US']), 'ko');
  for (const [languages, expected] of [
    [['ja-JP', 'en'], 'ja'], [['ko-KR'], 'ko'], [['zh-CN'], 'zh-CN'],
    [['zh-SG'], 'zh-CN'], [['zh-Hans-CN'], 'zh-CN'], [['zh'], 'zh-CN'],
    [['zh-Hant', 'ja'], 'ja'], [['zh-TW', 'en'], 'en'], [['fr', 'ko'], 'ko'],
    [['en-GB', 'ja'], 'en'], [[], 'en'], [['fr-FR'], 'en']
  ]) assert.equal(resolve(null, languages), expected);
  for (const bad of [null, false, {}, 'bogus', '<script>', 'ja-JP']) {
    assert.equal(isPublicLocale(bad), false);
    assert.equal(resolve(bad, ['ja']), 'ja');
  }
});

test('public and app messages share the same five-language catalog', () => {
  assert.equal(publicLanguages.length, 5);
  assert.ok(Object.keys(publicMessages).length >= 190);
  for (const message of Object.keys(publicMessages)) {
    for (const locale of ['en', 'ja', 'ko', 'zh-CN', 'ru']) {
      const translated = t(locale, message);
      assert.equal(typeof translated, 'string');
      assert.ok(translated.trim().length > 0, locale + ': ' + message);
    }
    assert.equal(t('en', message), message);
  }
});

test('localized command labels interpolate without translating executable commands', () => {
  assert.equal(t('en', 'Copy {label}', { label: 'npx virelo' }), 'Copy npx virelo');
  assert.equal(t('ja', 'Copy {label}', { label: 'npx virelo' }), 'npx vireloをコピー');
  assert.equal(t('ko', 'Copy {label}', { label: 'npx virelo' }), 'npx virelo 복사');
  assert.equal(t('zh-CN', 'Copy {label}', { label: 'npx virelo' }), '复制npx virelo');
  assert.equal(t('ja', 'Start with') + t('ja', 'a folder.'), '動画フォルダーを選ぶだけ。');
  assert.notEqual(t('ja', 'Start with'), t('ja', 'Start Virelo with'));
});

test('launch copy covers current features in all five languages and scopes server-only claims', async () => {
  const landing = await readFile(new URL('../web/src/views/LandingView.tsx',import.meta.url),'utf8');
  for (const message of [
    'Browse your way.', 'Your playlists. Your order.', 'A more comfortable volume.',
    'Make it feel like yours.', 'Original quality. More control.',
    'Choose a folder and start watching. Use Virelo in a browser, or add it to your home screen as a PWA where supported.',
    'Movie and series info, posters and backdrops, matched automatically.',
    'Separate accounts, personal playlists and library permissions.'
  ]) {
    assert.ok(landing.includes('t('+JSON.stringify(message)+')'),message);
    for (const locale of ['ja','ko','zh-CN','ru']) assert.notEqual(t(locale,message),message,locale+': '+message);
  }
  const serverFeatures=landing.match(/<ul className="landing-cli-features">([\s\S]*?)<\/ul>/)?.[1];
  assert.ok(serverFeatures?.includes('Movie and series info'));
  assert.ok(serverFeatures?.includes('Separate accounts'));
});

test('Shorts are named as a video format, not just short-duration videos', async () => {
  assert.equal(t('en', 'Shorts.'), 'Shorts.');
  assert.equal(t('ja', 'Shorts.'), 'ショート動画も、');
  assert.match(t('ko', 'Shorts.'), /쇼츠/);
  assert.match(t('ja', 'Your own feed.'), /スワイプ/);
  assert.equal(Object.hasOwn(publicMessages, 'Short videos.'), false);
  for (const translation of Object.values(catalogs.ja)) assert.doesNotMatch(translation, /短い動画/);
  const landing = await readFile(new URL('../web/src/views/LandingView.tsx', import.meta.url), 'utf8');
  assert.ok(landing.includes('t("Shorts.")'));
});

test('setup explains account creation without claiming the npm server has no authentication', async () => {
  assert.equal(Object.hasOwn(publicMessages, 'Virelo does not include accounts or authentication. Do not expose this address directly to the public internet.'), false);
  const setup = await readFile(new URL('../web/src/views/SetupGuideView.tsx', import.meta.url), 'utf8');
  for (const message of [
    'On first launch in Virelo 0.4+, open localhost on the device running Virelo to create the administrator account. Add other users in Account Manager.',
    'Virelo 0.4+ requires sign-in. Older versions have no authentication. Use a trusted network and never expose Virelo directly to the public internet.'
  ]) {
    assert.ok(setup.includes('t(' + JSON.stringify(message) + ')'));
    for (const locale of ['ja', 'ko', 'zh-CN']) assert.notEqual(t(locale, message), message);
  }
});

test('CLI requirements stay patched and consistent across locales, hosting and static product facts', async () => {
  const requirements = 'Node.js 22.23.4+, 24.22.1+ or 26.12.1+ within those release lines';
  const landingMessage = `Requires ${requirements}. Windows, macOS, Linux and Android via Termux. Network access is opt-in; don’t expose Virelo directly to the public internet.`;
  for (const locale of ['en', 'ja', 'ko', 'zh-CN']) {
    for (const message of [requirements, landingMessage]) {
      if (locale !== 'en') assert.notEqual(t(locale, message), message, locale);
      for (const version of ['22.23.4', '24.22.1', '26.12.1']) assert.ok(t(locale, message).includes(version), locale);
    }
  }
  const read = file => readFile(new URL('../' + file, import.meta.url), 'utf8');
  assert.ok((await read('web/src/views/LandingView.tsx')).includes(JSON.stringify(landingMessage)));
  assert.ok((await read('web/src/views/SetupGuideView.tsx')).includes(JSON.stringify(requirements)));
  for (const file of ['README.md', 'CONTRIBUTING.md', 'SECURITY.md', 'web/index.html', 'web/public/llms-full.txt']) {
    const text = await read(file);
    for (const version of ['22.23.4', '24.22.1', '26.12.1']) assert.ok(text.includes(version), file);
    assert.doesNotMatch(text, /22\.16|22\.22\.3/, file);
  }
  const metadata = JSON.parse(await read('package.json'));
  const lock = JSON.parse(await read('package-lock.json'));
  assert.equal(metadata.engines.node, '^22.23.4 || ^24.22.1 || ^26.12.1');
  assert.equal(lock.packages[''].engines.node, metadata.engines.node);
  assert.equal((await read('.node-version')).trim(), '22.23.4');
});
