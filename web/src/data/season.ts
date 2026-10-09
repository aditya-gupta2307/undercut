/**
 * Assembles one season from the Jolpica payload into the domain model, and
 * owns the caching policy:
 *
 *   - a season that is over never changes, so it is cached indefinitely;
 *   - the current season is cached for a few minutes and refreshed in the
 *     background while the stale copy is shown (stale-while-revalidate).
 */

import { readStored, writeStored } from '../lib/storage';
import {
  fetchSeasonPayload,
  parseDriver,
  parseDriverStandings,
  parseQualifying,
  parseRaceEvent,
  parseResult,
  parseTeam,
  parseTeamStandings,
  type RawRace,
  type SeasonPayload,
} from './jolpica';
import type { DriverInfo, QualiRow, RaceEvent, ResultRow, Season, TeamInfo } from './types';

/** Bump to invalidate every cached season after a parsing change. */
const SEASON_CACHE_VERSION = 3;
const CURRENT_SEASON_TTL = 10 * 60_000;

/**
 * Lapped cars: the API sometimes attaches a race time to a car that finished a
 * lap down. Replace those with "+N Lap(s)" so a lapped car never shows a
 * nonsensical few-second gap.
 */
export function normaliseClassification(rows: ResultRow[]): ResultRow[] {
  const leaderLaps = Math.max(0, ...rows.filter((r) => r.finish === 'finished').map((r) => r.laps));
  return rows.map((r) => {
    if (r.finish !== 'finished' || r.laps >= leaderLaps) return r;
    const down = leaderLaps - r.laps;
    return { ...r, timeMs: null, timeText: `+${down} Lap${down > 1 ? 's' : ''}` };
  });
}

export function buildSeason(year: number, payload: SeasonPayload, now: number): Season {
  const drivers: Record<string, DriverInfo> = {};
  const teams: Record<string, TeamInfo> = {};

  const absorb = (race: RawRace) => {
    for (const r of [...(race.Results ?? []), ...(race.SprintResults ?? []), ...(race.QualifyingResults ?? [])]) {
      drivers[r.Driver.driverId] = parseDriver(r.Driver);
      if (r.Constructor) teams[r.Constructor.constructorId] = parseTeam(r.Constructor);
    }
  };
  payload.results.forEach(absorb);
  payload.sprints.forEach(absorb);
  payload.qualifying.forEach(absorb);
  for (const s of payload.driverStandings.rows) {
    if (!drivers[s.Driver.driverId]) drivers[s.Driver.driverId] = parseDriver(s.Driver);
    for (const c of s.Constructors ?? []) if (!teams[c.constructorId]) teams[c.constructorId] = parseTeam(c);
  }
  for (const s of payload.teamStandings.rows) {
    if (!teams[s.Constructor.constructorId]) teams[s.Constructor.constructorId] = parseTeam(s.Constructor);
  }

  const events: RaceEvent[] = payload.calendar.map(parseRaceEvent).sort((a, b) => a.round - b.round);

  const byRound = <T>(races: RawRace[], pick: (r: RawRace) => T[] | undefined, map: (row: T, i: number) => ResultRow | QualiRow) => {
    const out: Record<number, (ResultRow | QualiRow)[]> = {};
    for (const race of races) {
      const rows = pick(race);
      if (rows && rows.length) out[Number(race.round)] = rows.map(map);
    }
    return out;
  };

  const results = byRound(payload.results, (r) => r.Results, parseResult) as Record<number, ResultRow[]>;
  const sprints = byRound(payload.sprints, (r) => r.SprintResults, parseResult) as Record<number, ResultRow[]>;
  const qualifying = byRound(payload.qualifying, (r) => r.QualifyingResults, parseQualifying) as Record<number, QualiRow[]>;
  for (const k of Object.keys(results)) results[Number(k)] = normaliseClassification(results[Number(k)]!);
  for (const k of Object.keys(sprints)) sprints[Number(k)] = normaliseClassification(sprints[Number(k)]!);

  return {
    year,
    events,
    drivers,
    teams,
    results,
    sprints,
    qualifying,
    driverStandings: parseDriverStandings(payload.driverStandings.rows),
    teamStandings: parseTeamStandings(payload.teamStandings.rows),
    standingsRound: payload.driverStandings.round,
    fetchedAt: now,
  };
}

