/** Scoring for the "Beat the model" podium game. */

import type { DriverForecast } from './forecast';

/** 10 for each exact podium slot, 4 for a podium finisher in the wrong slot, +10 for a perfect podium. */
export function scorePodium(pick: readonly string[], actual: readonly string[]): number {
  let score = 0;
  let exact = 0;
  const podium = actual.slice(0, 3);
  pick.slice(0, 3).forEach((id, i) => {
    if (podium[i] === id) {
      score += 10;
      exact++;
    } else if (podium.includes(id)) score += 4;
  });
  if (exact === 3) score += 10;
  return score;
}

/** The model's single most likely podium: greedy by position probability. */
export function modelPodium(forecast: readonly DriverForecast[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (let pos = 0; pos < 3; pos++) {
    let best: DriverForecast | null = null;
    for (const f of forecast) {
      if (taken.has(f.driverId)) continue;
      if (!best || (f.positionProbs[pos] ?? 0) > (best.positionProbs[pos] ?? 0)) best = f;
    }
    if (!best) break;
    taken.add(best.driverId);
    out.push(best.driverId);
  }
  return out;
}
