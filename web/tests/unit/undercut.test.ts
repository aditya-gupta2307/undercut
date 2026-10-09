import { test } from 'node:test';
import assert from 'node:assert/strict';
import { undercutTrace, TRAFFIC_PENALTY } from '../../src/model/undercut';

const base = { gap: 2, fresh: 1.6, wear: 0.1, warmup: 0.6, laps: 1, stopDelta: 0, traffic: false };

test('undercut: one lap of fresh tyres plus the rival’s cold out-lap', () => {
  const t = undercutTrace(base);
  assert.equal(t.length, 3);
  assert.equal(t[0]!.gap, 2);
  // Lap 1: gain 1.6 − 0.6 warm-up = 1.0 → 1.0 behind; rival out-lap: −0.6 → 0.4 behind.
  assert.ok(Math.abs(t[1]!.gap - 1.0) < 1e-9);
  assert.ok(Math.abs(t[2]!.gap - 0.4) < 1e-9);
});

test('undercut: more laps on new tyres, growing wear, traffic and slow stops', () => {
  const longer = undercutTrace({ ...base, laps: 3 });
  // Gains: 1.0, 1.7, 1.8, then 0.6 → 2 − 5.1 = −3.1 (ahead).
  assert.ok(Math.abs(longer[longer.length - 1]!.gap + 3.1) < 1e-9);
  const traffic = undercutTrace({ ...base, traffic: true });
  assert.ok(Math.abs(traffic[traffic.length - 1]!.gap - (0.4 + TRAFFIC_PENALTY)) < 1e-9);
  const slowStop = undercutTrace({ ...base, stopDelta: 0.5 });
  assert.ok(Math.abs(slowStop[slowStop.length - 1]!.gap - 0.9) < 1e-9);
});
