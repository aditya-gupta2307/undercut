/**
 * Scoring rules. Brier score and log loss are *proper* scoring rules: the
 * only way to optimise them is to report your honest probabilities, which is
 * exactly why the Model Lab uses them instead of "did the favourite win".
 */

import { wilson } from '../lib/stats';

export interface BinaryPrediction {
  p: number;
  outcome: boolean;
}

/** Mean squared error between probability and outcome. 0 is perfect. */
export function brier(preds: readonly BinaryPrediction[]): number {
  if (preds.length === 0) return Number.NaN;
  let s = 0;
  for (const { p, outcome } of preds) s += (p - (outcome ? 1 : 0)) ** 2;
  return s / preds.length;
}

/**
 * Multiclass log loss for "who wins": the negative log of the probability the
 * forecast gave to the driver who actually won. Probabilities are floored so a
 * single impossible-looking winner cannot produce infinity.
 */
export function winnerLogLoss(probOfActualWinner: readonly number[], floor = 1e-4): number {
  if (probOfActualWinner.length === 0) return Number.NaN;
  let s = 0;
  for (const p of probOfActualWinner) s += -Math.log(Math.max(floor, p));
  return s / probOfActualWinner.length;
}

export interface CalibrationBin {
  lo: number;
  hi: number;
  n: number;
  meanPredicted: number;
  observed: number;
  ciLow: number;
  ciHigh: number;
}

/** Bins tuned for race probabilities, where most values are small. */
export const CALIBRATION_EDGES = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.7, 1.0001];

export function calibration(preds: readonly BinaryPrediction[], edges: readonly number[] = CALIBRATION_EDGES): CalibrationBin[] {
  const bins: CalibrationBin[] = [];
  for (let b = 0; b < edges.length - 1; b++) {
    const lo = edges[b]!;
    const hi = edges[b + 1]!;
    const inBin = preds.filter((x) => x.p >= lo && x.p < hi);
    if (inBin.length === 0) continue;
    const hits = inBin.filter((x) => x.outcome).length;
    const [ciLow, ciHigh] = wilson(hits, inBin.length);
    bins.push({
      lo,
      hi: Math.min(1, hi),
      n: inBin.length,
      meanPredicted: inBin.reduce((s, x) => s + x.p, 0) / inBin.length,
      observed: hits / inBin.length,
      ciLow,
      ciHigh,
    });
  }
  return bins;
}

/**
 * Brier skill score relative to a reference forecast: 1 is perfect, 0 is no
 * better than the reference, negative is worse.
 */
export function skill(score: number, reference: number): number {
  if (!Number.isFinite(score) || !Number.isFinite(reference) || reference === 0) return Number.NaN;
  return 1 - score / reference;
}
