import { test } from 'node:test';
import assert from 'node:assert/strict';
import { modelPodium, scorePodium } from '../../src/model/picks';
import type { DriverForecast } from '../../src/model/forecast';

test('podium scoring: exact, wrong slot, perfect bonus', () => {
  const actual = ['a', 'b', 'c', 'd'];
  assert.equal(scorePodium(['a', 'b', 'c'], actual), 40);
  assert.equal(scorePodium(['b', 'a', 'c'], actual), 4 + 4 + 10);
  assert.equal(scorePodium(['d', 'e', 'f'], actual), 0);
  assert.equal(scorePodium(['a', 'd', 'b'], actual), 10 + 0 + 4);
});

test('model podium is greedy by position probability and never repeats a driver', () => {
  const f = (id: string, probs: number[]): DriverForecast => ({ driverId: id, teamId: 't', pWin: probs[0]!, pPodium: 0, pPoints: 0, pDnf: 0, pPole: null, expectedFinish: 0, positionProbs: probs });
  const podium = modelPodium([f('x', [0.5, 0.3, 0.1]), f('y', [0.4, 0.35, 0.15]), f('z', [0.1, 0.2, 0.5])]);
  assert.deepEqual(podium, ['x', 'y', 'z']);
});
