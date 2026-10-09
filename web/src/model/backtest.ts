/**
 * Walk-forward backtest: the model's report card.
 *
 * For every Grand Prix already run this season, refit everything using only
 * sessions that had finished before that race, forecast it, then compare with
 * what happened. Two forecasts per race:
 *
 *   pre-qualifying — made before qualifying, so the grid itself is simulated;
 *   race-day       — made after qualifying, with the real starting grid.
 *
 * Both are scored against two honest baselines: "anyone could win" (uniform)
 * and "track position is everything" (historical results by grid slot).
 */

import type { Season } from '../data/types';
import { raceTime } from '../data/season';
import { DEFAULT_CONFIG, type ModelConfig } from './config';
import { qualiTime, type Entrant } from './dataset';
import { fitModels, forecastRace } from './forecast';
import { brier, calibration, winnerLogLoss, type BinaryPrediction, type CalibrationBin } from './metrics';

export interface Probs {
  pWin: number;
  pPodium: number;
  pPoints: number;
}

export interface BacktestRace {
  round: number;
  name: string;
  date: string;
  winnerId: string | null;
  entrants: Entrant[];
  raceDay: Map<string, Probs>;
  preQuali: Map<string, Probs> | null;
  grid: Map<string, Probs>;
  outcome: Map<string, { position: number | null; podium: boolean; points: boolean }>;
}

export type Variant = 'raceDay' | 'preQuali' | 'grid' | 'uniform';

export interface VariantScore {
  variant: Variant;
  label: string;
  winLogLoss: number;
  winBrier: number;
  podiumBrier: number;
  pointsBrier: number;
  /** Share of races where the forecast's favourite won. */
  favouriteHit: number;
  races: number;
}

export interface BacktestResult {
  season: number;
  races: BacktestRace[];
  scores: VariantScore[];
  calibration: { win: CalibrationBin[]; podium: CalibrationBin[] };
  config: ModelConfig;
}

const LABELS: Record<Variant, string> = {
  raceDay: 'Model · race day',
  preQuali: 'Model · before qualifying',
  grid: 'Baseline · grid slot',
  uniform: 'Baseline · anyone can win',
};

/** Historical P(win / podium / points | grid slot), shrunk toward the uniform rate. */
export function gridBaseline(seasons: readonly Season[], cutoff: number) {
  const starts = new Map<number, number>();
  const hits = { win: new Map<number, number>(), podium: new Map<number, number>(), points: new Map<number, number>() };
  const bump = (m: Map<number, number>, k: number) => m.set(k, (m.get(k) ?? 0) + 1);
  for (const s of seasons) {
    for (const ev of s.events) {
      if (raceTime(ev) >= cutoff) continue;
      for (const r of s.results[ev.round] ?? []) {
        if (r.grid === null) continue;
        const g = r.grid <= 0 ? 99 : r.grid;
        bump(starts, g);
        if (r.position === 1) bump(hits.win, g);
        if (r.position !== null && r.position <= 3) bump(hits.podium, g);
        if (r.position !== null && r.position <= 10) bump(hits.points, g);
      }
    }
  }
  return (grid: number | null, field: number): Probs => {
    const g = grid === null || grid <= 0 ? 99 : grid;
    const n = starts.get(g) ?? 0;
    const a = 3;
    const est = (m: Map<number, number>, k: number) => ((m.get(g) ?? 0) + a * Math.min(1, k / field)) / (n + a);
    return { pWin: est(hits.win, 1), pPodium: est(hits.podium, 3), pPoints: est(hits.points, 10) };
  };
}

function normaliseWin(m: Map<string, Probs>): Map<string, Probs> {
  let total = 0;
  for (const p of m.values()) total += p.pWin;
  if (total <= 0) return m;
  const out = new Map<string, Probs>();
  for (const [k, p] of m) out.set(k, { ...p, pWin: p.pWin / total });
  return out;
}

export interface BacktestOptions {
  config?: ModelConfig;
  sims?: number;
  preQuali?: boolean;
  onProgress?: (done: number, total: number) => void;
  /** Return true to abandon the run (e.g. the page was left). */
  cancelled?: () => boolean;
}

export async function runBacktest(seasons: readonly Season[], targetSeason: number, opts: BacktestOptions = {}): Promise<BacktestResult | null> {
  const config = opts.config ?? DEFAULT_CONFIG;
  const sims = opts.sims ?? 4000;
  const target = seasons.find((s) => s.year === targetSeason);
  if (!target) return null;
  const done = target.events.filter((e) => target.results[e.round]?.length);
  const races: BacktestRace[] = [];

  for (let k = 0; k < done.length; k++) {
    if (opts.cancelled?.()) return null;
    const ev = done[k]!;
    const rows = target.results[ev.round]!;
    const entrants: Entrant[] = rows.map((r) => ({ driverId: r.driverId, teamId: r.teamId }));
    const start = raceTime(ev);

    const models = fitModels(seasons, start, targetSeason, entrants, config);
    const grid = new Map(rows.map((r) => [r.driverId, r.grid ?? 0]));
    const rd = forecastRace(models, entrants, { grid, sims, seed: 1000 + ev.round });
    const raceDay = new Map(rd.map((f) => [f.driverId, { pWin: f.pWin, pPodium: f.pPodium, pPoints: f.pPoints }]));

    let preQuali: Map<string, Probs> | null = null;
    if (opts.preQuali !== false) {
      const pm = fitModels(seasons, qualiTime(ev), targetSeason, entrants, config);
      const pq = forecastRace(pm, entrants, { sims, seed: 2000 + ev.round });
      preQuali = new Map(pq.map((f) => [f.driverId, { pWin: f.pWin, pPodium: f.pPodium, pPoints: f.pPoints }]));
    }

    const base = gridBaseline(seasons, start);
    const gridProbs = normaliseWin(new Map(rows.map((r) => [r.driverId, base(r.grid, rows.length)])));

    const outcome = new Map(
      rows.map((r) => [r.driverId, { position: r.position, podium: r.position !== null && r.position <= 3, points: r.position !== null && r.position <= 10 }]),
    );
    races.push({
      round: ev.round,
      name: ev.name,
      date: ev.date,
      winnerId: rows.find((r) => r.position === 1)?.driverId ?? null,
      entrants,
      raceDay,
      preQuali,
      grid: gridProbs,
      outcome,
    });
    opts.onProgress?.(k + 1, done.length);
    // Yield so the page stays responsive while dozens of models are fitted.
    await new Promise((r) => setTimeout(r, 0));
  }

  return { season: targetSeason, races, scores: scoreRaces(races), calibration: calibrationOf(races), config };
}

