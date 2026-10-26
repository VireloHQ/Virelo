import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
const source = await readFile(new URL('../web/src/utils/context-menu.ts', import.meta.url), 'utf8');
const { contextMenuPlacement: place, sidePopoverPlacement: submenu } = await import('data:text/javascript;base64,' +
  Buffer.from(stripTypeScriptTypes(source)).toString('base64'));

test('context bubbles and nested settings share curved tails with rounded tips',async()=>{
  const css=await readFile(new URL('../web/src/styles.css',import.meta.url),'utf8');
  const player=await readFile(new URL('../web/src/player-ui.css',import.meta.url),'utf8');
  for(const side of ['left','right']){
    const rule=css.split('\n').find(line=>line.includes('[data-side="'+side+'"]::after'));
    assert.match(rule,/clip-path:path\('/);
    assert.match(rule,/ C/);assert.match(rule,/ Q/);
  }
  assert.doesNotMatch(player,/context-settings-menu[^\n]*clip-path:polygon/);
});

test('context bubbles open to the right of the pointer, flipping left only near the edge', () => {
  const size = { width: 280, height: 200 }, viewport = { width: 1000, height: 800 };
  const right = place({ x: 300, y: 100 }, size, viewport);
  assert.equal(right.side, 'right');
  assert.equal(right.left, 314);
  assert.equal(right.top + right.anchor, 100);
  const left = place({ x: 990, y: 780 }, size, viewport);
  assert.equal(left.side, 'left');
  assert.equal(left.left + left.width, 976);
  assert.ok(left.top + size.height <= viewport.height - 16);
  assert.ok(left.anchor <= size.height - 24);
});

test('submenu placement uses the owning row, not a distant toolbar button', () => {
  const size = { width: 300, height: 450 }, viewport = { width: 1440, height: 900 };
  const row = { left: 320, right: 532, top: 350, bottom: 394 };
  const right = submenu(row, size, viewport);
  assert.equal(right.left, row.right + 14);
  assert.equal(right.top + right.anchor, (row.top + row.bottom) / 2);
  assert.equal(right.side, 'right');
  const edgeRow = { ...row, left: 1100, right: 1312 };
  const left = submenu(edgeRow, size, viewport);
  assert.equal(left.side, 'left');
  assert.equal(left.left + left.width, edgeRow.left - 14);
});

test('small-screen side bubbles stay inside the viewport and scroll tall content', () => {
  for (const viewport of [{ width: 320, height: 240 }, { width: 375, height: 812 }, { width: 844, height: 390 }]) {
    for (const point of [{ x: 0, y: 0 }, { x: viewport.width, y: viewport.height }, { x: viewport.width / 2, y: viewport.height / 2 }]) {
      const size = { width: 300, height: 900 };
      const result = place(point, size, viewport);
      const height = Math.min(size.height, result.maxHeight);
      assert.ok(result.left >= 16 && result.left + result.width <= viewport.width - 16);
      assert.ok(result.top >= 16 && result.top + height <= viewport.height - 16);
      assert.ok(result.anchor >= 24 && result.anchor <= height - 24);
      const tip = result.side === 'right' ? result.left - 10 : result.left + result.width + 10;
      assert.ok(tip >= 0 && tip <= viewport.width);
      assert.ok(result.maxHeight < size.height);
    }
  }
});
