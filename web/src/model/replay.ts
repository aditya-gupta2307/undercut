/**
 * Race replay from lap timing alone.
 *
 * Every car's line crossings are known to the millisecond, so its distance
 * covered ("progress", in laps) is known at those instants. Between crossings
 * the car is assumed to run at an even pace — except on pit laps, where the
 * time lost is put where it is really spent: in the pit lane, which runs
 * alongside the start/finish line. The result is a smooth, faithful replay of
 * the running order that costs no extra data beyond the timing itself.
 */

import { median } from '../lib/stats';
import type { Lap, PitStop, RaceControlMessage, SessionResultRow, Stint } from '../data/types';
import { isCleanLap, type RaceTiming } from './raceTiming';

/** Share of a lap spent in the pit lane on each side of the line. */
export const PIT_FRAC = 0.04;
/** Grid slots are this many laps apart (exaggerated a little so the grid is visible). */
export const GRID_SPACING = 0.0035;
/** Cars stay visible for this long after taking the flag, on a slowing-down lap. */
export const COOL_DOWN_MS = 25_000;

export interface CarTrack {
  driver: number;
  /** Keyframe times (ms, ascending) and progress (laps) at those times. */
  t: Float64Array;
  p: Float64Array;
  gridProgress: number;
  /** Time the car took the chequered flag, or null. */
  finishedAt: number | null;
  /** Time the car is considered out of the race, or null. */
  retiredAt: number | null;
  /** Time intervals spent in the pit lane. */
  pitWindows: [number, number][];
  /** Typical green-flag lap time for this car. */
  refLapMs: number;
  lapsCompleted: number;
}

export type TrackStatus = 'GREEN' | 'SC' | 'VSC' | 'RED' | 'CHEQUERED';

export interface ReplayModel {
  start: number;
  end: number;
  totalLaps: number;
  cars: Map<number, CarTrack>;
  /** Leader crossing time for each lap L (index L; index 0 = start). */
  leaderCrossing: number[];
  status: { at: number; status: TrackStatus }[];
  /** Every completed lap, ordered by the time it was completed. */
  lapLog: { at: number; driver: number; lap: number; ms: number }[];
  /** bestUpTo[i] = index in lapLog of the fastest lap among lapLog[0..i]. */
  bestUpTo: Int32Array;
}

export interface ReplayInput {
  timing: RaceTiming;
  laps: readonly Lap[];
  pits: readonly PitStop[];
  raceControl: readonly RaceControlMessage[];
  /** Car numbers in starting-grid order. */
  gridOrder: readonly number[];
  result: readonly SessionResultRow[];
}

function raceStart(timing: RaceTiming, laps: readonly Lap[], typical: number): number {
  const starts = laps.filter((l) => l.lap === 1 && l.start !== null).map((l) => l.start!);
  if (starts.length >= 3) return median(starts);
  let first = Number.POSITIVE_INFINITY;
  for (const d of timing.drivers) {
    const c = timing.crossing.get(d)![1]!;
    if (!Number.isNaN(c) && c < first) first = c;
  }
  return Number.isFinite(first) ? first - 1.15 * typical : 0;
}

