/**
 * Championship simulator.
 *
 * Starts from the real points table (built from every published result, so
 * the simulation and the standings can never disagree), then plays out every
 * remaining sprint and Grand Prix thousands of times with the fitted models.
 * Ties are broken the way the FIA does it — most wins, then most second
 * places, and so on — using real counts plus simulated ones.
 */

import { gumbel, mulberry32 } from '../lib/rng';
import { quantile } from '../lib/stats';
import type { Season } from '../data/types';
import { RACE_POINTS, SPRINT_POINTS, fastestLapPointApplies } from './config';
import type { Entrant } from './dataset';
import { entrantParams, type FittedModels } from './forecast';

export interface TallyRow {
  driverId: string;
  points: number;
  /** Grand Prix finishes by position: [wins, seconds, thirds, ...]. */
  countback: number[];
  teamIds: string[];
}

export interface Tally {
  drivers: TallyRow[];
  teams: { teamId: string; points: number; wins: number }[];
}

/** Points and countback from every published GP and sprint result. */
export function tallyFromResults(season: Season, uptoRound = Number.POSITIVE_INFINITY): Tally {
  const drivers = new Map<string, TallyRow>();
  const teams = new Map<string, { teamId: string; points: number; wins: number }>();
  const row = (id: string) => {
    let r = drivers.get(id);
    if (!r) {
      r = { driverId: id, points: 0, countback: new Array(30).fill(0), teamIds: [] };
      drivers.set(id, r);
    }
    return r;
  };
  const team = (id: string) => {
    let t = teams.get(id);
    if (!t) {
      t = { teamId: id, points: 0, wins: 0 };
      teams.set(id, t);
    }
    return t;
  };
  for (const ev of season.events) {
    if (ev.round > uptoRound) continue;
    for (const r of season.sprints[ev.round] ?? []) {
      const d = row(r.driverId);
      d.points += r.points;
      if (!d.teamIds.includes(r.teamId)) d.teamIds.push(r.teamId);
      team(r.teamId).points += r.points;
    }
    for (const r of season.results[ev.round] ?? []) {
      const d = row(r.driverId);
      d.points += r.points;
      if (!d.teamIds.includes(r.teamId)) d.teamIds.push(r.teamId);
      if (r.position !== null && r.position <= 30) d.countback[r.position - 1]!++;
      const t = team(r.teamId);
      t.points += r.points;
      if (r.position === 1) t.wins++;
    }
  }
  const byStanding = (a: TallyRow, b: TallyRow) => b.points - a.points || compareCountback(b.countback, a.countback);
  return {
    drivers: [...drivers.values()].sort(byStanding),
    teams: [...teams.values()].sort((a, b) => b.points - a.points || b.wins - a.wins),
  };
}

/** >0 when a has the better countback. */
export function compareCountback(a: ArrayLike<number>, b: ArrayLike<number>): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface RemainingEvent {
  round: number;
  name: string;
  kind: 'sprint' | 'race';
  maxPoints: number;
}

export function remainingEvents(season: Season): RemainingEvent[] {
  const out: RemainingEvent[] = [];
  const fl = fastestLapPointApplies(season.year) ? 1 : 0;
  for (const ev of season.events) {
    if (ev.hasSprint && !season.sprints[ev.round]?.length && !season.results[ev.round]?.length) {
      out.push({ round: ev.round, name: ev.name, kind: 'sprint', maxPoints: SPRINT_POINTS[0]! });
    }
    if (!season.results[ev.round]?.length) {
      out.push({ round: ev.round, name: ev.name, kind: 'race', maxPoints: RACE_POINTS[0]! + fl });
    }
  }
  return out;
}

export interface MathStatus {
  /** Drivers who can no longer mathematically win. */
  eliminated: Set<string>;
  /** The champion, if already decided. */
  clinched: string | null;
  /** Earliest remaining event (index into `remaining`) after which the leader could clinch, or null. */
  earliestClinch: number | null;
  maxRemaining: number;
}

