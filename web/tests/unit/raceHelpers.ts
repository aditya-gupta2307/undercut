/**
 * Synthetic OpenF1-shaped race data with known physics: per-driver base pace,
 * compound offsets, linear tyre degradation and a fuel effect. Lets the tests
 * check that the tyre model recovers the truth and that the timing
 * reconstruction is exact.
 */

import { mulberry32, normal } from '../../src/lib/rng';
import type { Compound, Lap, PitStop, RaceControlMessage, Stint } from '../../src/data/types';

export interface SynthRaceSpec {
  laps: number;
  start: number;
  drivers: { number: number; base: number; plan: { compound: Compound; laps: number }[] }[];
  offset: Partial<Record<Compound, number>>;
  deg: Partial<Record<Compound, number>>;
  fuelPerLap: number;
  pitLossMs: number;
  noiseMs: number;
  /** Laps under safety car: everyone runs this lap time. */
  scLaps?: number[];
  scLapMs?: number;
  seed?: number;
}

export interface SynthRace {
  laps: Lap[];
  stints: Stint[];
  pits: PitStop[];
  raceControl: RaceControlMessage[];
  finishOrder: number[];
}

export function synthRace(spec: SynthRaceSpec): SynthRace {
  const rng = mulberry32(spec.seed ?? 42);
  const laps: Lap[] = [];
  const stints: Stint[] = [];
  const pits: PitStop[] = [];
  const finishTimes: { d: number; t: number }[] = [];
  const sc = new Set(spec.scLaps ?? []);

  for (const drv of spec.drivers) {
    let t = spec.start + 400 * (drv.number % 7); // staggered grid
    let lap = 1;
    drv.plan.forEach((st, si) => {
      stints.push({ driverNumber: drv.number, stint: si + 1, compound: st.compound, lapStart: lap, lapEnd: lap + st.laps - 1, tyreAgeAtStart: 0 });
      for (let k = 0; k < st.laps; k++, lap++) {
        let ms = drv.base + (spec.offset[st.compound] ?? 0) + (spec.deg[st.compound] ?? 0) * k + spec.fuelPerLap * lap + normal(rng) * spec.noiseMs;
        if (lap === 1) ms += 3000;
        if (sc.has(lap)) ms = spec.scLapMs ?? 130_000;
        const isLastOfStint = k === st.laps - 1 && si < drv.plan.length - 1;
        if (isLastOfStint) ms += spec.pitLossMs * 0.5; // in-lap half of the loss
        if (k === 0 && si > 0) ms += spec.pitLossMs * 0.5; // out-lap other half
        laps.push({
          driverNumber: drv.number,
          lap,
          start: Math.round(t),
          durationMs: Math.round(ms),
          s1Ms: null,
          s2Ms: null,
          s3Ms: null,
          pitOutLap: k === 0 && si > 0,
          speedTrap: 300,
        });
        if (isLastOfStint) pits.push({ driverNumber: drv.number, lap, at: Math.round(t + ms), laneMs: 22000, stopMs: 2400 });
        t += ms;
      }
    });
    finishTimes.push({ d: drv.number, t });
  }
  const raceControl: RaceControlMessage[] = [];
  if (spec.scLaps?.length) {
    const first = Math.min(...spec.scLaps);
    const last = Math.max(...spec.scLaps);
    raceControl.push({ at: spec.start + first * 90000, lap: first, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR DEPLOYED' });
    raceControl.push({ at: spec.start + last * 90000, lap: last, category: 'SafetyCar', flag: null, scope: 'Track', sector: null, driverNumber: null, message: 'SAFETY CAR IN THIS LAP' });
  }
  return { laps, stints, pits, raceControl, finishOrder: finishTimes.sort((a, b) => a.t - b.t).map((x) => x.d) };
}
