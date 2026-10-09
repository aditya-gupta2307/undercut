/**
 * Strategy Lab: a per-race tyre model and a pit-strategy simulator.
 *
 * The tyre model is a linear regression over every clean, green-flag lap of
 * the race:
 *
 *     lap time = driver base + compound offset + compound degradation × tyre age
 *              + fuel/track effect × lap number + noise
 *
 * fitted by least squares with a robust second pass (laps more than three
 * MADs from the first fit are dropped — traffic, mistakes, lifts).
 *
 * The simulator replays one car's race under a different plan. The headline
 * number is the *difference* between the alternative plan and the plan the
 * car actually ran, both simulated by the same model — so the model's own
 * bias cancels and only the strategy effect is left. That difference is then
 * applied to the car's real finishing time to see where it would have landed
 * against everyone's real race. Traffic and other cars reacting are not
 * modelled, and stints may not run past what any car managed on that compound
 * in this race (plus 15%), since a linear model knows nothing of tyre cliffs.
 */

import { leastSquares } from '../lib/linalg';
import { mad, median } from '../lib/stats';
import type { Compound, PitStop, Stint } from '../data/types';
import { isCleanLap, type RaceTiming } from './raceTiming';

export const DRY: Compound[] = ['SOFT', 'MEDIUM', 'HARD'];

export interface TyreModel {
  base: Map<number, number>;
  offset: Partial<Record<Compound, number>>;
  deg: Partial<Record<Compound, number>>;
  fuelPerLap: number;
  residualSd: number;
  laps: number;
  compounds: Compound[];
  reference: Compound;
  /** Longest stint anyone ran on each compound in this race. */
  maxStint: Partial<Record<Compound, number>>;
}

interface Obs {
  driver: number;
  lap: number;
  compound: Compound;
  age: number;
  ms: number;
}

function stintFor(stints: readonly Stint[], driver: number, lap: number): Stint | undefined {
  return stints.find((s) => s.driverNumber === driver && s.lapStart <= lap && lap <= s.lapEnd);
}

export function tyreAge(stint: Stint, lap: number): number {
  return stint.tyreAgeAtStart + (lap - stint.lapStart);
}

export function isWetRace(stints: readonly Stint[]): boolean {
  return stints.some((s) => s.compound === 'INTERMEDIATE' || s.compound === 'WET');
}

