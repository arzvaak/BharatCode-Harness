import test from 'node:test';
import assert from 'node:assert/strict';
import { diagramScaleBounds } from '../src/viewport.js';

test('wide diagrams can reach native size even in narrow panes', () => {
  const bounds = diagramScaleBounds(5560, 180, 320);
  assert.equal(bounds.fit, 1);
  assert.ok(320 * bounds.max >= 5560);
});

test('Fit contains tall diagrams in both viewport dimensions', () => {
  const bounds = diagramScaleBounds(240, 4000, 320);
  assert.ok(4000 * 320 / 240 * bounds.fit <= 580);
  assert.ok(320 * bounds.fit <= 320);
});
