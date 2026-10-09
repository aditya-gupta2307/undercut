/**
 * Live win probability, lap by lap.
 *
 * At the end of each lap the race is a set of facts — gaps, tyre histories,
 * stops still owed — plus an unknown future. For every lap this module plays
 * the rest of the race out a few thousand times:
 *
 *   finish time = time so far
 *               + remaining laps × the car's pace
 *               + pace drift (tyres, fuel, strategy: grows with laps left)
 *               + lap-to-lap noise (grows with √laps left)
 *               + any pit stop the car still owes
 *               + the chance of a safety car, which bunches the field up
 *                 and makes a stop cheap
 *               + the chance of retiring
 *
 * and counts who comes out on top. Pace is measured from the car's own
 * recent clean laps, shrunk toward the field's pace (plus its qualifying gap,
 * if known) so that two lucky laps do not make a hero.
 *
 * The chart this feeds is the "swing" chart: the lap the race was decided is
 * the lap where the winner's line jumps.
 */

import { mulberry32, normal, type Rng } from '../lib/rng';
import { median } from '../lib/stats';
import type { PitStop, Stint } from '../data/types';
import { estimatePitLoss, isCleanLap, orderAtLap, stintStateAt, type RaceTiming } from './raceTiming';

export interface InRaceInput {
  timing: RaceTiming;
  stints: readonly Stint[];
  pits: readonly PitStop[];
  /** Car numbers in starting-grid order. */
  gridOrder: readonly number[];
  /** Qualifying lap gap to pole per car (ms), used as a pace prior. */
  qualiGapMs?: ReadonlyMap<number, number>;
  /** Pre-race forecast, used as-is for lap 0 when given. */
  preRace?: ReadonlyMap<number, number>;
  /**
   * The classified winner, when known. The first car across the line is not
   * always it: a disqualification or a time penalty can hand the win to
   * someone else after the flag.
   */
  officialWinner?: number | null;
  /** The winner's lap count; defaults to the most laps anyone completed. */
  totalLaps?: number;
  sims?: number;
  seed?: number;
}

export interface InRaceOutput {
  laps: number[];
  /** pWin.get(car)[i] is the probability at laps[i]. */
  pWin: Map<number, number[]>;
  winner: number | null;
  /** Lap at which the eventual winner's probability rose the most. */
  decisiveLap: number | null;
  /** First lap from which the winner stayed above 50%. */
  lockedInLap: number | null;
}

const LAP_NOISE_MS = 450;
const PACE_DRIFT_MS = 140;
const SC_HAZARD = 0.014;
const DNF_HAZARD = 0.0016;
const SC_SPACING_MS = 900;
const PACE_WINDOW = 10;
const SHRINK_LAPS = 4;

function paceEstimates(input: InRaceInput, L: number, drivers: number[]): Map<number, number> {
  const { timing } = input;
  const own = new Map<number, number[]>();
  const all: number[] = [];
  for (const d of drivers) {
    const xs: number[] = [];
    const dur = timing.lapMs.get(d)!;
    for (let k = Math.max(2, L - PACE_WINDOW + 1); k <= L; k++) if (isCleanLap(timing, d, k)) xs.push(dur[k]!);
    // Drop obvious outliers (a lock-up, traffic) relative to the car's own median.
    const m = median(xs);
    const kept = xs.filter((x) => x < m * 1.04);
    own.set(d, kept);
    all.push(...kept);
  }
  const field = median(all);
  const out = new Map<number, number>();
  for (const d of drivers) {
    const xs = own.get(d)!;
    const prior = (Number.isFinite(field) ? field : 90000) + 0.8 * (input.qualiGapMs?.get(d) ?? 0);
    const n = xs.length;
    const mine = n ? median(xs) : prior;
    out.set(d, (n * mine + SHRINK_LAPS * prior) / (n + SHRINK_LAPS));
  }
  return out;
}

