/**
 * Turns seasons of results into training data for the ranking models,
 * respecting a cutoff time so that nothing from the future can leak into a
 * forecast. The walk-forward backtest relies on that guarantee: a forecast
 * for round 9 is fitted only on sessions that had finished before round 9's
 * lights went out.
 */

import { lineageRoot } from '../data/teams';
import { raceTime } from '../data/season';
import type { QualiRow, RaceEvent, ResultRow, Season } from '../data/types';
import type { ModelConfig } from './config';
import type { PLEvent, PLItem } from './plackettLuce';

export interface ModelIndex {
  driverIds: string[];
  driverIndex: Map<string, number>;
  /** Team lineage roots (see data/teams.ts). */
  teamKeys: string[];
  teamIndex: Map<string, number>;
}

export interface StartRecord {
  team: number;
  driver: number;
  dnf: boolean;
  weight: number;
}

export interface TrainingSet {
  index: ModelIndex;
  /** Grand Prix and sprint finishing orders, with x = −log(grid). */
  race: PLEvent[];
  quali: PLEvent[];
  /** Grand Prix starts, for the reliability model. */
  starts: StartRecord[];
  /** Number of distinct weekends that contributed anything. */
  weekends: number;
}

export interface Entrant {
  driverId: string;
  teamId: string;
}

/** Pit-lane starts (grid 0) and unknown grids are treated as starting behind the field. */
export function gridCovariate(grid: number | null, fieldSize: number): number {
  const g = grid === null || grid <= 0 ? fieldSize + 1 : grid;
  return -Math.log(g);
}

export function sprintTime(e: RaceEvent): number {
  return e.sessions.sprint ?? raceTime(e) - 86_400_000;
}

export function qualiTime(e: RaceEvent): number {
  return e.sessions.quali ?? raceTime(e) - 86_400_000;
}

interface WeekendData {
  event: RaceEvent;
  gp?: ResultRow[];
  sprint?: ResultRow[];
  quali?: QualiRow[];
}

export function buildTrainingSet(
  seasons: readonly Season[],
  cutoff: number,
  targetSeason: number,
  config: ModelConfig,
  entrants: readonly Entrant[] = [],
): TrainingSet {
  const weekends: WeekendData[] = [];
  for (const season of seasons) {
    for (const event of season.events) {
      weekends.push({
        event,
        gp: season.results[event.round],
        sprint: season.sprints[event.round],
        quali: season.qualifying[event.round],
      });
    }
  }
  weekends.sort((a, b) => raceTime(a.event) - raceTime(b.event));

  // Age of a weekend = how many completed Grands Prix lie between it and the cutoff.
  const pastRaceTimes = weekends
    .filter((w) => w.gp?.length && raceTime(w.event) < cutoff)
    .map((w) => raceTime(w.event));
  const ageOf = (w: WeekendData) => {
    const t = raceTime(w.event);
    let n = 0;
    for (const pt of pastRaceTimes) if (pt > t) n++;
    return n;
  };
  const weightOf = (w: WeekendData, kind: 'gp' | 'sprint' | 'quali') => {
    const age = ageOf(w);
    const decay = Number.isFinite(config.halfLifeRaces) && config.halfLifeRaces > 0 ? 0.5 ** (age / config.halfLifeRaces) : 1;
    const seasonsBack = Math.max(0, targetSeason - w.event.season);
    const seasonFactor = config.priorSeasonWeight ** seasonsBack;
    const kindFactor = kind === 'sprint' ? config.sprintWeight : 1;
    return decay * seasonFactor * kindFactor;
  };

  const driverIds: string[] = [];
  const driverIndex = new Map<string, number>();
  const teamKeys: string[] = [];
  const teamIndex = new Map<string, number>();
  const driverIdx = (id: string) => {
    let i = driverIndex.get(id);
    if (i === undefined) {
      i = driverIds.length;
      driverIds.push(id);
      driverIndex.set(id, i);
    }
    return i;
  };
  const teamIdx = (teamId: string) => {
    const key = lineageRoot(teamId);
    let i = teamIndex.get(key);
    if (i === undefined) {
      i = teamKeys.length;
      teamKeys.push(key);
      teamIndex.set(key, i);
    }
    return i;
  };

  const race: PLEvent[] = [];
  const quali: PLEvent[] = [];
  const starts: StartRecord[] = [];
  const used = new Set<string>();

  const finishingOrder = (rows: ResultRow[]): PLItem[] => {
    const field = rows.length;
    return rows
      .filter((r) => r.finish === 'finished' && r.position !== null)
      .sort((a, b) => a.position! - b.position!)
      .map((r) => ({ team: teamIdx(r.teamId), driver: driverIdx(r.driverId), x: gridCovariate(r.grid, field) }));
  };

  for (const w of weekends) {
    const key = `${w.event.season}-${w.event.round}`;
    if (w.gp?.length && raceTime(w.event) < cutoff) {
      const weight = weightOf(w, 'gp');
      const items = finishingOrder(w.gp);
      if (items.length >= 2 && weight > 0) race.push({ items, weight });
      for (const r of w.gp) {
        if (r.finish !== 'finished' && r.finish !== 'dnf') continue;
        starts.push({ team: teamIdx(r.teamId), driver: driverIdx(r.driverId), dnf: r.finish === 'dnf', weight });
      }
      used.add(key);
    }
    if (w.sprint?.length && sprintTime(w.event) < cutoff) {
      const weight = weightOf(w, 'sprint');
      const items = finishingOrder(w.sprint);
      if (items.length >= 2 && weight > 0) race.push({ items, weight });
      used.add(key);
    }
    if (w.quali?.length && qualiTime(w.event) < cutoff) {
      const weight = weightOf(w, 'quali');
      const items = [...w.quali]
        .sort((a, b) => a.position - b.position)
        .map((q) => ({ team: teamIdx(q.teamId), driver: driverIdx(q.driverId), x: 0 }));
      if (items.length >= 2 && weight > 0) quali.push({ items, weight });
      used.add(key);
    }
  }

  // Entrants without history still need parameters (they sit at the prior).
  for (const e of entrants) {
    driverIdx(e.driverId);
    teamIdx(e.teamId);
  }

  return {
    index: { driverIds, driverIndex, teamKeys, teamIndex },
    race,
    quali,
    starts,
    weekends: used.size,
  };
}
