/**
 * Reconstructs the shape of a race from OpenF1 lap records: when every car
 * crossed the line on every lap, the gaps that implies, the running order,
 * which laps were neutralised, and which laps are "clean" enough to measure
 * pace on. Everything downstream — the race trace, the position chart, the
 * in-race win probability and the strategy lab — reads from this.
 */

import { median } from '../lib/stats';
import type { Lap, PitStop, RaceControlMessage, SessionResultRow, Stint } from '../data/types';

export interface NeutralPeriod {
  kind: 'SC' | 'VSC' | 'RED';
  startLap: number;
  endLap: number;
}

export interface RaceTiming {
  drivers: number[];
  totalLaps: number;
  /** crossing.get(car)[L] = epoch ms when lap L was completed (index 0 unused); NaN if unknown. */
  crossing: Map<number, Float64Array>;
  /** lapMs.get(car)[L] = duration of lap L in ms; NaN if unknown. */
  lapMs: Map<number, Float64Array>;
  lapsCompleted: Map<number, number>;
  inLaps: Map<number, Set<number>>;
  outLaps: Map<number, Set<number>>;
  neutral: NeutralPeriod[];
  neutralLaps: Set<number>;
}

const SC_START = /^(SAFETY CAR DEPLOYED)/i;
const SC_END = /SAFETY CAR IN THIS LAP|SAFETY CAR ENDING/i;
const VSC_START = /VIRTUAL SAFETY CAR DEPLOYED/i;
const VSC_END = /VIRTUAL SAFETY CAR ENDING/i;

/** Safety car, virtual safety car and red-flag periods, in laps. */
export function neutralPeriods(messages: readonly RaceControlMessage[], totalLaps: number): NeutralPeriod[] {
  const out: NeutralPeriod[] = [];
  let sc: number | null = null;
  let vsc: number | null = null;
  let red: number | null = null;
  const close = (kind: NeutralPeriod['kind'], start: number, end: number) =>
    out.push({ kind, startLap: Math.max(1, start), endLap: Math.max(start, Math.min(totalLaps || end, end)) });

  for (const m of messages) {
    const lap = m.lap ?? 0;
    const text = m.message.toUpperCase();
    if (VSC_START.test(text)) {
      if (vsc === null) vsc = lap;
    } else if (VSC_END.test(text)) {
      if (vsc !== null) close('VSC', vsc, lap);
      vsc = null;
    } else if (SC_START.test(text)) {
      if (sc === null) sc = lap;
    } else if (SC_END.test(text)) {
      if (sc !== null) close('SC', sc, lap);
      sc = null;
    }
    if (m.flag === 'RED' && (m.scope === 'Track' || m.scope === null)) {
      if (red === null) red = lap;
    } else if (red !== null && (m.flag === 'GREEN' || /RESUME|RESTART/i.test(text)) && lap >= red) {
      close('RED', red, lap);
      red = null;
    }
  }
  // Unterminated periods (e.g. a race finishing behind the safety car).
  if (vsc !== null) close('VSC', vsc, totalLaps);
  if (sc !== null) close('SC', sc, totalLaps);
  if (red !== null) close('RED', red, totalLaps);
  return out.sort((a, b) => a.startLap - b.startLap);
}

export function buildRaceTiming(
  laps: readonly Lap[],
  pits: readonly PitStop[],
  raceControl: readonly RaceControlMessage[],
  results?: readonly SessionResultRow[],
): RaceTiming {
  const byDriver = new Map<number, Lap[]>();
  for (const l of laps) {
    const list = byDriver.get(l.driverNumber) ?? [];
    list.push(l);
    byDriver.set(l.driverNumber, list);
  }
  const drivers = [...byDriver.keys()].sort((a, b) => a - b);
  const maxLap = Math.max(0, ...laps.map((l) => l.lap));
  const crossing = new Map<number, Float64Array>();
  const lapMs = new Map<number, Float64Array>();
  const lapsCompleted = new Map<number, number>();
  const resultLaps = new Map((results ?? []).map((r) => [r.driverNumber, r.laps]));

  for (const d of drivers) {
    const list = byDriver.get(d)!.sort((a, b) => a.lap - b.lap);
    const byLap = new Map(list.map((l) => [l.lap, l]));
    const cross = new Float64Array(maxLap + 2).fill(Number.NaN);
    const dur = new Float64Array(maxLap + 2).fill(Number.NaN);
    for (const l of list) {
      if (l.durationMs !== null && l.durationMs > 0) dur[l.lap] = l.durationMs;
      const next = byLap.get(l.lap + 1);
      if (next?.start != null) cross[l.lap] = next.start;
      else if (l.start !== null && l.durationMs !== null) cross[l.lap] = l.start + l.durationMs;
    }
    // A lap that is followed by a known crossing but has no duration can be inferred.
    for (let L = 2; L <= maxLap; L++) {
      if (Number.isNaN(dur[L]!) && !Number.isNaN(cross[L]!) && !Number.isNaN(cross[L - 1]!)) dur[L] = cross[L]! - cross[L - 1]!;
    }
    // Fill isolated holes between two known crossings by linear interpolation.
    let lastKnown = -1;
    for (let L = 1; L <= maxLap; L++) {
      if (Number.isNaN(cross[L]!)) continue;
      if (lastKnown > 0 && L - lastKnown > 1) {
        const a = cross[lastKnown]!;
        const b = cross[L]!;
        for (let k = lastKnown + 1; k < L; k++) cross[k] = a + ((b - a) * (k - lastKnown)) / (L - lastKnown);
      }
      lastKnown = L;
    }
    let completed = lastKnown > 0 ? lastKnown : 0;
    const official = resultLaps.get(d);
    if (official !== undefined && official < completed) completed = official;
    lapsCompleted.set(d, completed);
    for (let L = completed + 1; L < cross.length; L++) cross[L] = Number.NaN;
    crossing.set(d, cross);
    lapMs.set(d, dur);
  }

  const totalLaps = Math.max(0, ...lapsCompleted.values());
  const inLaps = new Map<number, Set<number>>();
  const outLaps = new Map<number, Set<number>>();
  for (const d of drivers) {
    inLaps.set(d, new Set());
    outLaps.set(d, new Set(byDriver.get(d)!.filter((l) => l.pitOutLap).map((l) => l.lap)));
  }
  for (const p of pits) {
    inLaps.get(p.driverNumber)?.add(p.lap);
    outLaps.get(p.driverNumber)?.add(p.lap + 1);
  }

  const neutral = neutralPeriods(raceControl, totalLaps);
  const neutralLaps = new Set<number>();
  for (const n of neutral) for (let L = n.startLap; L <= n.endLap; L++) neutralLaps.add(L);
  // Belt and braces: laps where the whole field was dramatically slow are neutral too.
  const leaderLapTimes: number[] = [];
  for (let L = 2; L <= totalLaps; L++) {
    const t = drivers.map((d) => lapMs.get(d)![L]!).filter((x) => !Number.isNaN(x));
    if (t.length >= 3) leaderLapTimes[L] = median(t);
  }
  const typical = median(leaderLapTimes.filter((x) => x !== undefined && !Number.isNaN(x)));
  if (Number.isFinite(typical)) {
    for (let L = 2; L <= totalLaps; L++) {
      const t = leaderLapTimes[L];
      if (t !== undefined && t > typical * 1.3) neutralLaps.add(L);
    }
  }

  return { drivers, totalLaps, crossing, lapMs, lapsCompleted, inLaps, outLaps, neutral, neutralLaps };
}

