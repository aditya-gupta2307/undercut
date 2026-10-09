import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRaceTiming } from '../../src/model/raceTiming';
import { buildReplay, carStateAt, compoundAt, fastestLapAt, leaderLapAt, statusAt, towerAt, trackStatusTimeline, PIT_FRAC } from '../../src/model/replay';
import type { SessionResultRow } from '../../src/data/types';
import { synthRace, type SynthRaceSpec } from './raceHelpers';

const spec: SynthRaceSpec = {
  laps: 40,
  start: Date.UTC(2026, 9, 11, 12),
  drivers: [
    { number: 1, base: 90_000, plan: [{ compound: 'MEDIUM', laps: 18 }, { compound: 'HARD', laps: 22 }] },
    { number: 4, base: 90_300, plan: [{ compound: 'SOFT', laps: 12 }, { compound: 'HARD', laps: 28 }] },
    { number: 16, base: 90_500, plan: [{ compound: 'MEDIUM', laps: 20 }, { compound: 'HARD', laps: 20 }] },
    { number: 44, base: 90_700, plan: [{ compound: 'HARD', laps: 25 }, { compound: 'MEDIUM', laps: 15 }] },
    { number: 63, base: 91_000, plan: [{ compound: 'SOFT', laps: 10 }, { compound: 'MEDIUM', laps: 15 }, { compound: 'HARD', laps: 15 }] },
  ],
  offset: { SOFT: -700, MEDIUM: 0, HARD: 450 },
  deg: { SOFT: 90, MEDIUM: 50, HARD: 25 },
  fuelPerLap: -55,
  pitLossMs: 21_000,
  noiseMs: 150,
  scLaps: [20, 21],
  scLapMs: 125_000,
  seed: 11,
};

function setup() {
  const race = synthRace(spec);
  const timing = buildRaceTiming(race.laps, race.pits, race.raceControl);
  const result: SessionResultRow[] = race.finishOrder.map((d, i) => ({
    driverNumber: d,
    position: i + 1,
    laps: 40,
    points: null,
    dnf: false,
    dns: false,
    dsq: false,
    durationMs: null,
    gapMs: null,
    lapsDown: 0,
  }));
  const gridOrder = [1, 4, 16, 44, 63];
  const model = buildReplay({ timing, laps: race.laps, pits: race.pits, raceControl: race.raceControl, gridOrder, result });
  return { race, timing, model, gridOrder };
}

test('replay keyframes run forward in time and distance', () => {
  const { model } = setup();
  assert.equal(model.cars.size, 5);
  for (const car of model.cars.values()) {
    for (let i = 1; i < car.t.length; i++) {
      assert.ok(car.t[i]! > car.t[i - 1]!, `time goes backwards for ${car.driver}`);
      assert.ok(car.p[i]! >= car.p[i - 1]!, `distance goes backwards for ${car.driver}`);
    }
    assert.ok(car.finishedAt !== null, `car ${car.driver} should finish`);
  }
});

test('a car is exactly on the line at each of its crossings', () => {
  const { model, timing } = setup();
  for (const d of [1, 44]) {
    const car = model.cars.get(d)!;
    for (const L of [3, 15, 30]) {
      const at = timing.crossing.get(d)![L]!;
      const s = carStateAt(car, at);
      assert.ok(Math.abs(s.progress - L) < 1e-9, `car ${d} lap ${L}: ${s.progress}`);
    }
  }
});

test('pit stops put the car in the pit lane around the line', () => {
  const { model, race, timing } = setup();
  const stop = race.pits.find((p) => p.driverNumber === 63)!;
  const car = model.cars.get(63)!;
  assert.ok(car.pitWindows.length >= 2);
  const atLine = timing.crossing.get(63)![stop.lap]!;
  const s = carStateAt(car, atLine);
  assert.equal(s.phase, 'pit');
  // The pit window spans the line, with progress inside ±PIT_FRAC of it.
  const [a, b] = car.pitWindows[0]!;
  assert.ok(a < atLine && atLine < b);
  assert.ok(carStateAt(car, a + 1).progress >= stop.lap - PIT_FRAC - 1e-9);
  assert.ok(carStateAt(car, b - 1).progress <= stop.lap + PIT_FRAC + 1e-9);
});

test('the grid comes first, then the race order, then the classification', () => {
  const { model, timing, race, gridOrder } = setup();
  const before = towerAt(model, timing, model.start - 5_000, race.finishOrder);
  assert.deepEqual(
    before.map((r) => r.driver),
    gridOrder,
  );
  assert.ok(before.every((r) => r.phase === 'grid' && r.visible));
  const after = towerAt(model, timing, model.end - 1, race.finishOrder);
  assert.deepEqual(
    after.map((r) => r.driver),
    race.finishOrder,
  );
  assert.ok(after.every((r) => r.phase === 'finished'));
  assert.equal(after[0]!.gapMs, null);
  for (const r of after.slice(1)) assert.ok(r.gapMs !== null && r.gapMs > 0);
});

