import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../src/lib/rng';
import { firstChoiceProbabilities, fitPL, objective, rankingLogProb, type PLEvent, type PLSpec } from '../../src/model/plackettLuce';
import { sampleOrder } from './helpers';

const spec: PLSpec = { nTeams: 3, nDrivers: 6, useCovariate: true, sdTeam: 1.5, sdDriver: 0.6, betaMean: 0.5, sdBeta: 0.8 };

function randomEvents(seed: number, count: number): PLEvent[] {
  const rng = mulberry32(seed);
  const events: PLEvent[] = [];
  for (let e = 0; e < count; e++) {
    const drivers = [0, 1, 2, 3, 4, 5].sort(() => rng() - 0.5).slice(0, 4 + Math.floor(rng() * 3));
    events.push({
      weight: 0.3 + rng(),
      items: drivers.map((d) => ({ team: d >> 1, driver: d, x: -Math.log(1 + Math.floor(rng() * 10)) })),
    });
  }
  return events;
}

test('gradient matches finite differences', () => {
  const events = randomEvents(7, 12);
  const params = Float64Array.from({ length: 10 }, (_, i) => Math.sin(i * 1.7) * 0.6);
  const { grad } = objective(params, events, spec, false);
  const h = 1e-6;
  for (let i = 0; i < params.length; i++) {
    const up = params.slice();
    const dn = params.slice();
    up[i]! += h;
    dn[i]! -= h;
    const fd = (objective(up, events, spec, false).value - objective(dn, events, spec, false).value) / (2 * h);
    assert.ok(Math.abs(fd - grad[i]!) < 1e-5, `param ${i}: analytic ${grad[i]} vs numeric ${fd}`);
  }
});

test('Hessian matches finite differences of the gradient', () => {
  const events = randomEvents(11, 10);
  const params = Float64Array.from({ length: 10 }, (_, i) => Math.cos(i * 0.9) * 0.4);
  const { hess } = objective(params, events, spec, true);
  const h = 1e-5;
  for (let i = 0; i < params.length; i++) {
    const up = params.slice();
    const dn = params.slice();
    up[i]! += h;
    dn[i]! -= h;
    const gu = objective(up, events, spec, false).grad;
    const gd = objective(dn, events, spec, false).grad;
    for (let j = 0; j < params.length; j++) {
      const fd = (gu[j]! - gd[j]!) / (2 * h);
      assert.ok(Math.abs(fd - hess!.get(j, i)) < 1e-4, `H[${j},${i}] analytic ${hess!.get(j, i)} vs numeric ${fd}`);
    }
  }
});

test('Hessian is symmetric', () => {
  const events = randomEvents(3, 8);
  const params = new Float64Array(10).fill(0.1);
  const { hess } = objective(params, events, spec, true);
  for (let i = 0; i < 10; i++) for (let j = 0; j < 10; j++) assert.ok(Math.abs(hess!.get(i, j) - hess!.get(j, i)) < 1e-12);
});

test('objective log-likelihood agrees with the direct ranking probability', () => {
  const s = [1.2, 0.3, -0.4, 0.9];
  // One event, no priors to speak of (huge prior sds), team=driver identity.
  const flat: PLSpec = { nTeams: 4, nDrivers: 4, useCovariate: false, sdTeam: 1e6, sdDriver: 1e6, betaMean: 0, sdBeta: 1 };
  const params = new Float64Array([...s, 0, 0, 0, 0]);
  const ev: PLEvent = { weight: 1, items: [0, 1, 2, 3].map((i) => ({ team: i, driver: i, x: 0 })) };
  const value = objective(params, [ev], flat, false).value;
  assert.ok(Math.abs(-value - rankingLogProb(s)) < 1e-9);
});

test('first-choice probabilities sum to one and favour the strongest', () => {
  const p = firstChoiceProbabilities([0.5, 2, -1]);
  assert.ok(Math.abs(p[0]! + p[1]! + p[2]! - 1) < 1e-12);
  assert.ok(p[1]! > p[0]! && p[0]! > p[2]!);
});

