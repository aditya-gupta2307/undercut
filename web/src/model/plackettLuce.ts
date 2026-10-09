/**
 * Plackett–Luce ranking model with a team + driver decomposition.
 *
 * A finishing order is read as a sequence of choices: the winner is "chosen"
 * from everyone with probability proportional to exp(s), second place from
 * everyone who is left, and so on. Each car's log-strength is
 *
 *     s = θ[team] + δ[driver] + β · x
 *
 * where θ is the car, δ is the driver relative to that car, and x is an
 * optional covariate (the race model uses x = −log(grid slot), so starting
 * further forward helps by a learned amount β).
 *
 * Fitting maximises a recency-weighted log-likelihood plus Gaussian priors.
 * The negative log-posterior is strictly convex, so Newton's method with a
 * backtracking line search converges reliably in a handful of steps — and the
 * Hessian it builds anyway gives a Laplace-approximation covariance for free,
 * which is where the uncertainty bars on driver ratings come from.
 */

import { Matrix, inverseSPD, solveSPD } from '../lib/linalg';

export interface PLItem {
  team: number;
  driver: number;
  /** Covariate value (ignored unless the spec uses one). */
  x: number;
}

/** One observed ranking, best first. */
export interface PLEvent {
  items: PLItem[];
  weight: number;
}

export interface PLSpec {
  nTeams: number;
  nDrivers: number;
  useCovariate: boolean;
  sdTeam: number;
  sdDriver: number;
  betaMean: number;
  sdBeta: number;
}

export interface PLFit {
  team: Float64Array;
  driver: Float64Array;
  beta: number;
  logPosterior: number;
  iterations: number;
  converged: boolean;
  /** Posterior covariance (Laplace approximation), parameter order: teams, drivers, β. */
  covariance: Matrix | null;
}

function nParams(spec: PLSpec): number {
  return spec.nTeams + spec.nDrivers + (spec.useCovariate ? 1 : 0);
}

/** Log-strength of one car under the given parameter vector. */
function strength(params: Float64Array, spec: PLSpec, item: PLItem): number {
  let s = params[item.team]! + params[spec.nTeams + item.driver]!;
  if (spec.useCovariate) s += params[spec.nTeams + spec.nDrivers]! * item.x;
  return s;
}

/**
 * Negative log-posterior, its gradient and (optionally) its Hessian.
 * Exported for the finite-difference tests.
 */
export function objective(
  params: Float64Array,
  events: readonly PLEvent[],
  spec: PLSpec,
  withHessian: boolean,
): { value: number; grad: Float64Array; hess: Matrix | null } {
  const P = nParams(spec);
  const grad = new Float64Array(P);
  const hess = withHessian ? new Matrix(P) : null;
  const betaIdx = spec.nTeams + spec.nDrivers;
  let ll = 0;

  for (const ev of events) {
    const n = ev.items.length;
    if (n < 2 || ev.weight <= 0) continue;
    const w = ev.weight;
    const s = new Float64Array(n);
    let smax = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      s[i] = strength(params, spec, ev.items[i]!);
      if (s[i]! > smax) smax = s[i]!;
    }
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) e[i] = Math.exp(s[i]! - smax);

    // Suffix sums S_k = Σ_{m ≥ k} e_m, and prefix sums over stages of 1/S and 1/S².
    const S = new Float64Array(n);
    let acc = 0;
    for (let k = n - 1; k >= 0; k--) {
      acc += e[k]!;
      S[k] = acc;
    }
    const C1 = new Float64Array(n);
    const C2 = new Float64Array(n);
    let c1 = 0;
    let c2 = 0;
    for (let k = 0; k < n; k++) {
      if (k <= n - 2) {
        c1 += 1 / S[k]!;
        c2 += 1 / (S[k]! * S[k]!);
        ll += w * (s[k]! - smax - Math.log(S[k]!));
      }
      C1[k] = c1;
      C2[k] = c2;
    }

    // Gradient of the log-likelihood with respect to each s_i, mapped to params.
    for (let i = 0; i < n; i++) {
      const gs = w * ((i <= n - 2 ? 1 : 0) - e[i]! * C1[i]!);
      const it = ev.items[i]!;
      grad[it.team]! -= gs;
      grad[spec.nTeams + it.driver]! -= gs;
      if (spec.useCovariate) grad[betaIdx]! -= gs * it.x;
    }

    if (hess) {
      // Hessian of the log-likelihood in s-space:
      //   H_ii = −e_i·C1_i + e_i²·C2_i,   H_ij = e_i·e_j·C2_min(i,j)
      // Negated (we minimise) and mapped through s = Aθ.
      for (let i = 0; i < n; i++) {
        const ii = ev.items[i]!;
        for (let j = 0; j <= i; j++) {
          const jj = ev.items[j]!;
          const k = Math.min(i, j);
          const h = i === j ? -e[i]! * C1[i]! + e[i]! * e[i]! * C2[k]! : e[i]! * e[j]! * C2[k]!;
          const v = -w * h; // contribution to the *negative* log-likelihood Hessian
          if (v === 0) continue;
          const pi = [ii.team, spec.nTeams + ii.driver];
          const pj = [jj.team, spec.nTeams + jj.driver];
          const xi = ii.x;
          const xj = jj.x;
          const addPair = (a: number, b: number, val: number) => {
            hess.add(a, b, val);
            if (i !== j) hess.add(b, a, val);
          };
          for (const a of pi) for (const b of pj) addPair(a, b, v);
          if (spec.useCovariate) {
            for (const a of pi) addPair(a, betaIdx, v * xj);
            for (const b of pj) addPair(betaIdx, b, v * xi);
            addPair(betaIdx, betaIdx, v * xi * xj);
          }
        }
      }
    }
  }

  // Gaussian priors.
  let lp = 0;
  const prior = (idx: number, mean: number, sd: number) => {
    const d = params[idx]! - mean;
    const prec = 1 / (sd * sd);
    lp -= 0.5 * prec * d * d;
    grad[idx]! += prec * d;
    if (hess) hess.add(idx, idx, prec);
  };
  for (let t = 0; t < spec.nTeams; t++) prior(t, 0, spec.sdTeam);
  for (let d = 0; d < spec.nDrivers; d++) prior(spec.nTeams + d, 0, spec.sdDriver);
  if (spec.useCovariate) prior(betaIdx, spec.betaMean, spec.sdBeta);

  return { value: -(ll + lp), grad, hess };
}

