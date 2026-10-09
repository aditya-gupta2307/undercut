/**
 * Seeded randomness. Every simulation on the site is reproducible: the same
 * data and settings always produce the same numbers, so a forecast does not
 * flicker between renders and tests can assert exact behaviour.
 */

export type Rng = () => number;

/** mulberry32: tiny, fast, and statistically fine for Monte Carlo at this scale. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a string into a 32-bit seed (FNV-1a). */
export function seedFrom(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Standard Gumbel draw. Adding Gumbel noise to log-strengths and sorting is an
 * exact sampler for a Plackett–Luce ranking — the trick the race simulator uses.
 */
export function gumbel(rng: Rng): number {
  let u = rng();
  while (u <= 0) u = rng();
  return -Math.log(-Math.log(u));
}

/** Standard normal via Box–Muller (one value per call; the pair is not cached). */
export function normal(rng: Rng): number {
  let u = rng();
  while (u <= 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Geometric: number of Bernoulli(p) failures before the first success. */
export function geometric(rng: Rng, p: number): number {
  if (p <= 0) return Number.POSITIVE_INFINITY;
  if (p >= 1) return 0;
  let u = rng();
  while (u <= 0) u = rng();
  return Math.floor(Math.log(u) / Math.log(1 - p));
}