/** Track status transitions from race control, keyed to time. */
export function trackStatusTimeline(messages: readonly RaceControlMessage[], leaderCrossing: readonly number[], start: number, end: number): { at: number; status: TrackStatus }[] {
  const out: { at: number; status: TrackStatus }[] = [{ at: start, status: 'GREEN' }];
  const push = (at: number, status: TrackStatus) => {
    const last = out[out.length - 1]!;
    if (last.status === status) return;
    if (at < last.at) at = last.at;
    out.push({ at, status });
  };
  const nextLeaderCrossing = (after: number): number => {
    for (const c of leaderCrossing) if (Number.isFinite(c) && c > after) return c;
    return after + 60_000;
  };
  let current: TrackStatus = 'GREEN';
  for (const m of [...messages].sort((a, b) => a.at - b.at)) {
    if (m.at < start - 600_000 || m.at > end) continue;
    const text = m.message.toUpperCase();
    if (m.flag === 'RED' && (m.scope === 'Track' || m.scope === null)) current = 'RED';
    else if (/VIRTUAL SAFETY CAR DEPLOYED/.test(text)) current = 'VSC';
    else if (/VIRTUAL SAFETY CAR ENDING/.test(text)) current = 'GREEN';
    else if (/^SAFETY CAR DEPLOYED/.test(text)) current = 'SC';
    else if (/SAFETY CAR IN THIS LAP/.test(text)) {
      // The safety car peels off; racing resumes when the leader reaches the line.
      push(Math.max(m.at, start), 'SC');
      push(nextLeaderCrossing(m.at), 'GREEN');
      current = 'GREEN';
      continue;
    } else if (current === 'RED' && (m.flag === 'GREEN' || /RESUME|RESTART|PIT EXIT OPEN/.test(text))) current = 'GREEN';
    else if (m.flag === 'CHEQUERED') current = 'CHEQUERED';
    else continue;
    push(Math.max(m.at, start), current);
  }
  return out;
}

export function statusAt(model: ReplayModel, t: number): TrackStatus {
  let s: TrackStatus = 'GREEN';
  for (const e of model.status) {
    if (e.at > t) break;
    s = e.status;
  }
  const lastLeader = model.leaderCrossing[model.totalLaps];
  if (lastLeader !== undefined && Number.isFinite(lastLeader) && t >= lastLeader) return 'CHEQUERED';
  return s === 'CHEQUERED' ? 'GREEN' : s;
}

