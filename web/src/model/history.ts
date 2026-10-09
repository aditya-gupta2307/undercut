/**
 * Title odds through the season: re-run the championship simulation as it
 * would have looked after every round, using only what was known then.
 * Each step truncates the season to that round, refits the models with a
 * matching cutoff, and simulates the rest of the year.
 */

import type { Season } from '../data/types';
import { raceTime } from '../data/season';
import type { ModelConfig } from './config';
import { fitModels } from './forecast';
import { simulateChampionship } from './championship';

/** The season exactly as it stood after `round` (0 = before the first race). */
export function seasonUpTo(season: Season, round: number): Season {
  const keep = <T>(rec: Record<number, T>): Record<number, T> => {
    const out: Record<number, T> = {};
    for (const [k, v] of Object.entries(rec)) if (Number(k) <= round) out[Number(k)] = v;
    return out;
  };
  return {
    ...season,
    results: keep(season.results),
    sprints: keep(season.sprints),
    qualifying: keep(season.qualifying),
    driverStandings: [],
    teamStandings: [],
    standingsRound: round > 0 ? round : null,
  };
}

export interface TitleHistoryPoint {
  /** Round just completed (0 = pre-season). */
  round: number;
  odds: Map<string, number>;
  teamOdds: Map<string, number>;
}

export interface TitleHistoryOptions {
  sims?: number;
  onProgress?: (done: number, total: number) => void;
  cancelled?: () => boolean;
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function titleOddsHistory(
  current: Season,
  previous: Season | null,
  config: ModelConfig,
  opts: TitleHistoryOptions = {},
): Promise<TitleHistoryPoint[] | null> {
  const completed = current.events.filter((e) => current.results[e.round]?.length).map((e) => e.round);
  if (completed.length === 0) return [];
  const first = completed[0]!;
  const steps = previous ? [0, ...completed] : completed;
  const out: TitleHistoryPoint[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (opts.cancelled?.()) return null;
    const round = steps[i]!;
    const truncated = seasonUpTo(current, round);
    // The entry list as of that round: its race (or the opener, before the season).
    const listRound = round === 0 ? first : round;
    const entrants = current.results[listRound]!.map((r) => ({ driverId: r.driverId, teamId: r.teamId }));
    const event = current.events.find((e) => e.round === (round === 0 ? first : round))!;
    const cutoff = round === 0 ? raceTime(event) - 7 * 86_400_000 : raceTime(event) + 6 * 3_600_000;
    const models = fitModels(previous ? [previous, truncated] : [truncated], cutoff, current.year, entrants, config);
    const res = simulateChampionship(truncated, models, entrants, { sims: opts.sims ?? 2500, seed: current.year * 100 + round });
    out.push({
      round,
      odds: new Map(res.drivers.map((d) => [d.driverId, d.pChampion])),
      teamOdds: new Map(res.teams.map((t) => [t.teamId, t.pChampion])),
    });
    opts.onProgress?.(i + 1, steps.length);
    await tick();
  }
  return out;
}