export function fitPL(
  events: readonly PLEvent[],
  spec: PLSpec,
  opts: { maxIter?: number; tol?: number; covariance?: boolean; init?: Float64Array } = {},
): PLFit {
  const P = nParams(spec);
  const maxIter = opts.maxIter ?? 60;
  const tol = opts.tol ?? 1e-7;
  let params = opts.init && opts.init.length === P ? new Float64Array(opts.init) : new Float64Array(P);
  if (spec.useCovariate && !(opts.init && opts.init.length === P)) params[P - 1] = spec.betaMean;

  let cur = objective(params, events, spec, true);
  let iterations = 0;
  let converged = false;

  for (; iterations < maxIter; iterations++) {
    let gmax = 0;
    for (let i = 0; i < P; i++) gmax = Math.max(gmax, Math.abs(cur.grad[i]!));
    if (gmax < tol) {
      converged = true;
      break;
    }
    const neg = new Float64Array(P);
    for (let i = 0; i < P; i++) neg[i] = -cur.grad[i]!;
    let step = solveSPD(cur.hess!, neg);
    if (!step) {
      // Fall back to gradient descent if the Hessian is somehow unusable.
      step = neg;
    }
    // Backtracking line search on the convex objective.
    let alpha = 1;
    let slope = 0;
    for (let i = 0; i < P; i++) slope += cur.grad[i]! * step[i]!;
    let next = params;
    let nextObj = cur;
    let accepted = false;
    for (let ls = 0; ls < 30; ls++) {
      const trial = new Float64Array(P);
      for (let i = 0; i < P; i++) trial[i] = params[i]! + alpha * step[i]!;
      const obj = objective(trial, events, spec, true);
      if (obj.value <= cur.value + 1e-4 * alpha * slope) {
        next = trial;
        nextObj = obj;
        accepted = true;
        break;
      }
      alpha *= 0.5;
    }
    if (!accepted) {
      converged = true; // no further decrease possible at machine precision
      break;
    }
    const improvement = cur.value - nextObj.value;
    params = next;
    cur = nextObj;
    if (improvement < 1e-12 * Math.max(1, Math.abs(cur.value))) {
      converged = true;
      iterations++;
      break;
    }
  }

  return {
    team: params.slice(0, spec.nTeams),
    driver: params.slice(spec.nTeams, spec.nTeams + spec.nDrivers),
    beta: spec.useCovariate ? params[P - 1]! : 0,
    logPosterior: -cur.value,
    iterations,
    converged,
    covariance: opts.covariance ? inverseSPD(cur.hess!) : null,
  };
}

/** Probability that each listed car "wins" (is chosen first) given log-strengths. */
export function firstChoiceProbabilities(s: ArrayLike<number>): Float64Array {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < s.length; i++) m = Math.max(m, s[i]!);
  const out = new Float64Array(s.length);
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    out[i] = Math.exp(s[i]! - m);
    total += out[i]!;
  }
  for (let i = 0; i < s.length; i++) out[i]! /= total;
  return out;
}

/** Exact log-probability of a full ranking (used in tests and diagnostics). */
export function rankingLogProb(sInOrder: ArrayLike<number>): number {
  const n = sInOrder.length;
  let lp = 0;
  for (let k = 0; k < n - 1; k++) {
    let m = Number.NEGATIVE_INFINITY;
    for (let j = k; j < n; j++) m = Math.max(m, sInOrder[j]!);
    let z = 0;
    for (let j = k; j < n; j++) z += Math.exp(sInOrder[j]! - m);
    lp += sInOrder[k]! - m - Math.log(z);
  }
  return lp;
}
