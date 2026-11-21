import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';

const root = new URL('../../../', import.meta.url);
const readme = await readFile(new URL('README.md', root), 'utf8');

test('README uses bundled artwork and GitHub-compatible markup with usable destinations', async () => {
  assert.doesNotMatch(readme, /<style|\bstyle=|virelo\.riyo\.me/);
  const images = [...readme.matchAll(/<img\b[^>]*>/g)].map(match => match[0]);
  assert.equal(images.length, 5);
  for (const image of images) {
    const path = image.match(/\bsrc="([^"]+)"/)?.[1];
    assert.ok(path && !path.includes('..') && !path.includes('://'), 'Images must not depend on an external image host');
    assert.match(image, /\balt="[^"]*"/);
    await access(new URL(path, root));
  }
  for (const url of ['https://app.virelo.dev/', 'https://virelo.dev/setup', 'https://github.com/VireloHQ/Virelo/issues', 'https://github.com/VireloHQ/Virelo/discussions']) assert.ok(readme.includes(url));
  assert.ok(readme.includes('npx virelo --here') && readme.includes('localhost') && readme.includes('Self-hosted demo library'));
});

test('README screenshots carry transparency and stay within their size budget', async () => {
  for (const name of ['library.webp', 'player.webp']) {
    const image = await readFile(new URL('docs/images/readme/' + name, root));
    assert.equal(image.toString('ascii', 0, 4), 'RIFF');
    assert.equal(image.toString('ascii', 8, 12), 'WEBP');
    assert.equal(image.toString('ascii', 12, 16), 'VP8X');
    assert.ok(image[20] & 0x10, 'Rounded corners need a real alpha channel, not stripped README CSS');
    assert.ok(image.length > 1000 && image.length < 500_000);
  }
});

test('README action images have rounded backgrounds and no active or remote content', async () => {
  for (const name of ['open-browser.svg', 'self-host.svg']) {
    const svg = await readFile(new URL('docs/images/readme/' + name, root), 'utf8');
    assert.match(svg, /<rect[^>]+rx="1[12](?:\.5)?"/);
    assert.doesNotMatch(svg, /<script|foreignObject|<image|\bon\w+=|\bhref=/i);
  }
});
