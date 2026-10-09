/**
 * The undercut, as a toy: lap-by-lap gap between a car that pits first and
 * the rival it is chasing, until the rival has stopped too. Used by the Learn
 * page's simulator.
 */

export interface UndercutInput {
  /** Gap to the car ahead when the chaser pits, seconds. */
  gap: number;
  /** How much faster new tyres are than the rival's worn ones, s/lap. */
  fresh: number;
  /** How much more the rival's old tyres lose with each extra lap, s/lap. */
  wear: number;
  /** Time lost on an out-lap while new tyres come up to temperature, s. */
  warmup: number;
  /** Laps the chaser runs on new tyres before the rival reacts. */
  laps: number;
  /** Chaser's stop slower (+) or faster (−) than the rival's, s. */
  stopDelta: number;
  /** The chaser rejoins behind slower traffic on the out-lap. */
  traffic: boolean;
}

export const TRAFFIC_PENALTY = 1.2;

/** Gap after each step (positive = chaser still behind). */
export function undercutTrace(i: UndercutInput): { lap: number; gap: number; note: string }[] {
  const out = [{ lap: 0, gap: i.gap, note: 'Chaser pits' }];
  let gap = i.gap + i.stopDelta;
  for (let k = 1; k <= i.laps; k++) {
    // New tyres beat the rival's worn ones, minus warm-up on the first lap (and traffic, if any).
    const gain = i.fresh + i.wear * (k - 1) - (k === 1 ? i.warmup + (i.traffic ? TRAFFIC_PENALTY : 0) : 0);
    gap -= gain;
    out.push({ lap: k, gap, note: k === 1 ? 'Out-lap on new tyres' : 'Rival still on old tyres' });
  }
  // The rival stops; on their cold out-lap the chaser's warmed-up tyres gain again.
  gap -= i.warmup;
  out.push({ lap: i.laps + 1, gap, note: 'Rival’s out-lap' });
  return out;
}