/** A season is final once its last round has results and is in the past. */
export function isSeasonComplete(season: Season, now: number): boolean {
  if (season.events.length === 0) return season.year < new Date(now).getUTCFullYear();
  const last = season.events[season.events.length - 1]!;
  const lastTime = last.start ?? Date.parse(last.date + 'T23:59:59Z');
  return Boolean(season.results[last.round]?.length) && lastTime < now;
}

function cacheKey(year: number): string {
  return `cache:season:${SEASON_CACHE_VERSION}:${year}`;
}

export function readCachedSeason(year: number): { season: Season; savedAt: number } | null {
  const hit = readStored<Season>(cacheKey(year));
  return hit ? { season: hit.value, savedAt: hit.savedAt } : null;
}

export function isFresh(season: Season, savedAt: number, now: number): boolean {
  return isSeasonComplete(season, now) || now - savedAt < CURRENT_SEASON_TTL;
}

const inflight = new Map<number, Promise<Season>>();
const memory = new Map<number, { season: Season; savedAt: number }>();

/** The freshest copy we hold without touching the network (memory, then storage). */
export function peekSeason(year: number): { season: Season; savedAt: number } | null {
  const m = memory.get(year);
  if (m) return m;
  const stored = readCachedSeason(year);
  if (stored) memory.set(year, stored);
  return stored;
}

/**
 * A season, from cache when fresh enough, otherwise from the network.
 * Concurrent calls share one fetch; `force` skips the freshness check.
 */
export function loadSeason(year: number, opts: { force?: boolean } = {}): Promise<Season> {
  if (!opts.force) {
    const cached = peekSeason(year);
    if (cached && isFresh(cached.season, cached.savedAt, Date.now())) return Promise.resolve(cached.season);
  }
  const existing = inflight.get(year);
  if (existing) return existing;
  const p = fetchSeasonPayload(year, { standings: true })
    .then((payload) => {
      const now = Date.now();
      const season = buildSeason(year, payload, now);
      memory.set(year, { season, savedAt: now });
      writeStored(cacheKey(year), season);
      return season;
    })
    .finally(() => inflight.delete(year));
  inflight.set(year, p);
  return p;
}

// ---------------------------------------------------------------------------
// Derived views used across pages
// ---------------------------------------------------------------------------

export interface EventState {
  event: RaceEvent;
  status: 'completed' | 'awaiting-results' | 'live' | 'next' | 'upcoming';
}

/** Weekend start: first session we know about, or two days before the race. */
export function weekendStart(e: RaceEvent): number | null {
  const times = Object.values(e.sessions).filter((t): t is number => typeof t === 'number');
  if (times.length) return Math.min(...times);
  const d = Date.parse(e.date + 'T00:00:00Z');
  return Number.isFinite(d) ? d - 2 * 86_400_000 : null;
}

export function raceTime(e: RaceEvent): number {
  return e.start ?? Date.parse(e.date + 'T12:00:00Z');
}

/** Classify every event of a season relative to "now". */
export function eventStates(season: Season, now: number): EventState[] {
  let nextAssigned = false;
  return season.events.map((event) => {
    const hasResults = Boolean(season.results[event.round]?.length);
    if (hasResults) return { event, status: 'completed' };
    const raceAt = raceTime(event);
    // A Grand Prix runs about two hours; Jolpica usually publishes within hours.
    if (now > raceAt + 3 * 3_600_000) return { event, status: 'awaiting-results' };
    const ws = weekendStart(event);
    if (!nextAssigned) {
      nextAssigned = true;
      if (ws !== null && now >= ws) return { event, status: 'live' };
      return { event, status: 'next' };
    }
    return { event, status: 'upcoming' };
  });
}

/** The latest round with Grand Prix results. */
export function lastCompletedRound(season: Season): number | null {
  const rounds = Object.keys(season.results).map(Number).filter((r) => season.results[r]!.length > 0);
  return rounds.length ? Math.max(...rounds) : null;
}

/** Current team of each driver: from the latest GP or sprint they took part in. */
export function currentTeams(season: Season): Record<string, string> {
  const out: Record<string, string> = {};
  const rounds = new Set([...Object.keys(season.results), ...Object.keys(season.sprints), ...Object.keys(season.qualifying)].map(Number));
  for (const round of [...rounds].sort((a, b) => a - b)) {
    for (const r of season.qualifying[round] ?? []) out[r.driverId] = r.teamId;
    for (const r of season.sprints[round] ?? []) out[r.driverId] = r.teamId;
    for (const r of season.results[round] ?? []) out[r.driverId] = r.teamId;
  }
  return out;
}