export function mathematicalStatus(tally: Tally, remaining: readonly RemainingEvent[]): MathStatus {
  const maxRemaining = remaining.reduce((s, e) => s + e.maxPoints, 0);
  const rows = tally.drivers;
  const eliminated = new Set<string>();
  const top = rows[0]?.points ?? 0;
  for (const r of rows) if (r.points + maxRemaining < top) eliminated.add(r.driverId);
  const leader = rows[0];
  let clinched: string | null = null;
  let earliestClinch: number | null = null;
  if (leader) {
    const rivalsBest = Math.max(0, ...rows.slice(1).map((r) => r.points));
    if (leader.points > rivalsBest + maxRemaining) clinched = leader.driverId;
    else {
      let lead = leader.points;
      let left = maxRemaining;
      for (let k = 0; k < remaining.length; k++) {
        lead += remaining[k]!.maxPoints;
        left -= remaining[k]!.maxPoints;
        if (lead > rivalsBest + left) {
          earliestClinch = k;
          break;
        }
      }
    }
  }
  return { eliminated, clinched, earliestClinch, maxRemaining };
}

export interface TitleOdds {
  driverId: string;
  teamId: string;
  pChampion: number;
  pTop3: number;
  expectedPoints: number;
  p10: number;
  p50: number;
  p90: number;
  currentPoints: number;
}

export interface TeamOdds {
  teamId: string;
  pChampion: number;
  expectedPoints: number;
  currentPoints: number;
}

export interface ChampionshipResult {
  drivers: TitleOdds[];
  teams: TeamOdds[];
  sims: number;
  remaining: RemainingEvent[];
}

export interface ChampionshipOptions {
  sims?: number;
  seed?: number;
  /** What-if: fix the first finishers of a remaining event (index into remaining events). */
  fixed?: ReadonlyMap<number, readonly string[]>;
}

