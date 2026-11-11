import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../web/src/utils/video-presentation.ts', import.meta.url), 'utf8');
const { DEFAULT_VIDEO_PRESENTATION: defaults, normalizeVideoPresentation: normalize, videoPresentationStyle: style } =
  await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('default presentation preserves the entire frame without color filtering', () => {
  assert.deepEqual(style(defaults, { width: 1280, height: 720 }), {
    width: '100%', height: '100%', objectFit: 'contain',
    transform: 'translate(-50%, -50%) rotate(0deg)', filter: 'none'
  });
  assert.equal(Object.isFrozen(defaults), true);
});

test('quarter turns swap the layout box before aspect-preserving fit or fill', () => {
  for (const size of [{ width: 1280, height: 720 }, { width: 320, height: 568 }, { width: 1920, height: 1080 }]) {
    for (const rotation of [0, 90, 180, 270]) {
      for (const fit of ['contain', 'cover']) {
        const result = style({ ...defaults, rotation, fit }, size);
        assert.equal(result.objectFit, fit);
        assert.equal(result.width, rotation % 180 ? size.height : '100%');
        assert.equal(result.height, rotation % 180 ? size.width : '100%');
        assert.equal(result.transform, `translate(-50%, -50%) rotate(${rotation}deg)`);
      }
    }
  }
});

test('rotation wraps in both directions and color values stay finite and bounded', () => {
  assert.equal(normalize({ ...defaults, rotation: -90 }).rotation, 270);
  assert.equal(normalize({ ...defaults, rotation: 450 }).rotation, 90);
  assert.equal(normalize({ ...defaults, rotation: 360 }).rotation, 0);
  assert.deepEqual(normalize({ fit: 'invalid', rotation: NaN, brightness: Infinity, contrast: -10, saturation: 300 }), {
    fit: 'contain', rotation: 0, brightness: 100, contrast: 0, saturation: 200
  });
  assert.equal(style({ ...defaults, brightness: 120, contrast: 90, saturation: 75 }, { width: 320, height: 180 }).filter,
    'brightness(120%) contrast(90%) saturate(75%)');
});
