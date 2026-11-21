import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const { chromium } = createRequire(new URL('../apps/web/package.json', import.meta.url))('playwright');
const output = new URL('../docs/images/readme/', import.meta.url);
const screenshots = [
  ['library.webp', 'https://virelo.dev/landing/library-movies-desktop.webp'],
  ['player.webp', 'https://virelo.dev/landing/player-desktop-v2.webp']
];
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.VIRELO_TEST_CHROMIUM });
try {
  const page = await browser.newPage();
  for (const [name, source] of screenshots) {
    const response = await fetch(source, { signal: AbortSignal.timeout(20000) });
    assert.ok(response.ok, `${source}: HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') ?? '', /^image\/webp/);
    const original = Buffer.from(await response.arrayBuffer());
    assert.ok(original.length < 5_000_000, 'Expected a screenshot, not a video');
    const rendered = await page.evaluate(async data => {
      const image = new Image(); image.src = data; await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.beginPath(); ctx.roundRect(0, 0, canvas.width, canvas.height, 28); ctx.clip();
      ctx.drawImage(image, 0, 0);
      const encoded = canvas.toDataURL('image/webp', .94);
      const decoded = new Image(); decoded.src = encoded; await decoded.decode();
      ctx.reset(); ctx.drawImage(decoded, 0, 0);
      const alpha = (x, y) => ctx.getImageData(x, y, 1, 1).data[3];
      return { encoded, width: canvas.width, height: canvas.height,
        corners: [[0, 0], [canvas.width - 1, 0], [0, canvas.height - 1], [canvas.width - 1, canvas.height - 1]].map(([x, y]) => alpha(x, y)),
        center: alpha(canvas.width / 2, canvas.height / 2) };
    }, 'data:image/webp;base64,' + original.toString('base64'));
    assert.deepEqual([rendered.width, rendered.height], [1440, 810]);
    assert.deepEqual(rendered.corners, [0, 0, 0, 0], 'All four corners must stay transparent after encoding');
    assert.equal(rendered.center, 255, 'The product screenshot stays opaque');
    assert.ok(rendered.encoded.startsWith('data:image/webp;base64,'));
    const bytes = Buffer.from(rendered.encoded.split(',')[1], 'base64');
    assert.ok(bytes.length > 1000 && bytes.length < 500_000, 'README screenshot size budget');
    await writeFile(new URL(name, output), bytes);
    console.log(JSON.stringify({ name, source, bytes: bytes.length,
      sourceSha256: createHash('sha256').update(original).digest('hex'),
      sha256: createHash('sha256').update(bytes).digest('hex'), corners: rendered.corners }));
  }
} finally { await browser.close(); }