function probsFor(race: BacktestRace, variant: Variant): Map<string, Probs> | null {
  if (variant === 'raceDay') return race.raceDay;
  if (variant === 'preQuali') return race.preQuali;
  if (variant === 'grid') return race.grid;
  const n = race.entrants.length;
  return new Map(race.entrants.map((e) => [e.driverId, { pWin: 1 / n, pPodium: Math.min(1, 3 / n), pPoints: Math.min(1, 10 / n) }]));
}

export function scoreRaces(races: readonly BacktestRace[]): VariantScore[] {
  const variants: Variant[] = ['raceDay', 'preQuali', 'grid', 'uniform'];
  const out: VariantScore[] = [];
  for (const v of variants) {
    const win: BinaryPrediction[] = [];
    const podium: BinaryPrediction[] = [];
    const points: BinaryPrediction[] = [];
    const pWinner: number[] = [];
    let favHits = 0;
    let counted = 0;
    for (const race of races) {
      const probs = probsFor(race, v);
      if (!probs || !race.winnerId) continue;
      counted++;
      let favP = -1;
      for (const [id, p] of probs) {
        const o = race.outcome.get(id);
        if (!o) continue;
        win.push({ p: p.pWin, outcome: o.position === 1 });
        podium.push({ p: p.pPodium, outcome: o.podium });
        points.push({ p: p.pPoints, outcome: o.points });
        if (p.pWin > favP) favP = p.pWin;
      }
      // Joint favourites share the credit, so a forecast that rates everyone equally
      // scores 1/n here rather than whatever the listing order happens to favour.
      const joint = [...probs.entries()].filter(([id, p]) => race.outcome.has(id) && Math.abs(p.pWin - favP) < 1e-12).map(([id]) => id);
      pWinner.push(probs.get(race.winnerId)?.pWin ?? 0);
      if (joint.includes(race.winnerId)) favHits += 1 / joint.length;
    }
    if (counted === 0) continue;
    out.push({
      variant: v,
      label: LABELS[v],
      winLogLoss: winnerLogLoss(pWinner),
      winBrier: brier(win),
      podiumBrier: brier(podium),
      pointsBrier: brier(points),
      favouriteHit: favHits / counted,
      races: counted,
    });
  }
  return out;
}

function calibrationOf(races: readonly BacktestRace[]) {
  const win: BinaryPrediction[] = [];
  const podium: BinaryPrediction[] = [];
  for (const race of races) {
    for (const [id, p] of race.raceDay) {
      const o = race.outcome.get(id);
      if (!o) continue;
      win.push({ p: p.pWin, outcome: o.position === 1 });
      podium.push({ p: p.pPodium, outcome: o.podium });
    }
  }
  return { win: calibration(win), podium: calibration(podium) };
}

export interface TuneCandidate {
  halfLifeRaces: number;
  priorSeasonWeight: number;
  logLoss: number;
}

/**
 * Grid search over the two recency knobs, scored by race-day winner log loss.
 * Deliberately small — 20 settings — so it runs in a few seconds in a browser.
 */
export async function tuneRecency(
  seasons: readonly Season[],
  targetSeason: number,
  base: ModelConfig,
  opts: { onProgress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<TuneCandidate[] | null> {
  const halfLives = [2, 4, 8, 16, Number.POSITIVE_INFINITY];
  const seasonWeights = [0.1, 0.3, 0.6, 1];
  const total = halfLives.length * seasonWeights.length;
  const out: TuneCandidate[] = [];
  let done = 0;
  for (const h of halfLives) {
    for (const w of seasonWeights) {
      if (opts.cancelled?.()) return null;
      const res = await runBacktest(seasons, targetSeason, {
        config: { ...base, halfLifeRaces: h, priorSeasonWeight: w },
        sims: 600,
        preQuali: false,
        cancelled: opts.cancelled,
      });
      if (!res) return null;
      const s = res.scores.find((x) => x.variant === 'raceDay');
      out.push({ halfLifeRaces: h, priorSeasonWeight: w, logLoss: s?.winLogLoss ?? Number.NaN });
      opts.onProgress?.(++done, total);
    }
  }
  return out.sort((a, b) => a.logLoss - b.logLoss);
}
