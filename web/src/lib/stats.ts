/** Small numeric helpers. Everything here is pure and unit-tested. */

export function sum(xs: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s;
}

export function mean(xs: ArrayLike<number>): number {
  return xs.length === 0 ? Number.NaN : sum(xs) / xs.length;
}

/** Median of a copy; NaN for an empty input. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Linear-interpolated quantile, q in [0, 1]. */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo]! + (s[hi]! - s[lo]!) * (pos - lo);
}

/** Median absolute deviation, scaled to be consistent with a normal SD. */
export function mad(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const m = median(xs);
  return 1.4826 * median(xs.map((x) => Math.abs(x - m)));
}

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

export function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** log(sum(exp(xs))) without overflow. */
export function logSumExp(xs: ArrayLike<number>): number {
  let m = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < xs.length; i++) m = Math.max(m, xs[i]!);
  if (!Number.isFinite(m)) return m;
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += Math.exp(xs[i]! - m);
  return m + Math.log(s);
}

/**
 * Wilson score interval for a binomial proportion. Used for the error bars on
 * the calibration chart, where some bins hold only a handful of races.
 */
export function wilson(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** Ordinary least squares slope/intercept of y on x. */
export function linearFit(xs: readonly number[], ys: readonly number[]): { slope: number; intercept: number } | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < n; i++) {
    sx += xs[i]!;
    sy += ys[i]!;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - mx;
    sxx += dx * dx;
    sxy += dx * (ys[i]! - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Round to a fixed number of decimals, avoiding "-0". */
export function round(x: number, decimals = 0): number {
  const f = 10 ** decimals;
  const r = Math.round(x * f) / f;
  return Object.is(r, -0) ? 0 : r;
}