/** Gap to the leader on lap L (ms), for drivers who completed lap L. */
export function gapsAtLap(t: RaceTiming, L: number): Map<number, number> {
  const out = new Map<number, number>();
  let best = Number.POSITIVE_INFINITY;
  for (const d of t.drivers) {
    const c = t.crossing.get(d)![L]!;
    if (!Number.isNaN(c) && c < best) best = c;
  }
  if (!Number.isFinite(best)) return out;
  for (const d of t.drivers) {
    const c = t.crossing.get(d)![L]!;
    if (!Number.isNaN(c)) out.set(d, c - best);
  }
  return out;
}

/** Running order at the end of lap L (cars that completed it, in crossing order). */
export function orderAtLap(t: RaceTiming, L: number): number[] {
  return t.drivers
    .filter((d) => !Number.isNaN(t.crossing.get(d)![L]!))
    .sort((a, b) => t.crossing.get(a)![L]! - t.crossing.get(b)![L]!);
}

/** Laps fit for measuring pace: green flag, not lap 1, not an in- or out-lap. */
export function isCleanLap(t: RaceTiming, driver: number, L: number): boolean {
  if (L < 2) return false;
  if (t.neutralLaps.has(L) || t.neutralLaps.has(L - 1)) return false;
  if (t.inLaps.get(driver)?.has(L) || t.outLaps.get(driver)?.has(L)) return false;
  return !Number.isNaN(t.lapMs.get(driver)?.[L] ?? Number.NaN);
}

export interface StintState {
  compoundsUsed: Set<string>;
  currentCompound: string;
  tyreAge: number;
  stops: number;
}

/** Tyre situation of one car at the end of lap L. */
export function stintStateAt(stints: readonly Stint[], driver: number, L: number, pits: readonly PitStop[]): StintState {
  const mine = stints.filter((s) => s.driverNumber === driver && s.lapStart <= Math.max(1, L)).sort((a, b) => a.lapStart - b.lapStart);
  const cur = mine[mine.length - 1];
  const compoundsUsed = new Set(mine.map((s) => s.compound).filter((c) => c !== 'UNKNOWN'));
  return {
    compoundsUsed,
    currentCompound: cur?.compound ?? 'UNKNOWN',
    tyreAge: cur ? cur.tyreAgeAtStart + (L - cur.lapStart + 1) : L,
    stops: pits.filter((p) => p.driverNumber === driver && p.lap <= L).length,
  };
}

/** Typical time lost to a stop at this race: in-lap + out-lap versus two normal laps. */
export function estimatePitLoss(t: RaceTiming, pits: readonly PitStop[]): number {
  const losses: number[] = [];
  for (const p of pits) {
    const d = p.driverNumber;
    if (t.neutralLaps.has(p.lap) || t.neutralLaps.has(p.lap + 1)) continue;
    const dur = t.lapMs.get(d);
    if (!dur) continue;
    const inLap = dur[p.lap]!;
    const outLap = dur[p.lap + 1]!;
    if (Number.isNaN(inLap) || Number.isNaN(outLap)) continue;
    const ref: number[] = [];
    for (let L = p.lap - 6; L <= p.lap + 7; L++) if (L !== p.lap && L !== p.lap + 1 && isCleanLap(t, d, L)) ref.push(dur[L]!);
    if (ref.length < 3) continue;
    const loss = inLap + outLap - 2 * median(ref);
    if (loss > 5000 && loss < 60000) losses.push(loss);
  }
  return losses.length ? median(losses) : 22000;
}