export function fitTyreModel(timing: RaceTiming, stints: readonly Stint[]): TyreModel | null {
  if (isWetRace(stints)) return null;
  const obs: Obs[] = [];
  for (const d of timing.drivers) {
    const dur = timing.lapMs.get(d)!;
    const mine: Obs[] = [];
    for (let L = 2; L <= (timing.lapsCompleted.get(d) ?? 0); L++) {
      if (!isCleanLap(timing, d, L)) continue;
      const st = stintFor(stints, d, L);
      if (!st || !DRY.includes(st.compound)) continue;
      mine.push({ driver: d, lap: L, compound: st.compound, age: tyreAge(st, L), ms: dur[L]! });
    }
    const m = median(mine.map((o) => o.ms));
    for (const o of mine) if (o.ms < m * 1.07) obs.push(o);
  }
  if (obs.length < 40) return null;

  const counts = new Map<Compound, number>();
  for (const o of obs) counts.set(o.compound, (counts.get(o.compound) ?? 0) + 1);
  const compounds = DRY.filter((c) => (counts.get(c) ?? 0) >= 8);
  if (compounds.length === 0) return null;
  const reference: Compound = compounds.includes('MEDIUM') ? 'MEDIUM' : compounds[0]!;
  const drivers = [...new Set(obs.map((o) => o.driver))];
  const dIdx = new Map(drivers.map((d, i) => [d, i]));
  const offCompounds = compounds.filter((c) => c !== reference);
  const offIdx = new Map(offCompounds.map((c, i) => [c, drivers.length + i]));
  const degIdx = new Map(compounds.map((c, i) => [c, drivers.length + offCompounds.length + i]));
  const fuelIdx = drivers.length + offCompounds.length + compounds.length;
  const P = fuelIdx + 1;

  const rowsFor = (data: Obs[]) =>
    data
      .filter((o) => compounds.includes(o.compound))
      .map((o) => {
        const x = new Float64Array(P);
        x[dIdx.get(o.driver)!] = 1;
        const oi = offIdx.get(o.compound);
        if (oi !== undefined) x[oi] = 1;
        x[degIdx.get(o.compound)!] = o.age;
        // Centre the lap number for numerical conditioning.
        x[fuelIdx] = o.lap - 30;
        return { x, y: o.ms, o };
      });

  let rows = rowsFor(obs);
  let beta = leastSquares(rows.map((r) => r.x), rows.map((r) => r.y), P, 1e-3);
  if (!beta) return null;
  const predict = (b: Float64Array, x: Float64Array) => {
    let s = 0;
    for (let i = 0; i < P; i++) s += b[i]! * x[i]!;
    return s;
  };
  const resid = rows.map((r) => r.y - predict(beta!, r.x));
  const spread = mad(resid);
  rows = rows.filter((_, i) => Math.abs(resid[i]!) <= 3 * Math.max(spread, 150));
  beta = leastSquares(rows.map((r) => r.x), rows.map((r) => r.y), P, 1e-3);
  if (!beta) return null;
  const finalResid = rows.map((r) => r.y - predict(beta!, r.x));

  const base = new Map<number, number>();
  drivers.forEach((d, i) => base.set(d, beta![i]! - 30 * beta![fuelIdx]!));
  const offset: Partial<Record<Compound, number>> = { [reference]: 0 };
  offCompounds.forEach((c) => (offset[c] = beta![offIdx.get(c)!]!));
  const deg: Partial<Record<Compound, number>> = {};
  compounds.forEach((c) => (deg[c] = beta![degIdx.get(c)!]!));

  const maxStint: Partial<Record<Compound, number>> = {};
  for (const s of stints) {
    const len = s.lapEnd - s.lapStart + 1;
    maxStint[s.compound] = Math.max(maxStint[s.compound] ?? 0, len + s.tyreAgeAtStart);
  }

  return {
    base,
    offset,
    deg,
    fuelPerLap: beta[fuelIdx]!,
    residualSd: Math.sqrt(finalResid.reduce((s, r) => s + r * r, 0) / Math.max(1, finalResid.length - P)),
    laps: rows.length,
    compounds,
    reference,
    maxStint,
  };
}

export interface PlanStint {
  compound: Compound;
  /** Laps run on this set. */
  laps: number;
  /** Tyre age when fitted (0 = new). */
  ageAtStart: number;
}

export interface Plan {
  stints: PlanStint[];
}

export interface SimContext {
  model: TyreModel;
  timing: RaceTiming;
  driver: number;
  totalLaps: number;
  pitLossMs: number;
  /** A stop under a safety car or VSC costs this fraction of a green-flag stop. */
  neutralPitFactor?: number;
}

export function planFromStints(stints: readonly Stint[], driver: number, totalLaps: number): Plan {
  const mine = stints.filter((s) => s.driverNumber === driver).sort((a, b) => a.lapStart - b.lapStart);
  const plan: PlanStint[] = mine.map((s, i) => {
    const end = i === mine.length - 1 ? Math.max(s.lapEnd, totalLaps) : s.lapEnd;
    return { compound: s.compound, laps: Math.max(1, end - s.lapStart + 1), ageAtStart: s.tyreAgeAtStart };
  });
  // Stint data can trail the race slightly; make the plan cover the full distance.
  const covered = plan.reduce((s, x) => s + x.laps, 0);
  if (plan.length && covered !== totalLaps) plan[plan.length - 1]!.laps += totalLaps - covered;
  return { stints: plan.filter((s) => s.laps > 0) };
}

