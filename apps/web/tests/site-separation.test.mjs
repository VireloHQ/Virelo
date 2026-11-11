import test from 'node:test';
import assert from 'node:assert/strict';
import {access,readFile} from 'node:fs/promises';
const read = file => readFile(new URL('../'+file,import.meta.url),'utf8');

test('the public player builds without private site files or credentials',async()=>{
  for (const file of ['web/src/views/LandingView.tsx','web/src/views/SetupGuideView.tsx','web/landing.html',
    'dist/landing','dist/og','dist/site-assets','dist/setup.html','dist/sitemap.xml']) {
    await assert.rejects(access(new URL('../'+file,import.meta.url)),{code:'ENOENT'});
  }
  assert.equal(await read('dist/index.html'),await read('dist/app.html'));
  const html = await read('dist/app.html');
  assert.match(html,/name="robots" content="noindex, follow"/);
  assert.doesNotMatch(html,/landing-title|application\/ld\+json|site-assets/);
  assert.match(await read('web/src/router.tsx'),/throw redirect\(\{to:'\/app'\}\)/);
  assert.doesNotMatch(await read('vite.config.ts'),/landing|Virelo-Site|process\.env.*TOKEN/);
});

test('player permissions and public history remain independent of website and branding policy',async()=>{
  assert.equal(JSON.parse(await read('package.json')).license,'AGPL-3.0-only');
  assert.match(await read('README.md'),/Previously granted MIT and AGPL permissions remain unchanged/);
  assert.match(await read('BRANDING.md'),/running or sharing an unmodified player/);
  assert.match(await read('BRANDING.md'),/does not\s+change MIT, AGPL/);
});
