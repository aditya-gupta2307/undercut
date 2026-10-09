/**
 * The race forecast.
 *
 * 1. Fit three models on everything that happened before the cutoff:
 *      race     — Plackett–Luce on finishing orders, with the grid effect β;
 *      quali    — Plackett–Luce on qualifying orders;
 *      DNF      — shrunken retirement rates per team and driver.
 * 2. Simulate the weekend many times. If the grid is not known yet, each
 *    simulation first draws a qualifying order (Gumbel-max sampling), which
 *    sets the grid; then retirements are drawn; then the finishing order.
 *
 * Win probabilities use Rao–Blackwellisation: rather than counting sampled
 * winners, each simulation adds every surviving car's *exact* first-choice
 * probability given that grid and those retirements. Same expectation, far
 * less noise, and never an exact zero — which matters for log-loss scoring.
 */

import { gumbel, mulberry32 } from '../lib/rng';
import type { Season } from '../data/types';
import { lineageRoot } from '../data/teams';
import { DEFAULT_CONFIG, type ModelConfig } from './config';
import { buildTrainingSet, gridCovariate, type Entrant, type ModelIndex, type TrainingSet } from './dataset';
import { fitPL, type PLFit, type PLSpec } from './plackettLuce';
import { dnfProbability, fitReliability, type Reliability } from './reliability';

export interface FittedModels {
  index: ModelIndex;
  race: PLFit;
  quali: PLFit;
  reliability: Reliability;
  config: ModelConfig;
  training: Pick<TrainingSet, 'weekends'> & { raceEvents: number; qualiEvents: number };
}

export function raceSpec(index: ModelIndex, config: ModelConfig): PLSpec {
  return {
    nTeams: index.teamKeys.length,
    nDrivers: index.driverIds.length,
    useCovariate: true,
    sdTeam: config.sdTeam,
    sdDriver: config.sdDriver,
    betaMean: config.betaMean,
    sdBeta: config.sdBeta,
  };
}

export function qualiSpec(index: ModelIndex, config: ModelConfig): PLSpec {
  return { ...raceSpec(index, config), useCovariate: false };
}

export function fitModels(
  seasons: readonly Season[],
  cutoff: number,
  targetSeason: number,
  entrants: readonly Entrant[],
  config: ModelConfig = DEFAULT_CONFIG,
  opts: { covariance?: boolean } = {},
): FittedModels {
  const ts = buildTrainingSet(seasons, cutoff, targetSeason, config, entrants);
  const race = fitPL(ts.race, raceSpec(ts.index, config), { covariance: opts.covariance });
  const quali = fitPL(ts.quali, qualiSpec(ts.index, config), { covariance: opts.covariance });
  const reliability = fitReliability(ts.starts, ts.index.teamKeys.length, ts.index.driverIds.length, config.dnfPriorStarts);
  return {
    index: ts.index,
    race,
    quali,
    reliability,
    config,
    training: { weekends: ts.weekends, raceEvents: ts.race.length, qualiEvents: ts.quali.length },
  };
}

export interface DriverForecast {
  driverId: string;
  teamId: string;
  pWin: number;
  pPodium: number;
  pPoints: number;
  pDnf: number;
  /** Probability of qualifying on pole (only when the grid was simulated). */
  pPole: number | null;
  /** Expected finishing position given the car finishes. */
  expectedFinish: number;
  /** P(finish in position k+1); retirements are excluded, so this sums to 1 − pDnf. */
  positionProbs: number[];
}

export interface ForecastOptions {
  /** Known grid slots (driverId -> 1-based slot; 0 = pit lane). Omit to simulate qualifying. */
  grid?: ReadonlyMap<string, number>;
  sims?: number;
  seed?: number;
  /** Sprint: shorter race (fewer retirements) and points to P8. */
  sprint?: boolean;
}

export interface EntrantParams {
  driverId: string;
  teamId: string;
  raceBase: number;
  qualiBase: number;
  dnf: number;
}