export interface SimResult {
  totalMs: number;
  lapMs: number[];
  stopLaps: number[];
  valid: boolean;
  issues: string[];
}

/** Lap time from the model for one car. */
export function modelLap(model: TyreModel, driver: number, compound: Compound, age: number, lap: number): number {
  const base = model.base.get(driver) ?? median([...model.base.values()]);
  const off = model.offset[compound] ?? 0;
  const deg = model.deg[compound] ?? model.deg[model.reference] ?? 0;
  return base + off + deg * age + model.fuelPerLap * lap;
}

export function simulatePlan(ctx: SimContext, plan: Plan): SimResult {
  const { model, timing, driver, totalLaps } = ctx;
  const neutralFactor = ctx.neutralPitFactor ?? 0.55;
  const actual = timing.lapMs.get(driver);
  const issues: string[] = [];
  const covered = plan.stints.reduce((s, x) => s + x.laps, 0);
  if (covered !== totalLaps) issues.push(`Plan covers ${covered} laps, race was ${totalLaps}.`);
  const dryUsed = new Set(plan.stints.map((s) => s.compound).filter((c) => DRY.includes(c)));
  if (dryUsed.size < 2) issues.push('Dry races require two different compounds.');
  for (const s of plan.stints) {
    if (!model.compounds.includes(s.compound)) issues.push(`No ${s.compound.toLowerCase()} laps in this race to model.`);
    const limit = Math.round((model.maxStint[s.compound] ?? 0) * 1.15);
    if (limit > 0 && s.ageAtStart + s.laps > limit) issues.push(`${s.laps} laps on ${s.compound.toLowerCase()}s is longer than anyone managed here.`);
  }

  const lapMs: number[] = [];
  const stopLaps: number[] = [];
  let total = 0;
  let lap = 1;
  plan.stints.forEach((st, i) => {
    for (let k = 0; k < st.laps && lap <= totalLaps; k++, lap++) {
      let t: number;
      const neutral = timing.neutralLaps.has(lap) || lap === 1;
      if (neutral && actual && !Number.isNaN(actual[lap] ?? Number.NaN)) {
        t = actual[lap]!; // safety-car and opening laps are set by the race, not the tyres
      } else {
        t = modelLap(model, driver, st.compound, st.ageAtStart + k, lap);
      }
      lapMs.push(t);
      total += t;
    }
    if (i < plan.stints.length - 1) {
      const stopLap = lap - 1;
      stopLaps.push(stopLap);
      // Under a red flag teams may change tyres in the pit lane for free.
      const underRed = timing.neutral.some((n) => n.kind === 'RED' && stopLap >= n.startLap && stopLap <= n.endLap);
      const underNeutral = timing.neutralLaps.has(stopLap) || timing.neutralLaps.has(stopLap + 1);
      total += underRed ? 0 : ctx.pitLossMs * (underNeutral ? neutralFactor : 1);
    }
  });
  return { totalMs: total, lapMs, stopLaps, valid: issues.length === 0, issues };
}

export interface StrategyOption {
  plan: Plan;
  deltaMs: number;
  label: string;
}

function label(plan: Plan): string {
  const stops = plan.stints.length - 1;
  const seq = plan.stints.map((s) => s.compound[0]).join('–');
  let lap = 0;
  const boxes = plan.stints.slice(0, -1).map((s) => (lap += s.laps));
  return `${stops}-stop ${seq}${boxes.length ? ` · box lap ${boxes.join(', ')}` : ''}`;
}

/**
 * Exhaustive search over one- and two-stop plans with the compounds raced
 * here, new tyres at every stop, and stints within the observed limits.
 */