export function buildReplay(input: ReplayInput): ReplayModel {
  const { timing, laps, pits, raceControl, gridOrder, result } = input;
  const allLaps: number[] = [];
  for (const d of timing.drivers) {
    for (let L = 2; L <= (timing.lapsCompleted.get(d) ?? 0); L++) if (isCleanLap(timing, d, L)) allLaps.push(timing.lapMs.get(d)![L]!);
  }
  const typical = allLaps.length ? median(allLaps) : 90_000;
  const start = raceStart(timing, laps, typical);
  const resultBy = new Map(result.map((r) => [r.driverNumber, r]));
  const totalLaps = timing.totalLaps;

  // Leader crossings: for each lap, the earliest anyone completed it.
  const leaderCrossing: number[] = [start];
  for (let L = 1; L <= totalLaps; L++) {
    let best = Number.POSITIVE_INFINITY;
    for (const d of timing.drivers) {
      const c = timing.crossing.get(d)![L]!;
      if (!Number.isNaN(c) && c < best) best = c;
    }
    leaderCrossing.push(Number.isFinite(best) ? best : Number.NaN);
  }
  const chequer = leaderCrossing[totalLaps]!;

  const cars = new Map<number, CarTrack>();
  const drivers = new Set<number>([...timing.drivers, ...gridOrder]);
  for (const d of drivers) {
    const cross = timing.crossing.get(d);
    const lapsDone = timing.lapsCompleted.get(d) ?? 0;
    const slot = gridOrder.indexOf(d);
    const gridProgress = -GRID_SPACING * (slot >= 0 ? slot : gridOrder.length);
    const own: number[] = [];
    if (cross) for (let L = 2; L <= lapsDone; L++) if (isCleanLap(timing, d, L)) own.push(timing.lapMs.get(d)![L]!);
    const refLapMs = own.length >= 3 ? median(own) : typical;

    const kt: number[] = [start];
    const kp: number[] = [gridProgress];
    const crossingAt = (L: number): number => (L === 0 ? start : cross ? cross[L]! : Number.NaN);
    for (let L = 1; L <= lapsDone; L++) {
      const c = crossingAt(L);
      if (Number.isNaN(c) || c <= kt[kt.length - 1]!) continue;
      kt.push(c);
      kp.push(L);
    }

    // Pit stops: move the lost time into the pit lane around the line.
    const pitWindows: [number, number][] = [];
    const extra: [number, number][] = [];
    for (const stop of pits) {
      if (stop.driverNumber !== d) continue;
      const L = stop.lap;
      const a = crossingAt(L - 1);
      const b = crossingAt(L);
      const c = crossingAt(L + 1);
      if ([a, b].some((x) => Number.isNaN(x))) continue;
      let tIn = a + (1 - PIT_FRAC) * refLapMs;
      if (!(tIn > a && tIn < b)) tIn = a + (1 - PIT_FRAC) * (b - a);
      extra.push([tIn, L - PIT_FRAC]);
      let tOut: number;
      if (!Number.isNaN(c)) {
        tOut = c - (1 - PIT_FRAC) * refLapMs;
        if (!(tOut > b && tOut < c)) tOut = b + PIT_FRAC * (c - b);
        extra.push([tOut, L + PIT_FRAC]);
      } else {
        tOut = b + PIT_FRAC * refLapMs; // retired in the pits, or the data stops
      }
      pitWindows.push([tIn, tOut]);
    }
    // Merge extra keyframes, keeping time strictly increasing and progress non-decreasing.
    const merged = kt.map((t, i) => [t, kp[i]!] as [number, number]).concat(extra).sort((x, y) => x[0] - y[0]);
    const T: number[] = [];
    const P: number[] = [];
    for (const [t, p] of merged) {
      if (T.length && t <= T[T.length - 1]!) continue;
      if (P.length && p < P[P.length - 1]!) continue;
      T.push(t);
      P.push(p);
    }

    const r = resultBy.get(d);
    const lastCross = lapsDone > 0 ? crossingAt(lapsDone) : Number.NaN;
    let finishedAt: number | null = null;
    let retiredAt: number | null = null;
    const classifiedFinisher = r ? !r.dnf && !r.dns && !r.dsq && r.position !== null : lapsDone === totalLaps;
    if (r?.dns || (!r && lapsDone === 0)) {
      retiredAt = start;
    } else if (classifiedFinisher && !Number.isNaN(lastCross) && Number.isFinite(chequer) && lastCross >= chequer - 1) {
      finishedAt = lastCross;
    } else if (r?.dsq && !Number.isNaN(lastCross) && Number.isFinite(chequer) && lastCross >= chequer - 1) {
      finishedAt = lastCross; // took the flag, excluded afterwards
    } else {
      // Stopped somewhere after its last crossing: show it running half a lap more.
      const base = Number.isNaN(lastCross) ? start : lastCross;
      retiredAt = base + 0.5 * refLapMs;
      if (T[T.length - 1]! < retiredAt) {
        T.push(retiredAt);
        P.push((Number.isNaN(lastCross) ? 0 : lapsDone) + 0.5);
      }
    }
    cars.set(d, { driver: d, t: Float64Array.from(T), p: Float64Array.from(P), gridProgress, finishedAt, retiredAt, pitWindows, refLapMs, lapsCompleted: lapsDone });
  }

  const finishes = [...cars.values()].map((c) => c.finishedAt ?? c.retiredAt ?? start).filter(Number.isFinite);
  const end = Math.max(Number.isFinite(chequer) ? chequer : start, ...finishes) + COOL_DOWN_MS + 5_000;

  const lapLog: ReplayModel['lapLog'] = [];
  for (const d of timing.drivers) {
    const cross = timing.crossing.get(d)!;
    const dur = timing.lapMs.get(d)!;
    for (let L = 1; L <= (timing.lapsCompleted.get(d) ?? 0); L++) {
      const at = cross[L]!;
      const ms = dur[L]!;
      if (!Number.isNaN(at) && !Number.isNaN(ms) && ms > 0) lapLog.push({ at, driver: d, lap: L, ms });
    }
  }
  lapLog.sort((a, b) => a.at - b.at);
  const bestUpTo = new Int32Array(lapLog.length);
  let best = -1;
  lapLog.forEach((l, i) => {
    if (best < 0 || l.ms < lapLog[best]!.ms) best = i;
    bestUpTo[i] = best;
  });

  return { start, end, totalLaps, cars, leaderCrossing, status: trackStatusTimeline(raceControl, leaderCrossing, start, end), lapLog, bestUpTo };
}

