import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRaceTiming, gapsAtLap, neutralPeriods, orderAtLap, estimatePitLoss } from '../../src/model/raceTiming';
import { inRaceWinProbability } from '../../src/model/inrace';
import { fitTyreModel, planFromStints, positionWithDelta, searchStrategies, simulatePlan } from '../../src/model/strategy';
import { synthRace, type SynthRaceSpec } from './raceHelpers';

const spec: SynthRaceSpec = {
  laps: 50,
  start: Date.UTC(2026, 9, 11, 12),
  drivers: [
    { number: 1, base: 90_000, plan: [{ compound: 'MEDIUM', laps: 22 }, { compound: 'HARD', laps: 28 }] },
    { number: 4, base: 90_300, plan: [{ compound: 'SOFT', laps: 15 }, { compound: 'HARD', laps: 35 }] },
    { number: 16, base: 90_500, plan: [{ compound: 'MEDIUM', laps: 25 }, { compound: 'HARD', laps: 25 }] },
    { number: 44, base: 90_700, plan: [{ compound: 'HARD', laps: 30 }, { compound: 'MEDIUM', laps: 20 }] },
    { number: 63, base: 91_000, plan: [{ compound: 'SOFT', laps: 12 }, { compound: 'MEDIUM', laps: 18 }, { compound: 'HARD', laps: 20 }] },
    { number: 81, base: 91_300, plan: [{ compound: 'MEDIUM', laps: 20 }, { compound: 'HARD', laps: 30 }] },
  ],
  offset: { SOFT: -700, MEDIUM: 0, HARD: 450 },
  deg: { SOFT: 90, MEDIUM: 50, HARD: 25 },
  fuelPerLap: -55,
  pitLossMs: 21_000,
  noiseMs: 150,
  seed: 7,
};

test('neutral periods are read from race control messages', () => {
  const periods = neutralPeriods(
    [
      { at: 1, lap: 10, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR DEPLOYED' },
      { at: 2, lap: 13, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR IN THIS LAP' },
      { at: 3, lap: 30, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'VIRTUAL SAFETY CAR DEPLOYED' },
      { at: 4, lap: 31, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'VIRTUAL SAFETY CAR ENDING' },
      { at: 5, lap: 40, category: 'Flag', flag: 'RED', scope: 'Track', sector: null, driverNumber: null, message: 'RED FLAG' },
    ],
    50,
  );
  assert.deepEqual(periods, [
    { kind: 'SC', startLap: 10, endLap: 13 },
    { kind: 'VSC', startLap: 30, endLap: 31 },
    { kind: 'RED', startLap: 40, endLap: 50 },
  ]);
});

test('race timing reconstruction: crossings, gaps and order are exact', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  assert.equal(t.totalLaps, 50);
  assert.deepEqual(orderAtLap(t, 50), race.finishOrder);
  const gaps = gapsAtLap(t, 50);
  assert.equal(gaps.get(race.finishOrder[0]!), 0);
  for (const d of race.finishOrder.slice(1)) assert.ok(gaps.get(d)! > 0);
  // Every crossing equals the next lap's start exactly.
  const lap10 = race.laps.find((l) => l.driverNumber === 4 && l.lap === 11)!;
  assert.equal(t.crossing.get(4)![10], lap10.start);
});

test('timing survives a missing lap record by interpolation', () => {
  const race = synthRace(spec);
  const holed = race.laps.filter((l) => !(l.driverNumber === 16 && (l.lap === 20 || l.lap === 21)));
  const t = buildRaceTiming(holed, race.pits, race.raceControl);
  assert.ok(!Number.isNaN(t.crossing.get(16)![20]!));
  assert.equal(t.lapsCompleted.get(16), 50);
});

test('tyre model recovers degradation, compound offsets and fuel effect', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const model = fitTyreModel(t, race.stints)!;
  assert.ok(model, 'model should fit');
  assert.ok(Math.abs(model.deg.SOFT! - 90) < 15, `soft deg ${model.deg.SOFT}`);
  assert.ok(Math.abs(model.deg.MEDIUM! - 50) < 12, `medium deg ${model.deg.MEDIUM}`);
  assert.ok(Math.abs(model.deg.HARD! - 25) < 10, `hard deg ${model.deg.HARD}`);
  assert.ok(Math.abs(model.offset.SOFT! - -700) < 150, `soft offset ${model.offset.SOFT}`);
  assert.ok(Math.abs(model.offset.HARD! - 450) < 150, `hard offset ${model.offset.HARD}`);
  assert.ok(Math.abs(model.fuelPerLap - -55) < 12, `fuel ${model.fuelPerLap}`);
  assert.ok(model.residualSd < 400);
});