export function searchStrategies(ctx: SimContext, actual: Plan, minStint = 5): { best: StrategyOption[]; oneStopCurve: { lap: number; deltaMs: number }[] } {
  const ref = simulatePlan(ctx, actual).totalMs;
  const { model, totalLaps } = ctx;
  const comps = model.compounds;
  const firstAge = actual.stints[0]?.ageAtStart ?? 0;
  const fits = (c: Compound, laps: number, age: number) => {
    const limit = Math.round((model.maxStint[c] ?? 0) * 1.15);
    return limit === 0 || age + laps <= limit;
  };
  const results: StrategyOption[] = [];
  const curveFor = actual.stints.length >= 2 ? [actual.stints[0]!.compound, actual.stints[1]!.compound] : null;
  const curve = new Map<number, number>();

  for (const c1 of comps) {
    for (const c2 of comps) {
      if (c1 === c2) continue;
      for (let p = minStint; p <= totalLaps - minStint; p++) {
        if (!fits(c1, p, firstAge) || !fits(c2, totalLaps - p, 0)) continue;
        const plan: Plan = { stints: [{ compound: c1, laps: p, ageAtStart: firstAge }, { compound: c2, laps: totalLaps - p, ageAtStart: 0 }] };
        const d = simulatePlan(ctx, plan).totalMs - ref;
        results.push({ plan, deltaMs: d, label: label(plan) });
        if (curveFor && c1 === curveFor[0] && c2 === curveFor[1]) curve.set(p, d);
      }
    }
  }
  for (const c1 of comps) {
    for (const c2 of comps) {
      for (const c3 of comps) {
        if (new Set([c1, c2, c3]).size < 2) continue;
        for (let p1 = minStint; p1 <= totalLaps - 2 * minStint; p1++) {
          if (!fits(c1, p1, firstAge)) continue;
          for (let p2 = p1 + minStint; p2 <= totalLaps - minStint; p2++) {
            if (!fits(c2, p2 - p1, 0) || !fits(c3, totalLaps - p2, 0)) continue;
            const plan: Plan = {
              stints: [
                { compound: c1, laps: p1, ageAtStart: firstAge },
                { compound: c2, laps: p2 - p1, ageAtStart: 0 },
                { compound: c3, laps: totalLaps - p2, ageAtStart: 0 },
              ],
            };
            results.push({ plan, deltaMs: simulatePlan(ctx, plan).totalMs - ref, label: label(plan) });
          }
        }
      }
    }
  }
  results.sort((a, b) => a.deltaMs - b.deltaMs);
  // Keep the best of each distinct compound sequence so the list is not five near-identical plans.
  const seen = new Set<string>();
  const best: StrategyOption[] = [];
  for (const r of results) {
    const key = r.plan.stints.map((s) => s.compound).join('-');
    if (seen.has(key)) continue;
    seen.add(key);
    best.push(r);
    if (best.length >= 6) break;
  }
  return { best, oneStopCurve: [...curve.entries()].sort((a, b) => a[0] - b[0]).map(([lap, deltaMs]) => ({ lap, deltaMs })) };
}

/** Where a car would have finished had its real finish time shifted by deltaMs. */
export function positionWithDelta(timing: RaceTiming, driver: number, deltaMs: number): { position: number | null; actual: number | null } {
  const total = timing.totalLaps;
  const finish = (d: number) => timing.crossing.get(d)?.[total] ?? Number.NaN;
  const mine = finish(driver);
  if (Number.isNaN(mine)) return { position: null, actual: null };
  const others = timing.drivers.filter((d) => d !== driver && !Number.isNaN(finish(d))).map(finish);
  const actualPos = others.filter((t) => t < mine).length + 1;
  const newPos = others.filter((t) => t < mine + deltaMs).length + 1;
  return { position: newPos, actual: actualPos };
}

/** Real stops for the car, for display alongside a plan. */
export function stopsOf(pits: readonly PitStop[], driver: number): PitStop[] {
  return pits.filter((p) => p.driverNumber === driver).sort((a, b) => a.lap - b.lap);
}