export function entrantParams(models: FittedModels, entrants: readonly Entrant[], sprint = false): EntrantParams[] {
  const { index, race, quali, reliability } = models;
  return entrants.map((e) => {
    const t = index.teamIndex.get(lineageRoot(e.teamId));
    const d = index.driverIndex.get(e.driverId);
    const raceBase = (t !== undefined ? race.team[t]! : 0) + (d !== undefined ? race.driver[d]! : 0);
    const qualiBase = (t !== undefined ? quali.team[t]! : 0) + (d !== undefined ? quali.driver[d]! : 0);
    let dnf = t !== undefined && d !== undefined ? dnfProbability(reliability, t, d) : reliability.globalRate;
    if (sprint) dnf *= 0.35; // roughly a third of the distance
    return { driverId: e.driverId, teamId: e.teamId, raceBase, qualiBase, dnf };
  });
}

export function forecastRace(models: FittedModels, entrants: readonly Entrant[], opts: ForecastOptions = {}): DriverForecast[] {
  const n = entrants.length;
  if (n === 0) return [];
  const sims = opts.sims ?? models.config.sims;
  const rng = mulberry32(opts.seed ?? 0x5eed);
  const params = entrantParams(models, entrants, opts.sprint);
  const beta = models.race.beta;
  const pointsCut = opts.sprint ? 8 : 10;

  const knownGrid = opts.grid;
  const fixedX = new Float64Array(n);
  if (knownGrid) {
    for (let i = 0; i < n; i++) fixedX[i] = gridCovariate(knownGrid.get(params[i]!.driverId) ?? null, n);
  }

  const win = new Float64Array(n);
  const dnfCount = new Float64Array(n);
  const pole = new Float64Array(n);
  const posCounts = Array.from({ length: n }, () => new Float64Array(n));
  const finishSum = new Float64Array(n);

  const s = new Float64Array(n);
  const key = new Float64Array(n);
  const order = new Int32Array(n);
  const qOrder: number[] = Array.from({ length: n }, (_, i) => i);
  const alive: number[] = [];

  for (let sim = 0; sim < sims; sim++) {
    // 1) Grid: known, or a simulated qualifying session.
    if (knownGrid) {
      for (let i = 0; i < n; i++) s[i] = params[i]!.raceBase + beta * fixedX[i]!;
    } else {
      for (let i = 0; i < n; i++) key[i] = params[i]!.qualiBase + gumbel(rng);
      qOrder.sort((a, b) => key[b]! - key[a]!);
      pole[qOrder[0]!]!++;
      for (let slot = 0; slot < n; slot++) {
        const i = qOrder[slot]!;
        s[i] = params[i]!.raceBase + beta * -Math.log(slot + 1);
      }
    }

    // 2) Retirements.
    alive.length = 0;
    for (let i = 0; i < n; i++) {
      if (rng() < params[i]!.dnf) dnfCount[i]!++;
      else alive.push(i);
    }
    if (alive.length === 0) continue;

    // 3) Exact win probabilities among survivors (Rao–Blackwellised).
    let m = Number.NEGATIVE_INFINITY;
    for (const i of alive) m = Math.max(m, s[i]!);
    let z = 0;
    for (const i of alive) z += Math.exp(s[i]! - m);
    for (const i of alive) win[i]! += Math.exp(s[i]! - m) / z;

    // 4) A full finishing order for podium / points / position distributions.
    for (const i of alive) key[i] = s[i]! + gumbel(rng);
    const k = alive.length;
    for (let j = 0; j < k; j++) order[j] = alive[j]!;
    const sorted = Array.from(order.subarray(0, k)).sort((a, b) => key[b]! - key[a]!);
    for (let pos = 0; pos < k; pos++) {
      const i = sorted[pos]!;
      posCounts[i]![pos]!++;
      finishSum[i]! += pos + 1;
    }
  }

  return params.map((p, i) => {
    const counts = posCounts[i]!;
    let podium = 0;
    let points = 0;
    let finishes = 0;
    for (let pos = 0; pos < n; pos++) {
      if (pos < 3) podium += counts[pos]!;
      if (pos < pointsCut) points += counts[pos]!;
      finishes += counts[pos]!;
    }
    return {
      driverId: p.driverId,
      teamId: p.teamId,
      pWin: win[i]! / sims,
      pPodium: podium / sims,
      pPoints: points / sims,
      pDnf: dnfCount[i]! / sims,
      pPole: knownGrid ? null : pole[i]! / sims,
      expectedFinish: finishes > 0 ? finishSum[i]! / finishes : n,
      positionProbs: Array.from(counts, (c) => c / sims),
    };
  });
}
