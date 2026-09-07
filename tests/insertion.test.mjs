// SPDX-License-Identifier: MPL-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectionSlot, rowSlot } from '../extension/ui/insertion.js';
const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
test('one gap produces one centred bar from either side and spans unequal card heights', () => {
  const items = [
    { id: 'a', rect: rect(100, 100, 300, 180) },
    { id: 'b', rect: rect(428, 100, 300, 510) },
  ];
  const a = collectionSlot(items, 'a', { x: 399, y: 120 }),
    b = collectionSlot(items, 'b', { x: 429, y: 120 });
  assert.deepEqual(a, b);
  assert.deepEqual(a, { beforeId: 'b', left: 413, top: 100, width: 2, height: 510 });
});
test('wrapped grid boundary always belongs before the next row rather than two row edges', () => {
  const items = [
    { id: 'a', rect: rect(428, 100, 300, 80) },
    { id: 'b', rect: rect(100, 210, 300, 240) },
  ];
  assert.deepEqual(
    collectionSlot(items, 'a', { x: 700, y: 120 }),
    collectionSlot(items, 'b', { x: 101, y: 230 }),
  );
  assert.equal(collectionSlot(items, 'b', { x: 101, y: 230 }).left, 85);
});
test('list insertion centres a horizontal bar in the vertical gap', () => {
  const items = [
    { id: 'a', rect: rect(100, 100, 480, 130) },
    { id: 'b', rect: rect(100, 260, 480, 30) },
  ];
  const a = collectionSlot(items, 'a', { x: 200, y: 229 }, { list: true }),
    b = collectionSlot(items, 'b', { x: 200, y: 261 }, { list: true });
  assert.deepEqual(a, b);
  assert.deepEqual(a, { beforeId: 'b', left: 100, top: 244, width: 480, height: 2 });
});
test('row insertion stays centred for different heights and indented content widths', () => {
  const a = { getBoundingClientRect: () => rect(24, 60, 280, 40) },
    b = { getBoundingClientRect: () => rect(24, 104, 280, 60) };
  const after = rowSlot([a, b], a, 99),
    before = rowSlot([a, b], b, 105);
  for (const key of ['left', 'top', 'width', 'height', 'next'])
    assert.equal(after[key], before[key]);
  assert.equal(after.top, 101);
  assert.equal(after.width, 280);
  assert(after.after);
  assert(!before.after);
});