/** Simulate the remainder of the race from the end of lap L. */
function simulateFrom(input: InRaceInput, L: number, total: number, sims: number, rng: Rng, pitLoss: number): Map<number, number> {
  const { timing, stints, pits } = input;
  // Only what was known at the end of lap L: cars that completed it. A car that
  // retires later is still in this list — the model does not peek ahead.
  const running = orderAtLap(timing, L);
  const out = new Map<number, number>();
  if (running.length === 0) return out;
  if (running.length === 1) {
    out.set(running[0]!, 1);
    return out;
  }
  const remaining = total - L;
  const pace = paceEstimates(input, Math.max(L, 2), running);
  const base = running.map((d) => timing.crossing.get(d)![L]!);
  const leaderPace = pace.get(running[0]!)!;
  const owes = running.map((d) => {
    const st = stintStateAt(stints, d, L, pits);
    const wet = st.compoundsUsed.has('INTERMEDIATE') || st.compoundsUsed.has('WET');
    // Dry-race rule: two different dry compounds must be used.
    const mandatory = !wet && st.compoundsUsed.size < 2 && st.compoundsUsed.size > 0 ? 1 : 0;
    // Old tyres with a long way to go may need another set anyway.
    const extra = Math.min(0.85, Math.max(0, (st.tyreAge + remaining - 42) / 25));
    return { mandatory, extra };
  });
  const wins = new Float64Array(running.length);
  const finish = new Float64Array(running.length);

  for (let s = 0; s < sims; s++) {
    // Safety car: at most one in the remaining laps, at a geometric time.
    let scLap = -1;
    for (let k = 1; k <= remaining - 1; k++) {
      if (rng() < SC_HAZARD) {
        scLap = k;
        break;
      }
    }
    let best = Number.POSITIVE_INFINITY;
    let bestIdx = -1;
    // Position at the safety car (for bunching) uses the projected time at that lap.
    const atSc = scLap > 0 ? new Float64Array(running.length) : null;
    for (let i = 0; i < running.length; i++) {
      const d = running[i]!;
      if (rng() < 1 - (1 - DNF_HAZARD) ** remaining) {
        finish[i] = Number.POSITIVE_INFINITY;
        continue;
      }
      const p = pace.get(d)!;
      const drift = normal(rng) * PACE_DRIFT_MS;
      const stops = owes[i]!.mandatory + (rng() < owes[i]!.extra ? 1 : 0);
      if (atSc) {
        // Time at the safety car; a stop that falls after it is taken under it (cheaper).
        atSc[i] = base[i]! + scLap * (p + drift) + normal(rng) * LAP_NOISE_MS * Math.sqrt(scLap);
        finish[i] = stops; // stash the stop count until bunching is applied
      } else {
        finish[i] = base[i]! + remaining * (p + drift) + normal(rng) * LAP_NOISE_MS * Math.sqrt(remaining) + stops * pitLoss;
      }
    }
    if (atSc) {
      // Bunch everyone within a lap of the leader behind the safety car.
      const order = running.map((_, i) => i).filter((i) => Number.isFinite(finish[i]!)).sort((a, b) => atSc[a]! - atSc[b]!);
      const lead = order.length ? atSc[order[0]!]! : 0;
      order.forEach((i, rank) => {
        const lapped = atSc[i]! - lead > leaderPace;
        const bunched = lapped ? atSc[i]! : lead + rank * SC_SPACING_MS;
        const stops = finish[i]!;
        const left = remaining - scLap;
        const p = pace.get(running[i]!)!;
        // Owed stops are taken under the safety car at roughly half the usual cost.
        finish[i] = bunched + left * p + normal(rng) * LAP_NOISE_MS * Math.sqrt(Math.max(1, left)) + stops * pitLoss * 0.5;
      });
    }
    for (let i = 0; i < running.length; i++) {
      if (finish[i]! < best) {
        best = finish[i]!;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) wins[bestIdx]!++;
  }
  running.forEach((d, i) => out.set(d, wins[i]! / sims));
  return out;
}

export function inRaceWinProbability(input: InRaceInput): InRaceOutput {
  const { timing } = input;
  const total = input.totalLaps ?? timing.totalLaps;
  const sims = input.sims ?? 2500;
  const rng = mulberry32(input.seed ?? 0x1a95);
  const pitLoss = estimatePitLoss(timing, input.pits);
  const laps: number[] = [];
  const pWin = new Map<number, number[]>();
  for (const d of timing.drivers) pWin.set(d, []);

  const push = (lap: number, probs: ReadonlyMap<number, number>) => {
    laps.push(lap);
    let z = 0;
    for (const v of probs.values()) z += v;
    for (const d of timing.drivers) pWin.get(d)!.push(z > 0 ? (probs.get(d) ?? 0) / z : 0);
  };

  // Lap 0: the pre-race forecast if we have one, otherwise a grid-order prior.
  if (input.preRace && input.preRace.size) {
    push(0, input.preRace);
  } else {
    const prior = new Map<number, number>();
    input.gridOrder.forEach((d, slot) => prior.set(d, Math.exp(-0.55 * slot)));
    push(0, prior);
  }
  for (let L = 1; L < total; L++) push(L, simulateFrom(input, L, total, sims, rng, pitLoss));

  // The finish: the official winner if we know it, otherwise the first car to complete the distance.
  const finishers = timing.drivers.filter((d) => !Number.isNaN(timing.crossing.get(d)![total] ?? Number.NaN));
  const roadWinner = finishers.length ? finishers.sort((a, b) => timing.crossing.get(a)![total]! - timing.crossing.get(b)![total]!)[0]! : null;
  const official = input.officialWinner ?? null;
  const winner = official !== null && pWin.has(official) ? official : roadWinner;
  if (winner !== null) push(total, new Map([[winner, 1]]));

  let decisiveLap: number | null = null;
  let lockedInLap: number | null = null;
  if (winner !== null) {
    const w = pWin.get(winner)!;
    let bestJump = 0;
    for (let i = 1; i < w.length - 1; i++) {
      const jump = w[i]! - w[i - 1]!;
      if (jump > bestJump) {
        bestJump = jump;
        decisiveLap = laps[i]!;
      }
    }
    for (let i = w.length - 1; i >= 0; i--) {
      if (w[i]! < 0.5) {
        lockedInLap = laps[Math.min(laps.length - 1, i + 1)]!;
        break;
      }
      if (i === 0) lockedInLap = 0;
    }
  }
  return { laps, pWin, winner, decisiveLap, lockedInLap };
}