export type CarPhase = 'grid' | 'running' | 'pit' | 'finished' | 'out';

export interface CarState {
  driver: number;
  /** Laps covered (fractional). */
  progress: number;
  phase: CarPhase;
  /** Whether to draw the car on the track. */
  visible: boolean;
}

export function carStateAt(car: CarTrack, t: number): CarState {
  const { t: T, p: P } = car;
  if (t <= T[0]!) return { driver: car.driver, progress: car.gridProgress, phase: 'grid', visible: car.retiredAt === null || car.retiredAt > T[0]! };
  const last = T.length - 1;
  if (t >= T[last]!) {
    const p = P[last]!;
    if (car.finishedAt !== null) {
      const since = t - car.finishedAt;
      const visible = since < COOL_DOWN_MS;
      return { driver: car.driver, progress: p + (Math.max(0, since) / car.refLapMs) * 0.6, phase: 'finished', visible };
    }
    return { driver: car.driver, progress: p, phase: 'out', visible: false };
  }
  // Binary search for the segment containing t.
  let lo = 0;
  let hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (T[mid]! <= t) lo = mid;
    else hi = mid;
  }
  const f = (t - T[lo]!) / (T[hi]! - T[lo]!);
  const progress = P[lo]! + f * (P[hi]! - P[lo]!);
  const inPit = car.pitWindows.some(([a, b]) => t >= a && t <= b);
  if (car.retiredAt !== null && t >= car.retiredAt) return { driver: car.driver, progress, phase: 'out', visible: false };
  return { driver: car.driver, progress, phase: inPit ? 'pit' : 'running', visible: true };
}

export interface TowerRow extends CarState {
  position: number;
  /** Laps completed at time t. */
  lap: number;
  /** Time behind the leader (ms): live from distance while racing, at the line once finished. */
  gapMs: number | null;
  lapsDown: number;
  /** Time behind the car directly ahead (ms), while both are racing. */
  intervalMs: number | null;
}

