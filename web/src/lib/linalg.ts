/**
 * Dense linear algebra for small symmetric positive-definite systems.
 *
 * The models here have at most a few dozen parameters, so a straightforward
 * Cholesky factorisation is both exact and fast. Matrices are row-major
 * Float64Arrays of size n*n.
 */

export class Matrix {
  readonly n: number;
  readonly data: Float64Array;

  constructor(n: number, data?: Float64Array) {
    this.n = n;
    this.data = data ?? new Float64Array(n * n);
  }

  get(i: number, j: number): number {
    return this.data[i * this.n + j]!;
  }

  set(i: number, j: number, v: number): void {
    this.data[i * this.n + j] = v;
  }

  add(i: number, j: number, v: number): void {
    this.data[i * this.n + j]! += v;
  }

  clone(): Matrix {
    return new Matrix(this.n, new Float64Array(this.data));
  }
}

/**
 * Cholesky factor L (lower triangular, A = L Lᵀ). Returns null when A is not
 * numerically positive definite, so callers can add a ridge and retry.
 */
export function cholesky(a: Matrix): Matrix | null {
  const n = a.n;
  const l = new Matrix(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = a.get(i, j);
      for (let k = 0; k < j; k++) s -= l.get(i, k) * l.get(j, k);
      if (i === j) {
        if (!(s > 1e-12)) return null;
        l.set(i, i, Math.sqrt(s));
      } else {
        l.set(i, j, s / l.get(j, j));
      }
    }
  }
  return l;
}

/** Solve (L Lᵀ) x = b given the Cholesky factor L. */
export function choleskySolve(l: Matrix, b: ArrayLike<number>): Float64Array {
  const n = l.n;
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i]!;
    for (let k = 0; k < i; k++) s -= l.get(i, k) * y[k]!;
    y[i] = s / l.get(i, i);
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i]!;
    for (let k = i + 1; k < n; k++) s -= l.get(k, i) * x[k]!;
    x[i] = s / l.get(i, i);
  }
  return x;
}

/** Solve A x = b for symmetric positive-definite A, adding a tiny ridge if needed. */
export function solveSPD(a: Matrix, b: ArrayLike<number>): Float64Array | null {
  let ridge = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const m = ridge > 0 ? withRidge(a, ridge) : a;
    const l = cholesky(m);
    if (l) return choleskySolve(l, b);
    ridge = ridge === 0 ? 1e-9 : ridge * 100;
  }
  return null;
}

/** Inverse of a symmetric positive-definite matrix (for posterior covariances). */
export function inverseSPD(a: Matrix): Matrix | null {
  const l = cholesky(a) ?? cholesky(withRidge(a, 1e-8));
  if (!l) return null;
  const n = a.n;
  const inv = new Matrix(n);
  const e = new Float64Array(n);
  for (let j = 0; j < n; j++) {
    e.fill(0);
    e[j] = 1;
    const col = choleskySolve(l, e);
    for (let i = 0; i < n; i++) inv.set(i, j, col[i]!);
  }
  return inv;
}

function withRidge(a: Matrix, ridge: number): Matrix {
  const m = a.clone();
  for (let i = 0; i < m.n; i++) m.add(i, i, ridge);
  return m;
}

/**
 * Solve the least-squares problem min ||X b - y||² + ridge·||b||² via the
 * normal equations. X is given as rows of length p. Used by the tyre model.
 */
export function leastSquares(
  rows: readonly ArrayLike<number>[],
  y: readonly number[],
  p: number,
  ridge = 1e-6,
  weights?: readonly number[],
): Float64Array | null {
  const xtx = new Matrix(p);
  const xty = new Float64Array(p);
  for (let r = 0; r < rows.length; r++) {
    const x = rows[r]!;
    const w = weights ? weights[r]! : 1;
    for (let i = 0; i < p; i++) {
      const xi = x[i]!;
      if (xi === 0) continue;
      xty[i]! += w * xi * y[r]!;
      for (let j = 0; j < p; j++) {
        const xj = x[j]!;
        if (xj !== 0) xtx.add(i, j, w * xi * xj);
      }
    }
  }
  for (let i = 0; i < p; i++) xtx.add(i, i, ridge);
  return solveSPD(xtx, xty);
}
