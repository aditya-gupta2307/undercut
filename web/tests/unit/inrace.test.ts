import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRaceTiming } from '../../src/model/raceTiming';
import { inRaceWinProbability, paceEstimates } from '../../src/model/inrace';
import type { Compound, Lap, PitStop, RaceControlMessage, Stint } from '../../src/data/types';

/** Laps from per-car lap times (index 0 is lap 1), with cars a few tenths apart on the grid. */
function lapsFrom(times: Map<number, number[]>, pits: readonly PitStop[]): Lap[] {
  const laps: Lap[] = [];
  let slot = 0;
  for (const [d, ms] of times) {
    let t = 1_000_000 + slot++ * 300;
    ms.forEach((x, i) => {
      const pitOutLap = pits.some((p) => p.driverNumber === d && p.lap === i);
      laps.push({ driverNumber: d, lap: i + 1, start: t, durationMs: x, s1Ms: null, s2Ms: null, s3Ms: null, pitOutLap, speedTrap: 300 });
      t += x;
    });
  }
  return laps;
}

/** One stop per car: `first` tyres until the stop, `second` after it. */
function stintsFor(cars: readonly number[], pits: readonly PitStop[], total: number, first: Compound, second: Compound): Stint[] {
  return cars.flatMap((d) => {
    const s = pits.find((p) => p.driverNumber === d)?.lap;
    if (s === undefined) return [{ driverNumber: d, stint: 1, compound: first, lapStart: 1, lapEnd: total, tyreAgeAtStart: 0 }];
    return [
      { driverNumber: d, stint: 1, compound: first, lapStart: 1, lapEnd: s, tyreAgeAtStart: 0 },
      { driverNumber: d, stint: 2, compound: second, lapStart: s + 1, lapEnd: total, tyreAgeAtStart: 0 },
    ];
  });
}

const stop = (driverNumber: number, lap: number): PitStop => ({ driverNumber, lap, at: 0, laneMs: 22000, stopMs: 2400 });

test('in-race pace: a drying track does not make the early stopper look quick', () => {
  // The track dries from lap 9 to 14. Car 9 is 1.5 s a lap slower than car 1 throughout, but
  // stopped early, so its recent laps fall on a faster track than everyone else's.
  const total = 22;
  const field = (k: number) => (k <= 8 ? 112000 : k <= 14 ? 112000 - (k - 8) * 1700 : 101800);
  const offsets = new Map([[1, 0], [2, 300], [3, 500], [4, 700], [5, 900], [9, 1500]]);
  const pits = [...offsets.keys()].map((d) => stop(d, d === 9 ? 5 : 10));
  const times = new Map<number, number[]>();
  for (const [d, off] of offsets) {
    const s = pits.find((p) => p.driverNumber === d)!.lap;
    times.set(d, Array.from({ length: total }, (_, i) => field(i + 1) + off + (i === 0 ? 3000 : 0) + (i + 1 === s ? 1000 : 0) + (i === s ? 21000 : 0)));
  }
  const timing = buildRaceTiming(lapsFrom(times, pits), pits, []);
  const cars = [...offsets.keys()];
  const input = { timing, stints: stintsFor(cars, pits, total, 'INTERMEDIATE', 'MEDIUM'), pits, gridOrder: cars };
  for (let L = 6; L <= 20; L++) {
    const pace = paceEstimates(input, L, cars);
    const gap = pace.get(9)! - pace.get(1)!;
    assert.ok(gap > 500 && gap < 1600, `lap ${L}: car 9 is ${gap.toFixed(0)} ms a lap off car 1`);
  }
});

test('in-race model: a car crossing the line in the pit lane is charged the rest of its stop', () => {
  // A wet race, so no stop is mandatory. Car 1 leads by a pit stop's worth and pits on lap 14;
  // its in-lap is quick and nearly all of the loss lands on the out-lap.
  const total = 25;
  const offsets = new Map([[1, 0], [2, 100], [3, 600], [4, 800]]);
  const pits = [stop(1, 14), stop(2, 8), stop(3, 9), stop(4, 9)];
  const times = new Map<number, number[]>();
  for (const [d, off] of offsets) {
    const s = pits.find((p) => p.driverNumber === d)!.lap;
    times.set(d, Array.from({ length: total }, (_, i) => 100000 + off + (i === 0 ? 3000 : 0) + (i + 1 === s ? 1000 : 0) + (i === s ? 21000 : 0)));
  }
  const timing = buildRaceTiming(lapsFrom(times, pits), pits, []);
  const cars = [...offsets.keys()];
  const out = inRaceWinProbability({ timing, stints: stintsFor(cars, pits, total, 'INTERMEDIATE', 'MEDIUM'), pits, gridOrder: cars, sims: 2000 });
  const a = out.pWin.get(1)!;
  assert.ok(a[14]! < 0.85, `in the pit lane on lap 14 the leader got ${a[14]}`);
  assert.ok(Math.abs(a[14]! - a[15]!) < 0.15, `lap 14 ${a[14]} vs after the stop ${a[15]}`);
});

test('in-race model: a leader with no recent clean laps keeps its real pace at a restart', () => {
  // Car 1 pits on lap 30, a lap the rest of the field ran slowly under yellow flags; lap 31 is
  // slower still and a safety car runs until lap 38. At the restart car 1 leads car 2 by 0.9 s
  // with three laps to go and is a tenth a lap quicker.
  const total = 42;
  const cars = [1, 2, 3, 4, 5, 6];
  const off = new Map(cars.map((d, i) => [d, [0, 100, 400, 600, 800, 1000][i]!]));
  const pits = [stop(1, 30), stop(2, 34)];
  const times = new Map<number, number[]>();
  for (const d of cars) {
    const o = off.get(d)!;
    const xs: number[] = [];
    for (let k = 1; k <= 31; k++) {
      let x = 100000 + o + (k === 1 ? 3000 : 0);
      if (k === 30) x = d === 1 ? 101000 + o : d === 2 ? 103100 : 128000;
      if (k === 31) x = 140000 + (d === 1 ? 21000 : 0);
      xs.push(x);
    }
    times.set(d, xs);
  }
  // Line the field up behind the safety car: car d crosses the end of lap 38 at T + (d - 1) × 0.9 s.
  const end31 = (d: number) => 1_000_000 + (d - 1) * 300 + times.get(d)!.reduce((a, b) => a + b, 0);
  const T = Math.max(...cars.map(end31)) + 7 * 130000;
  for (const d of cars) {
    const xs = times.get(d)!;
    const sc = (T + (d - 1) * 900 - end31(d)) / 7;
    for (let k = 32; k <= 38; k++) xs.push(sc);
    xs.push(102000 + off.get(d)!);
    for (let k = 40; k <= total; k++) xs.push(100000 + off.get(d)!);
  }
  const rc: RaceControlMessage[] = [
    { at: 0, lap: 32, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR DEPLOYED' },
    { at: 0, lap: 38, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR IN THIS LAP' },
  ];
  const timing = buildRaceTiming(lapsFrom(times, pits), pits, rc);
  const out = inRaceWinProbability({ timing, stints: stintsFor(cars, pits, total, 'MEDIUM', 'HARD'), pits, gridOrder: cars, sims: 2000 });
  const a = out.pWin.get(1)!;
  assert.ok(a[39]! > 0.6, `leader at the restart: ${a[39]}`);
  assert.ok(a[40]! > 0.6 && a[41]! > 0.6);
});
