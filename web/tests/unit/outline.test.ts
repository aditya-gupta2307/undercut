import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outlineFromSamples, toOutlineSpace } from '../../src/app/data';

/** Samples along a closed, circuit-like curve, `laps` laps long. */
function samples(laps: number, n = 400): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * laps * i) / n;
    const r = 1 + 0.25 * Math.cos(2 * t) + 0.1 * Math.sin(3 * t);
    out.push({ x: 5000 * r * Math.cos(t), y: 3000 * r * Math.sin(t) });
  }
  return out;
}

test('a lap and a bit becomes a closed, normalised outline', () => {
  const o = outlineFromSamples(samples(1.1), 9999);
  assert.ok(o);
  assert.equal(o!.width, 1000);
  assert.ok(o!.height > 100 && o!.height < 1000);
  const first = o!.points[0]!;
  const last = o!.points[o!.points.length - 1]!;
  assert.ok(Math.hypot(first[0] - last[0], first[1] - last[1]) < 40, 'the loop closes');
  // Raw coordinates map into the same space as the outline points.
  const [x, y] = toOutlineSpace(o!, samples(1.1)[0]!.x, samples(1.1)[0]!.y);
  assert.ok(Math.abs(x - first[0]) < 1 && Math.abs(y - first[1]) < 1);
});

test('a partial lap is rejected rather than drawn as a broken track', () => {
  assert.equal(outlineFromSamples(samples(0.6, 300), 1), null);
  assert.equal(outlineFromSamples(samples(1.1, 30), 1), null, 'too few samples');
});
