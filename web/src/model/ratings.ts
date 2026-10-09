/**
 * Driver vs car.
 *
 * The same Plackett–Luce decomposition, fitted without the grid covariate so
 * that θ (car) and δ (driver) describe raw pace. Teammates share θ, so each
 * driver's δ is identified by beating — or losing to — the other person in
 * the same machinery; drivers who changed teams link the cars together.
 * Uncertainty comes from the Laplace approximation (the inverse Hessian).
 *
 * Alongside the model sits the plain evidence it is fitted on: qualifying and
 * race head-to-heads between teammates, and the median qualifying gap.
 */

import { logistic, median } from '../lib/stats';
import type { Season } from '../data/types';
import { lineageRoot } from '../data/teams';
import type { ModelConfig } from './config';
import { buildTrainingSet } from './dataset';
import { fitPL } from './plackettLuce';
import { qualiSpec } from './forecast';

export interface Rating {
  id: string;
  mean: number;
  sd: number;
}

export interface DriverRating extends Rating {
  teamId: string;
  /** Chance of beating an average driver in identical machinery. */
  vsTeamAverage: number;
  /** Car + driver combined. */
  total: number;
}

export interface RatingsResult {
  kind: 'race' | 'quali';
  teams: Rating[];
  drivers: DriverRating[];
}

export function fitRatings(
  seasons: readonly Season[],
  targetSeason: number,
  cutoff: number,
  config: ModelConfig,
  currentTeams: Record<string, string>,
  kind: 'race' | 'quali',
): RatingsResult {
  const ts = buildTrainingSet(seasons, cutoff, targetSeason, config);
  const spec = qualiSpec(ts.index, config); // no covariate in either case
  const fit = fitPL(kind === 'race' ? ts.race : ts.quali, spec, { covariance: true });
  const sd = (i: number) => (fit.covariance ? Math.sqrt(Math.max(0, fit.covariance.get(i, i))) : Number.NaN);

  const teamRatings: Rating[] = ts.index.teamKeys.map((key, t) => ({ id: key, mean: fit.team[t]!, sd: sd(t) }));
  const drivers: DriverRating[] = [];
  ts.index.driverIds.forEach((id, d) => {
    const teamId = currentTeams[id];
    if (!teamId) return; // only drivers in this season's field
    const t = ts.index.teamIndex.get(lineageRoot(teamId));
    const mean = fit.driver[d]!;
    drivers.push({
      id,
      teamId,
      mean,
      sd: sd(ts.index.teamKeys.length + d),
      vsTeamAverage: logistic(mean),
      total: mean + (t !== undefined ? fit.team[t]! : 0),
    });
  });
  drivers.sort((a, b) => b.mean - a.mean);
  return { kind, teams: teamRatings.sort((a, b) => b.mean - a.mean), drivers };
}

export interface TeammateDuel {
  teamId: string;
  a: string;
  b: string;
  qualiA: number;
  qualiB: number;
  raceA: number;
  raceB: number;
  /** Median qualifying gap, % of the faster lap; positive = a slower. */
  medianGapPct: number | null;
  gaps: number;
  pointsA: number;
  pointsB: number;
}

/** Head-to-head records for every pair of drivers who shared a car in the same round. */
export function teammateDuels(season: Season): TeammateDuel[] {
  const duels = new Map<string, TeammateDuel>();
  const get = (teamId: string, x: string, y: string) => {
    const [a, b] = [x, y].sort();
    const key = `${teamId}|${a}|${b}`;
    let d = duels.get(key);
    if (!d) {
      d = { teamId, a: a!, b: b!, qualiA: 0, qualiB: 0, raceA: 0, raceB: 0, medianGapPct: null, gaps: 0, pointsA: 0, pointsB: 0 };
      duels.set(key, d);
    }
    return d;
  };
  const gapLists = new Map<string, number[]>();

  for (const ev of season.events) {
    const q = season.qualifying[ev.round] ?? [];
    const res = season.results[ev.round] ?? [];
    const sp = season.sprints[ev.round] ?? [];
    const byTeam = new Map<string, string[]>();
    for (const r of res.length ? res : q) {
      const list = byTeam.get(r.teamId) ?? [];
      if (!list.includes(r.driverId)) list.push(r.driverId);
      byTeam.set(r.teamId, list);
    }
    for (const [teamId, ids] of byTeam) {
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const d = get(teamId, ids[i]!, ids[j]!);
          const qa = q.find((x) => x.driverId === d.a);
          const qb = q.find((x) => x.driverId === d.b);
          if (qa && qb) {
            if (qa.position < qb.position) d.qualiA++;
            else d.qualiB++;
            // Compare the furthest session both reached.
            const pick = (x: typeof qa) => [x.q3Ms, x.q2Ms, x.q1Ms];
            const ta = pick(qa);
            const tb = pick(qb);
            for (let s = 0; s < 3; s++) {
              if (ta[s] && tb[s]) {
                const pct = ((ta[s]! - tb[s]!) / Math.min(ta[s]!, tb[s]!)) * 100;
                const key = `${teamId}|${d.a}|${d.b}`;
                const list = gapLists.get(key) ?? [];
                list.push(pct);
                gapLists.set(key, list);
                break;
              }
            }
          }
          const ra = res.find((x) => x.driverId === d.a);
          const rb = res.find((x) => x.driverId === d.b);
          if (ra && rb && ra.finish === 'finished' && rb.finish === 'finished' && ra.position && rb.position) {
            if (ra.position < rb.position) d.raceA++;
            else d.raceB++;
          }
          d.pointsA += (ra?.points ?? 0) + (sp.find((x) => x.driverId === d.a)?.points ?? 0);
          d.pointsB += (rb?.points ?? 0) + (sp.find((x) => x.driverId === d.b)?.points ?? 0);
        }
      }
    }
  }
  for (const [key, d] of duels) {
    const list = gapLists.get(key) ?? [];
    d.gaps = list.length;
    d.medianGapPct = list.length ? median(list) : null;
  }
  return [...duels.values()].filter((d) => d.qualiA + d.qualiB > 0);
}