test('mid-race gaps agree with the running order and are never negative', () => {
  const { model, timing, race } = setup();
  for (const L of [5, 12, 33]) {
    const t = Math.max(...timing.drivers.map((d) => timing.crossing.get(d)![L]!)) + 1;
    const rows = towerAt(model, timing, t, race.finishOrder);
    assert.equal(rows[0]!.gapMs, null);
    for (const r of rows.slice(1)) {
      assert.ok(r.gapMs !== null && r.gapMs >= 0, `lap ${L}: ${r.driver} gap ${r.gapMs}`);
      assert.ok(r.intervalMs === null || r.intervalMs >= 0);
      assert.equal(r.lapsDown, 0);
    }
  }
  // Mid-lap and mid-pit-cycle too: sample every 5 seconds of the race. Gaps never go
  // negative and never decrease down the running order.
  for (let t = model.start; t < model.end; t += 5_000) {
    const rows = towerAt(model, timing, t, race.finishOrder);
    for (const r of rows) {
      assert.ok(r.gapMs === null || (Number.isFinite(r.gapMs) && r.gapMs >= 0), `t=${t}: ${r.driver} gap ${r.gapMs}`);
    }
    const racing = rows.filter((r) => r.phase === 'running' || r.phase === 'pit');
    for (let i = 1; i < racing.length; i++) {
      if (racing[i - 1]!.position === 1) continue;
      assert.ok(racing[i]!.gapMs! >= racing[i - 1]!.gapMs! - 1e-6, `t=${t}: P${racing[i]!.position} ${racing[i]!.gapMs} < P${racing[i - 1]!.position} ${racing[i - 1]!.gapMs}`);
    }
  }
});

test('fastest lap so far, leader lap counter and tyre lookup', () => {
  const { model, timing, race } = setup();
  const best = fastestLapAt(model, model.end);
  assert.ok(best);
  const all = model.lapLog.map((l) => l.ms);
  assert.equal(best!.ms, Math.min(...all));
  assert.equal(fastestLapAt(model, model.start - 1), null);
  assert.equal(leaderLapAt(model, model.start - 1), 0);
  assert.equal(leaderLapAt(model, model.start + 1), 1);
  assert.equal(leaderLapAt(model, model.end), 40);
  const lead10 = Math.min(...timing.drivers.map((d) => timing.crossing.get(d)![10]!));
  assert.equal(leaderLapAt(model, lead10 + 1), 11);
  assert.equal(compoundAt(race.stints, 63, 5)!.compound, 'SOFT');
  assert.equal(compoundAt(race.stints, 63, 11)!.compound, 'MEDIUM');
  assert.equal(compoundAt(race.stints, 63, 40)!.compound, 'HARD');
});

test('track status follows race control, and the safety car ends at the line', () => {
  const leader = [0, 100, 200, 300, 400, 500];
  const msg = (at: number, message: string, flag: string | null = null) => ({ at, lap: null, category: 'Other', flag, scope: 'Track', sector: null, driverNumber: null, message });
  const timeline = trackStatusTimeline(
    [msg(150, 'SAFETY CAR DEPLOYED'), msg(320, 'SAFETY CAR IN THIS LAP'), msg(410, 'VIRTUAL SAFETY CAR DEPLOYED'), msg(450, 'VIRTUAL SAFETY CAR ENDING')],
    leader,
    0,
    600,
  );
  const m = { status: timeline, leaderCrossing: leader, totalLaps: 5 } as unknown as Parameters<typeof statusAt>[0];
  assert.equal(statusAt(m, 100), 'GREEN');
  assert.equal(statusAt(m, 200), 'SC');
  assert.equal(statusAt(m, 350), 'SC');
  assert.equal(statusAt(m, 401), 'GREEN');
  assert.equal(statusAt(m, 420), 'VSC');
  assert.equal(statusAt(m, 460), 'GREEN');
  assert.equal(statusAt(m, 520), 'CHEQUERED');
});

test('a car that retires disappears after its last lap', () => {
  const race = synthRace(spec);
  const cut = race.laps.filter((l) => !(l.driverNumber === 44 && l.lap > 17));
  const timing = buildRaceTiming(cut, race.pits.filter((p) => p.driverNumber !== 44 || p.lap <= 17), race.raceControl);
  const result: SessionResultRow[] = timing.drivers.map((d, i) => ({ driverNumber: d, position: d === 44 ? null : i + 1, laps: d === 44 ? 17 : 40, points: null, dnf: d === 44, dns: false, dsq: false, durationMs: null, gapMs: null, lapsDown: 0 }));
  const model = buildReplay({ timing, laps: cut, pits: race.pits, raceControl: race.raceControl, gridOrder: [1, 4, 16, 44, 63], result });
  const car = model.cars.get(44)!;
  assert.equal(car.finishedAt, null);
  assert.ok(car.retiredAt !== null);
  const last = timing.crossing.get(44)![17]!;
  assert.equal(carStateAt(car, last + 1000).visible, true);
  const gone = carStateAt(car, car.retiredAt! + 1);
  assert.equal(gone.phase, 'out');
  assert.equal(gone.visible, false);
  const rows = towerAt(model, timing, model.end - 1, [1, 4, 16, 63, 44]);
  assert.equal(rows[rows.length - 1]!.driver, 44);
});
