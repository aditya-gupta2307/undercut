import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutEndLabels } from '../../src/components/charts/endLabels';

const at = (...ys: number[]) => ys.map((y, i) => ({ id: i, y, ty: y }));

test('end labels: a lone label at the top stays level with its line', () => {
  // A race winner at 100% (the top of the plot) and five cars bunched at 0% (the bottom).
  const out = layoutEndLabels(at(0, 250, 250, 250, 250, 250), 250);
  assert.equal(out[0]!.ty, 0);
  for (const l of out) assert.ok(l.ty >= 0 && l.ty <= 250, `label drawn at ${l.ty}`);
  for (let i = 1; i < out.length; i++) assert.ok(out[i]!.ty - out[i - 1]!.ty >= 13);
});

test('end labels: labels that do not touch stay where they are', () => {
  assert.deepEqual(layoutEndLabels(at(40, 10, 200), 250).map((l) => l.ty), [10, 40, 200]);
});

test('end labels: a crowded group spreads out downwards inside the plot', () => {
  assert.deepEqual(layoutEndLabels(at(100, 101, 102, 103), 250).map((l) => l.ty), [100, 113, 126, 139]);
});