/** The running order at time t, with gaps to the leader and to the car ahead. */
export function towerAt(model: ReplayModel, timing: RaceTiming, t: number, finishOrder: readonly number[]): TowerRow[] {
  const states = [...model.cars.values()].map((c) => carStateAt(c, t));
  const finishRank = new Map(finishOrder.map((d, i) => [d, i]));
  const rank = (s: CarState) => (s.phase === 'out' ? -1e6 + s.progress : s.progress);
  // Finishers on the same lap count are ordered by the official classification
  // (which includes time penalties); everything else by distance covered.
  states.sort((a, b) => {
    if (a.phase === 'finished' && b.phase === 'finished') {
      const la = model.cars.get(a.driver)?.lapsCompleted ?? 0;
      const lb = model.cars.get(b.driver)?.lapsCompleted ?? 0;
      if (la !== lb) return lb - la;
      return (finishRank.get(a.driver) ?? 99) - (finishRank.get(b.driver) ?? 99);
    }
    return rank(b) - rank(a);
  });
  const lapOf = (s: CarState) => Math.max(0, Math.floor(s.progress + 1e-9));
  const crossingOf = (d: number, L: number) => (L === 0 ? model.start : timing.crossing.get(d)?.[L] ?? Number.NaN);
  const rows: TowerRow[] = [];
  const leader = states[0];
  const leaderTrack = leader ? model.cars.get(leader.driver) : undefined;
  const leaderDone = leader?.phase === 'finished' && leaderTrack?.finishedAt != null;

  /**
   * When the leader was at a given distance: the leader's own recorded
   * (time, distance) points, inverted. A car's gap is then "now minus the moment
   * the leader passed this spot" — exactly how a live timing screen measures it,
   * so gaps always rise down the order, even mid pit-cycle or after the flag.
   */
  const leaderTimeAt = (progress: number): number => {
    const T = leaderTrack!.t;
    const P = leaderTrack!.p;
    const last = P.length - 1;
    if (progress <= P[0]!) {
      // Before the leader's first point (cars behind on the grid): extrapolate at lap pace.
      return T[0]! - (P[0]! - progress) * leaderTrack!.refLapMs;
    }
    if (progress >= P[last]!) return T[last]!;
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (P[mid]! <= progress) lo = mid;
      else hi = mid;
    }
    const span = P[hi]! - P[lo]!;
    return span > 0 ? T[lo]! + ((progress - P[lo]!) / span) * (T[hi]! - T[lo]!) : T[lo]!;
  };
  const behind = (s: CarState): { laps: number; ms: number } => {
    const leaderLaps = leaderDone ? leaderTrack!.lapsCompleted : leader!.progress;
    return { laps: leaderLaps - s.progress, ms: Math.max(0, t - leaderTimeAt(s.progress)) };
  };

  states.forEach((s, i) => {
    const lap = s.phase === 'grid' ? 0 : lapOf(s);
    let gapMs: number | null = null;
    let lapsDown = 0;
    let intervalMs: number | null = null;
    if (leader && s.phase !== 'grid' && s.phase !== 'out' && i > 0) {
      if (s.phase === 'finished') {
        // Finishers: the official way — the gap at the line on the car's final lap.
        const mine = model.cars.get(s.driver);
        const winnerLaps = leaderTrack?.lapsCompleted ?? 0;
        lapsDown = Math.max(0, winnerLaps - (mine?.lapsCompleted ?? winnerLaps));
        const finalLap = mine?.lapsCompleted ?? 0;
        if (finalLap >= 1) {
          const a = crossingOf(s.driver, finalLap);
          const b = crossingOf(leader.driver, finalLap);
          if (!Number.isNaN(a) && !Number.isNaN(b)) gapMs = Math.max(0, a - b);
        }
      } else {
        const me = behind(s);
        // Lapped means a full lap of distance behind, not merely one line-crossing behind.
        lapsDown = Math.max(0, Math.floor(me.laps + 1e-9));
        gapMs = me.ms;
        const ahead = states[i - 1]!;
        if (ahead.phase === 'running' || ahead.phase === 'pit') intervalMs = Math.max(0, me.ms - behind(ahead).ms);
      }
    }
    rows.push({ ...s, position: i + 1, lap, gapMs, lapsDown, intervalMs });
  });
  return rows;
}

/** The fastest lap completed by time t. */
export function fastestLapAt(model: ReplayModel, t: number): { driver: number; lap: number; ms: number } | null {
  let lo = 0;
  let hi = model.lapLog.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (model.lapLog[mid]!.at <= t) {
      idx = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  if (idx < 0) return null;
  const best = model.lapLog[model.bestUpTo[idx]!]!;
  return { driver: best.driver, lap: best.lap, ms: best.ms };
}

/** Compound on a car at lap L (the stint covering it). */
export function compoundAt(stints: readonly Stint[], driver: number, lap: number): Stint | null {
  const L = Math.max(1, lap);
  let found: Stint | null = null;
  for (const s of stints) if (s.driverNumber === driver && s.lapStart <= L && (found === null || s.lapStart >= found.lapStart)) found = s;
  return found;
}

/** Leader's lap number for display: the lap the leader is currently on. */
export function leaderLapAt(model: ReplayModel, t: number): number {
  if (t < model.start) return 0;
  let L = 0;
  for (let i = 1; i < model.leaderCrossing.length; i++) {
    const c = model.leaderCrossing[i]!;
    if (Number.isFinite(c) && c <= t) L = i;
  }
  return Math.min(model.totalLaps, L + 1);
}
