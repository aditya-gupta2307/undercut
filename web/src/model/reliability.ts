/**
 * Reliability: how likely each car is to fail to finish.
 *
 * A two-level beta-binomial shrinkage. Each team's weighted DNF rate is pulled
 * toward the whole field's rate, and each driver's toward their team's. A
 * driver with two retirements in three starts is not suddenly given a 67%
 * failure rate.
 */

import { clamp } from '../lib/stats';
import type { StartRecord } from './dataset';

export interface Reliability {
  globalRate: number;
  teamRate: Float64Array;
  driverDnf: Float64Array;
  driverStarts: Float64Array;
  driverPriorStarts: number;
}

export function fitReliability(starts: readonly StartRecord[], nTeams: number, nDrivers: number, priorStarts: number): Reliability {
  let w = 0;
  let d = 0;
  const teamW = new Float64Array(nTeams);
  const teamD = new Float64Array(nTeams);
  const driverStarts = new Float64Array(nDrivers);
  const driverDnf = new Float64Array(nDrivers);
  for (const s of starts) {
    w += s.weight;
    teamW[s.team]! += s.weight;
    driverStarts[s.driver]! += s.weight;
    if (s.dnf) {
      d += s.weight;
      teamD[s.team]! += s.weight;
      driverDnf[s.driver]! += s.weight;
    }
  }
  // Modern F1 retires roughly one car in ten; use that until data says otherwise.
  const globalRate = w > 0 ? clamp((d + 0.1 * priorStarts) / (w + priorStarts), 0.02, 0.35) : 0.1;
  const teamRate = new Float64Array(nTeams);
  for (let t = 0; t < nTeams; t++) {
    teamRate[t] = (priorStarts * globalRate + teamD[t]!) / (priorStarts + teamW[t]!);
  }
  return { globalRate, teamRate, driverDnf, driverStarts, driverPriorStarts: priorStarts / 2 };
}

/** DNF probability for a driver racing for the given team in a full Grand Prix. */
export function dnfProbability(rel: Reliability, team: number, driver: number): number {
  const teamRate = rel.teamRate[team] ?? rel.globalRate;
  const k = rel.driverPriorStarts;
  const p = (k * teamRate + (rel.driverDnf[driver] ?? 0)) / (k + (rel.driverStarts[driver] ?? 0));
  return clamp(p, 0.005, 0.6);
}