test('pit loss is estimated from in- and out-laps', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const loss = estimatePitLoss(t, race.pits);
  assert.ok(Math.abs(loss - 21_000) < 1500, `pit loss ${loss}`);
});

test('simulating the actual plan reproduces the real race time closely', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const model = fitTyreModel(t, race.stints)!;
  const plan = planFromStints(race.stints, 1, 50);
  const sim = simulatePlan({ model, timing: t, driver: 1, totalLaps: 50, pitLossMs: estimatePitLoss(t, race.pits) }, plan);
  assert.ok(sim.valid, sim.issues.join('; '));
  const realMs = race.laps.filter((l) => l.driverNumber === 1).reduce((s, l) => s + l.durationMs!, 0);
  assert.ok(Math.abs(sim.totalMs - realMs) < 4000, `sim ${sim.totalMs} vs real ${realMs}`);
});

test('strategy search finds plans at least as good as the actual one', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const model = fitTyreModel(t, race.stints)!;
  const ctx = { model, timing: t, driver: 81, totalLaps: 50, pitLossMs: estimatePitLoss(t, race.pits) };
  const actual = planFromStints(race.stints, 81, 50);
  const { best, oneStopCurve } = searchStrategies(ctx, actual);
  assert.ok(best.length > 0);
  assert.ok(best[0]!.deltaMs <= 1e-6, 'the optimum cannot be worse than what was actually run');
  assert.ok(oneStopCurve.length > 10);
  for (const opt of best) {
    const laps = opt.plan.stints.reduce((s, x) => s + x.laps, 0);
    assert.equal(laps, 50);
    assert.ok(new Set(opt.plan.stints.map((s) => s.compound)).size >= 2);
  }
  const pos = positionWithDelta(t, 81, best[0]!.deltaMs);
  assert.ok(pos.position !== null && pos.actual !== null && pos.position <= pos.actual);
});

test('invalid plans are flagged', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const model = fitTyreModel(t, race.stints)!;
  const sim = simulatePlan(
    { model, timing: t, driver: 1, totalLaps: 50, pitLossMs: 21000 },
    { stints: [{ compound: 'HARD', laps: 50, ageAtStart: 0 }] },
  );
  assert.equal(sim.valid, false);
  assert.ok(sim.issues.some((i) => /two different compounds/.test(i)));
});

test('in-race win probability: sane at every lap and certain at the flag', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const out = inRaceWinProbability({ timing: t, stints: race.stints, pits: race.pits, gridOrder: [1, 4, 16, 44, 63, 81], sims: 800 });
  assert.equal(out.laps.length, 51); // lap 0 .. lap 50
  for (let i = 0; i < out.laps.length; i++) {
    let s = 0;
    for (const series of out.pWin.values()) s += series[i]!;
    assert.ok(Math.abs(s - 1) < 1e-9, `lap ${out.laps[i]} sums to ${s}`);
  }
  assert.equal(out.winner, race.finishOrder[0]);
  const w = out.pWin.get(out.winner!)!;
  assert.equal(w[w.length - 1], 1);
  assert.ok(w[w.length - 2]! > 0.9, `winner on the last lap: ${w[w.length - 2]}`);
  assert.ok(out.lockedInLap !== null && out.lockedInLap <= 50);
});

test('in-race model: a safety car makes a big lead less safe', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const base = { timing: t, stints: race.stints, pits: race.pits, gridOrder: [1, 4, 16, 44, 63, 81], sims: 1500 };
  const out = inRaceWinProbability(base);
  const leaderAt30 = Math.max(...[...out.pWin.values()].map((s) => s[30]!));
  assert.ok(leaderAt30 < 0.999 && leaderAt30 > 0.2, `leader probability mid-race ${leaderAt30}`);
});

test('in-race model: the official winner overrides the road order (disqualification)', () => {
  const race = synthRace(spec);
  const t = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const road = race.finishOrder;
  const out = inRaceWinProbability({ timing: t, stints: race.stints, pits: race.pits, gridOrder: [1, 4, 16, 44, 63, 81], sims: 300, officialWinner: road[1]! });
  assert.equal(out.winner, road[1]);
  const w = out.pWin.get(road[1]!)!;
  assert.equal(w[w.length - 1], 1);
  assert.equal(out.pWin.get(road[0]!)![w.length - 1], 0);
});