test('fit recovers known strengths from sampled races', () => {
  const rng = mulberry32(2026);
  const trueTeam = [1.5, 0.5, -0.5, -1.5];
  const trueDriver = [0.3, -0.3, 0.2, -0.2, 0.25, -0.25, 0.1, -0.1];
  const n = 8;
  const events: PLEvent[] = [];
  for (let r = 0; r < 400; r++) {
    const s = Array.from({ length: n }, (_, d) => trueTeam[d >> 1]! + trueDriver[d]!);
    const order = sampleOrder(s, rng);
    events.push({ weight: 1, items: order.map((d) => ({ team: d >> 1, driver: d, x: 0 })) });
  }
  const fit = fitPL(events, { nTeams: 4, nDrivers: 8, useCovariate: false, sdTeam: 3, sdDriver: 1, betaMean: 0, sdBeta: 1 });
  assert.ok(fit.converged, 'Newton should converge');
  // Strengths are identified only up to a constant: compare centred totals.
  const est = Array.from({ length: n }, (_, d) => fit.team[d >> 1]! + fit.driver[d]!);
  const tru = Array.from({ length: n }, (_, d) => trueTeam[d >> 1]! + trueDriver[d]!);
  const centre = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    return xs.map((x) => x - m);
  };
  const e = centre(est);
  const t = centre(tru);
  for (let d = 0; d < n; d++) assert.ok(Math.abs(e[d]! - t[d]!) < 0.2, `driver ${d}: est ${e[d]} true ${t[d]}`);
});

test('fit recovers the grid effect β', () => {
  const rng = mulberry32(99);
  const trueBeta = 0.8;
  const n = 10;
  const events: PLEvent[] = [];
  for (let r = 0; r < 500; r++) {
    const grid = Array.from({ length: n }, (_, i) => i + 1).sort(() => rng() - 0.5);
    const s = grid.map((g) => trueBeta * -Math.log(g));
    const order = sampleOrder(s, rng);
    events.push({ weight: 1, items: order.map((d) => ({ team: 0, driver: d, x: -Math.log(grid[d]!) })) });
  }
  const fit = fitPL(events, { nTeams: 1, nDrivers: n, useCovariate: true, sdTeam: 1, sdDriver: 0.3, betaMean: 0, sdBeta: 2 });
  assert.ok(Math.abs(fit.beta - trueBeta) < 0.12, `β estimated ${fit.beta}`);
});

test('covariance is positive on the diagonal and shrinks with more data', () => {
  const mk = (count: number) => {
    const rng = mulberry32(5);
    const events: PLEvent[] = [];
    for (let r = 0; r < count; r++) {
      const order = sampleOrder([1, 0.5, 0, -0.5], rng);
      events.push({ weight: 1, items: order.map((d) => ({ team: d, driver: d, x: 0 })) });
    }
    return fitPL(events, { nTeams: 4, nDrivers: 4, useCovariate: false, sdTeam: 2, sdDriver: 0.5, betaMean: 0, sdBeta: 1 }, { covariance: true });
  };
  const small = mk(10);
  const big = mk(200);
  for (let i = 0; i < 8; i++) {
    assert.ok(small.covariance!.get(i, i) > 0);
    assert.ok(big.covariance!.get(i, i) <= small.covariance!.get(i, i) + 1e-9);
  }
});

test('events with a single finisher are ignored rather than crashing', () => {
  const fit = fitPL([{ weight: 1, items: [{ team: 0, driver: 0, x: 0 }] }], { nTeams: 1, nDrivers: 1, useCovariate: false, sdTeam: 1, sdDriver: 1, betaMean: 0, sdBeta: 1 });
  assert.ok(fit.converged);
  assert.equal(fit.team[0], 0);
});
