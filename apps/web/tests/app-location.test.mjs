import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppearanceTestModule } from './appearance-test-loader.mjs';
const { appLocationRewrite: rewrite, newAppUrl, publicAppPath } = await loadAppearanceTestModule('utils/app-location.ts');
const { shareLink } = await loadAppearanceTestModule('utils/share.ts');

test('new player root and deep links map to existing internal routes without changing query or hash', () => {
  for (const path of ['/', '/library', '/settings?section=backup', '/watch/42?playlistId=7#time', '/playlists/7']) {
    const external = new URL(path, 'https://app.virelo.dev');
    const internal = rewrite.input({url: new URL(external)});
    assert.equal(internal.pathname, '/app' + (external.pathname === '/' ? '' : external.pathname));
    assert.equal(internal.search + internal.hash, external.search + external.hash);
    assert.equal(rewrite.output({url: internal}).href, external.href);
  }
  assert.equal(publicAppPath('/application'), '/application');
  assert.equal(rewrite.input({url:new URL('https://app.virelo.dev/app/library')}).pathname, '/app/library');
});

test('local and other deployments keep their existing routing', () => {
  for (const origin of ['http://localhost:5173','https://example.org','https://app.virelo.dev.example.org']) {
    assert.equal(rewrite.input({url:new URL('/app/settings',origin)}), undefined);
    assert.equal(rewrite.output({url:new URL('/app/settings',origin)}), undefined);
  }
});

test('migration preserves deep links but cannot redirect to untrusted hosts', () => {
  const next = newAppUrl('https://virelo.riyo.me/app/watch/42?playlistId=7&legacy=1#time');
  assert.equal(next.href,'https://app.virelo.dev/watch/42?playlistId=7#time');
  assert.equal(newAppUrl('https://virelo.riyo.me//evil.example/path').origin,'https://app.virelo.dev');
});

test('Web QR links use the canonical app root, while local and self-hosted links stay unchanged', () => {
  assert.equal(shareLink('https://app.virelo.dev','/watch/1',true),'https://app.virelo.dev/');
  assert.equal(shareLink('https://virelo.riyo.me','/app/watch/1',true),'https://virelo.riyo.me/app');
  assert.equal(shareLink('http://localhost:41777','/watch/1'),'http://localhost:41777/watch/1');
});
