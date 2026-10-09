/**
 * Model hyperparameters. Defaults were chosen to be sensible in a season with
 * a regulation reset (2026): recent races dominate, last season counts for a
 * fraction, and the priors keep a team with two races of data from being
 * declared a world-beater. The Model Lab page lets anyone change them and
 * watch the walk-forward score respond.
 */

export interface ModelConfig {
  /** Weight halves every this many Grand Prix weekends. Infinity = no decay. */
  halfLifeRaces: number;
  /** Multiplier applied per season of age (0.3 = last season counts 30%). */
  priorSeasonWeight: number;
  /** Sprint results count this much relative to a Grand Prix. */
  sprintWeight: number;
  /** Prior standard deviations of car and driver log-strengths. */
  sdTeam: number;
  sdDriver: number;
  /** Prior for the grid-position effect β (s += β · −log(grid)). */
  betaMean: number;
  sdBeta: number;
  /** Pseudo-starts behind the DNF-rate prior. */
  dnfPriorStarts: number;
  /** Monte Carlo draws per forecast. */
  sims: number;
}

export const DEFAULT_CONFIG: ModelConfig = {
  halfLifeRaces: 6,
  priorSeasonWeight: 0.35,
  sprintWeight: 0.5,
  sdTeam: 1.5,
  sdDriver: 0.6,
  betaMean: 0.6,
  sdBeta: 0.6,
  dnfPriorStarts: 12,
  sims: 20000,
};

/** Points tables. Fastest-lap bonus applied 2019–2024 (top-10 finishers only). */
export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];

export function fastestLapPointApplies(season: number): boolean {
  return season >= 2019 && season <= 2024;
}