export function simulateChampionship(
  season: Season,
  models: FittedModels,
  entrants: readonly Entrant[],
  opts: ChampionshipOptions = {},
): ChampionshipResult {
  const sims = opts.sims ?? 10_000;
  const rng = mulberry32(opts.seed ?? 0xc4a3);
  const tally = tallyFromResults(season);
  const remaining = remainingEvents(season);
  const n = entrants.length;
  const raceP = entrantParams(models, entrants, false);
  const sprintP = entrantParams(models, entrants, true);
  const beta = models.race.beta;
  const fl = fastestLapPointApplies(season.year);

  // Starting position for everyone the simulation knows about.
  const idxOf = new Map(entrants.map((e, i) => [e.driverId, i]));
  const basePoints = new Float64Array(n);
  const baseCount = Array.from({ length: n }, () => new Float64Array(3));
  for (const r of tally.drivers) {
    const i = idxOf.get(r.driverId);
    if (i === undefined) continue;
    basePoints[i] = r.points;
    for (let k = 0; k < 3; k++) baseCount[i]![k] = r.countback[k] ?? 0;
  }
  // Drivers no longer entered (replaced mid-season) still hold points and can, in principle, be champion.
  const ghosts = tally.drivers.filter((r) => !idxOf.has(r.driverId));

  const teamKeys = [...new Set([...entrants.map((e) => e.teamId), ...tally.teams.map((t) => t.teamId)])];
  const teamIdx = new Map(teamKeys.map((t, i) => [t, i]));
  const baseTeam = new Float64Array(teamKeys.length);
  for (const t of tally.teams) baseTeam[teamIdx.get(t.teamId)!] = t.points;
  const entrantTeam = entrants.map((e) => teamIdx.get(e.teamId)!);

  const champ = new Float64Array(n);
  const ghostChamp = new Float64Array(ghosts.length);
  const top3 = new Float64Array(n);
  const finals = Array.from({ length: n }, () => new Float64Array(sims));
  const teamChamp = new Float64Array(teamKeys.length);
  const teamSum = new Float64Array(teamKeys.length);

  const pts = new Float64Array(n);
  const cnt = Array.from({ length: n }, () => new Float64Array(3));
  const tPts = new Float64Array(teamKeys.length);
  const key = new Float64Array(n);
  const s = new Float64Array(n);
  const idx: number[] = Array.from({ length: n }, (_, i) => i);

  for (let sim = 0; sim < sims; sim++) {
    pts.set(basePoints);
    for (let i = 0; i < n; i++) cnt[i]!.set(baseCount[i]!);
    tPts.set(baseTeam);

    remaining.forEach((ev, evIdx) => {
      const P = ev.kind === 'sprint' ? sprintP : raceP;
      const table = ev.kind === 'sprint' ? SPRINT_POINTS : RACE_POINTS;
      // Qualifying -> grid.
      for (let i = 0; i < n; i++) key[i] = P[i]!.qualiBase + gumbel(rng);
      idx.sort((a, b) => key[b]! - key[a]!);
      for (let slot = 0; slot < n; slot++) s[idx[slot]!] = P[idx[slot]!]!.raceBase + beta * -Math.log(slot + 1);

      const forced = opts.fixed?.get(evIdx) ?? [];
      const forcedIdx = forced.map((id) => idxOf.get(id)).filter((i): i is number => i !== undefined);
      const forcedSet = new Set(forcedIdx);
      const finishers: number[] = [];
      for (let i = 0; i < n; i++) {
        if (forcedSet.has(i)) continue;
        if (rng() >= P[i]!.dnf) finishers.push(i);
      }
      for (const i of finishers) key[i] = s[i]! + gumbel(rng);
      finishers.sort((a, b) => key[b]! - key[a]!);
      const order = [...forcedIdx, ...finishers];

      for (let pos = 0; pos < order.length; pos++) {
        const i = order[pos]!;
        const p = table[pos] ?? 0;
        pts[i]! += p;
        tPts[entrantTeam[i]!]! += p;
        if (ev.kind === 'race' && pos < 3) cnt[i]![pos]!++;
      }
      if (ev.kind === 'race' && fl) {
        // Fastest-lap point: approximate by giving it to a random top-10 finisher weighted toward the front.
        const top10 = order.slice(0, 10);
        if (top10.length) {
          const i = top10[Math.min(top10.length - 1, Math.floor(rng() * rng() * top10.length))]!;
          pts[i]! += 1;
          tPts[entrantTeam[i]!]! += 1;
        }
      }
    });

    // Champion with countback.
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (best < 0) {
        best = i;
        continue;
      }
      const d = pts[i]! - pts[best]!;
      if (d > 0 || (d === 0 && compareCountback(cnt[i]!, cnt[best]!) > 0)) best = i;
    }
    // A ghost (no longer racing) can only win if nobody passes their frozen total.
    let ghostWinner = -1;
    for (let g = 0; g < ghosts.length; g++) {
      if (ghosts[g]!.points > (best >= 0 ? pts[best]! : -1)) {
        if (ghostWinner < 0 || ghosts[g]!.points > ghosts[ghostWinner]!.points) ghostWinner = g;
      }
    }
    if (ghostWinner >= 0) ghostChamp[ghostWinner]!++;
    else if (best >= 0) champ[best]!++;

    // Top three (by points, countback) for each entrant.
    const ranked = [...idx].sort((a, b) => pts[b]! - pts[a]! || compareCountback(cnt[b]!, cnt[a]!));
    for (let k = 0; k < Math.min(3, ranked.length); k++) top3[ranked[k]!]!++;
    for (let i = 0; i < n; i++) finals[i]![sim] = pts[i]!;

    let bestTeam = 0;
    for (let t = 0; t < teamKeys.length; t++) {
      teamSum[t]! += tPts[t]!;
      if (tPts[t]! > tPts[bestTeam]!) bestTeam = t;
    }
    teamChamp[bestTeam]!++;
  }

  const drivers: TitleOdds[] = entrants.map((e, i) => {
    const f = Array.from(finals[i]!);
    return {
      driverId: e.driverId,
      teamId: e.teamId,
      pChampion: champ[i]! / sims,
      pTop3: top3[i]! / sims,
      expectedPoints: f.reduce((a, b) => a + b, 0) / sims,
      p10: quantile(f, 0.1),
      p50: quantile(f, 0.5),
      p90: quantile(f, 0.9),
      currentPoints: basePoints[i]!,
    };
  });
  ghosts.forEach((g, k) => {
    if (ghostChamp[k]! > 0) {
      drivers.push({
        driverId: g.driverId,
        teamId: g.teamIds[g.teamIds.length - 1] ?? 'unknown',
        pChampion: ghostChamp[k]! / sims,
        pTop3: 0,
        expectedPoints: g.points,
        p10: g.points,
        p50: g.points,
        p90: g.points,
        currentPoints: g.points,
      });
    }
  });
  drivers.sort((a, b) => b.pChampion - a.pChampion || b.expectedPoints - a.expectedPoints);

  const teams: TeamOdds[] = teamKeys
    .map((t, i) => ({ teamId: t, pChampion: teamChamp[i]! / sims, expectedPoints: teamSum[i]! / sims, currentPoints: baseTeam[i]! }))
    .sort((a, b) => b.pChampion - a.pChampion || b.expectedPoints - a.expectedPoints);

  return { drivers, teams, sims, remaining };
}
