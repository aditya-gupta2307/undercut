/**
 * Jolpica F1 (the community successor to the Ergast API).
 *
 * Responses keep Ergast's shape: every number is a string, optional blocks are
 * simply absent, and limit/offset paginate over result *rows* — so one race's
 * results can straddle two pages. paginateRaces() merges pages back into whole
 * races by (season, round) and is correct however the server slices them.
 *
 * Quirks handled below, all observed in real 2026 responses:
 *   - Q2/Q3 may be "" (no time set) or missing entirely (eliminated earlier);
 *   - a classified car can still have status "Retired" (classified on distance);
 *   - a car can be "Lapped" yet positionText "R" (not classified);
 *   - Time blocks exist with an empty time string;
 *   - drivers can change constructor mid-season (standings list several);
 *   - since 2025 statuses are an enumerated set: Finished, Lapped, Retired,
 *     Disqualified, Did not start.
 */

import { jolpicaQueue } from '../lib/http';
import { combineDateTime, durationToMs, str, toFloat, toInt } from './parse';
import type {
  Circuit,
  DriverInfo,
  DriverStanding,
  FinishStatus,
  QualiRow,
  RaceEvent,
  ResultRow,
  SessionTimes,
  TeamInfo,
  TeamStanding,
} from './types';

export const JOLPICA_BASE = 'https://api.jolpi.ca/ergast/f1';
const PAGE = 100; // the API maximum

// ---------------------------------------------------------------------------
// Raw shapes (only the fields we read)
// ---------------------------------------------------------------------------

interface RawLocation {
  lat?: string;
  long?: string;
  locality?: string;
  country?: string;
}
export interface RawCircuit {
  circuitId: string;
  circuitName?: string;
  url?: string;
  Location?: RawLocation;
}
interface RawSession {
  date?: string;
  time?: string;
}
export interface RawDriver {
  driverId: string;
  permanentNumber?: string;
  code?: string;
  givenName?: string;
  familyName?: string;
  dateOfBirth?: string;
  nationality?: string;
}
export interface RawConstructor {
  constructorId: string;
  name?: string;
  nationality?: string;
}
export interface RawResult {
  number?: string;
  position?: string;
  positionText?: string;
  points?: string;
  Driver: RawDriver;
  Constructor?: RawConstructor;
  grid?: string;
  laps?: string;
  status?: string;
  Time?: { millis?: string; time?: string };
  FastestLap?: { rank?: string; lap?: string; Time?: { time?: string } };
}
export interface RawQualifying {
  number?: string;
  position?: string;
  Driver: RawDriver;
  Constructor?: RawConstructor;
  Q1?: string;
  Q2?: string;
  Q3?: string;
}
export interface RawRace {
  season: string;
  round: string;
  url?: string;
  raceName?: string;
  Circuit?: RawCircuit;
  date?: string;
  time?: string;
  FirstPractice?: RawSession;
  SecondPractice?: RawSession;
  ThirdPractice?: RawSession;
  Qualifying?: RawSession;
  Sprint?: RawSession;
  SprintQualifying?: RawSession;
  SprintShootout?: RawSession;
  Results?: RawResult[];
  SprintResults?: RawResult[];
  QualifyingResults?: RawQualifying[];
}
interface RawStandingDriver {
  position?: string;
  positionText?: string;
  points?: string;
  wins?: string;
  Driver: RawDriver;
  Constructors?: RawConstructor[];
}
interface RawStandingTeam {
  position?: string;
  positionText?: string;
  points?: string;
  wins?: string;
  Constructor: RawConstructor;
}
interface MRData {
  limit?: string;
  offset?: string;
  total?: string;
  RaceTable?: { Races?: RawRace[] };
  StandingsTable?: {
    StandingsLists?: { round?: string; DriverStandings?: RawStandingDriver[]; ConstructorStandings?: RawStandingTeam[] }[];
  };
}
interface Envelope {
  MRData: MRData;
}

// ---------------------------------------------------------------------------
// Parsing (pure, exported for tests)
// ---------------------------------------------------------------------------

export function parseCircuit(raw: RawCircuit | undefined): Circuit {
  return {
    id: raw?.circuitId ?? 'unknown',
    name: raw?.circuitName ?? 'Unknown circuit',
    locality: raw?.Location?.locality ?? '',
    country: raw?.Location?.country ?? '',
    lat: toFloat(raw?.Location?.lat),
    lon: toFloat(raw?.Location?.long),
  };
}

export function parseRaceEvent(raw: RawRace): RaceEvent {
  const at = (s: RawSession | undefined) => (s ? combineDateTime(s.date, s.time) ?? undefined : undefined);
  const sessions: SessionTimes = {};
  const assign = (key: keyof SessionTimes, v: number | undefined) => {
    if (v !== undefined) sessions[key] = v;
  };
  assign('fp1', at(raw.FirstPractice));
  assign('fp2', at(raw.SecondPractice));
  assign('fp3', at(raw.ThirdPractice));
  assign('quali', at(raw.Qualifying));
  assign('sprint', at(raw.Sprint));
  assign('sprintQuali', at(raw.SprintQualifying ?? raw.SprintShootout));
  const start = combineDateTime(raw.date, raw.time);
  if (start !== null) sessions.race = start;
  return {
    season: toInt(raw.season) ?? 0,
    round: toInt(raw.round) ?? 0,
    name: raw.raceName ?? `Round ${raw.round}`,
    circuit: parseCircuit(raw.Circuit),
    start,
    date: raw.date ?? '',
    sessions,
    hasSprint: Boolean(raw.Sprint),
    wikiUrl: raw.url ?? null,
  };
}

export function parseDriver(raw: RawDriver): DriverInfo {
  return {
    id: raw.driverId,
    code: raw.code ?? raw.familyName?.slice(0, 3).toUpperCase() ?? raw.driverId.slice(0, 3).toUpperCase(),
    permanentNumber: toInt(raw.permanentNumber),
    givenName: raw.givenName ?? '',
    familyName: raw.familyName ?? raw.driverId,
    nationality: raw.nationality ?? '',
    dateOfBirth: raw.dateOfBirth ?? null,
  };
}

export function parseTeam(raw: RawConstructor): TeamInfo {
  return { id: raw.constructorId, name: raw.name ?? raw.constructorId, nationality: raw.nationality ?? '' };
}

const FINISHED_STATUS = /^(finished|lapped|\+\s*\d+\s*laps?)$/i;
const DNS_STATUS = /did not start|withdrew|did not qualify|did not prequalify|not qualified/i;
const DSQ_STATUS = /disqualified|excluded/i;

/** Normalise the many historical status strings into four outcomes. */
export function classifyFinish(positionText: string, status: string): FinishStatus {
  const pt = positionText.trim().toUpperCase();
  if (pt === 'D' || pt === 'E') return 'dsq';
  if (pt === 'W' || pt === 'F') return 'dns';
  if (DNS_STATUS.test(status)) return 'dns';
  if (DSQ_STATUS.test(status)) return 'dsq';
  if (/^\d+$/.test(pt) && FINISHED_STATUS.test(status.trim())) return 'finished';
  return 'dnf';
}

export function parseResult(raw: RawResult, index: number): ResultRow {
  const positionText = str(raw.positionText ?? raw.position, '');
  const status = str(raw.status, '');
  const finish = classifyFinish(positionText, status);
  const millis = toInt(raw.Time?.millis);
  const timeText = raw.Time?.time ? raw.Time.time : null;
  return {
    driverId: raw.Driver.driverId,
    teamId: raw.Constructor?.constructorId ?? 'unknown',
    carNumber: toInt(raw.number),
    grid: toInt(raw.grid),
    position: /^\d+$/.test(positionText.trim()) ? Number(positionText) : null,
    order: toInt(raw.position) ?? index + 1,
    positionText,
    points: toFloat(raw.points) ?? 0,
    laps: toInt(raw.laps) ?? 0,
    status,
    finish,
    // Only trust a total time for cars that actually took the flag.
    timeMs: finish === 'finished' && timeText ? millis : null,
    timeText: finish === 'finished' ? timeText : null,
    fastestLapRank: toInt(raw.FastestLap?.rank),
    fastestLapNumber: toInt(raw.FastestLap?.lap),
    fastestLapMs: durationToMs(raw.FastestLap?.Time?.time),
  };
}

export function parseQualifying(raw: RawQualifying, index: number): QualiRow {
  return {
    driverId: raw.Driver.driverId,
    teamId: raw.Constructor?.constructorId ?? 'unknown',
    carNumber: toInt(raw.number),
    position: toInt(raw.position) ?? index + 1,
    q1Ms: durationToMs(raw.Q1),
    q2Ms: durationToMs(raw.Q2),
    q3Ms: durationToMs(raw.Q3),
  };
}

/**
 * Merge race objects that arrived on different pages. Inner arrays are
 * concatenated in arrival order and then sorted by their position field.
 */
export function mergeRacePages(pages: RawRace[][]): RawRace[] {
  const byKey = new Map<string, RawRace>();
  const concat = <T>(a: T[] | undefined, b: T[] | undefined): T[] | undefined => (a || b ? [...(a ?? []), ...(b ?? [])] : undefined);
  for (const page of pages) {
    for (const race of page) {
      const key = `${race.season}-${race.round}`;
      const existing = byKey.get(key);
      if (!existing) {
        byKey.set(key, {
          ...race,
          Results: concat(race.Results, undefined),
          SprintResults: concat(race.SprintResults, undefined),
          QualifyingResults: concat(race.QualifyingResults, undefined),
        });
      } else {
        existing.Results = concat(existing.Results, race.Results);
        existing.SprintResults = concat(existing.SprintResults, race.SprintResults);
        existing.QualifyingResults = concat(existing.QualifyingResults, race.QualifyingResults);
      }
    }
  }
  // De-duplicate by driver (pages can overlap if the data changes mid-fetch) and order by position.
  const tidy = <T extends { position?: string; Driver: RawDriver }>(list: T[] | undefined): T[] | undefined => {
    if (!list) return undefined;
    const seen = new Map<string, T>();
    for (const row of list) seen.set(row.Driver.driverId, row);
    return [...seen.values()].sort((a, b) => (toInt(a.position) ?? 999) - (toInt(b.position) ?? 999));
  };
  const races = [...byKey.values()].map((r) => ({
    ...r,
    Results: tidy(r.Results),
    SprintResults: tidy(r.SprintResults),
    QualifyingResults: tidy(r.QualifyingResults),
  }));
  races.sort((a, b) => (toInt(a.season) ?? 0) - (toInt(b.season) ?? 0) || (toInt(a.round) ?? 0) - (toInt(b.round) ?? 0));
  return races;
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

function url(path: string, offset: number): string {
  return `${JOLPICA_BASE}/${path}.json?limit=${PAGE}&offset=${offset}`;
}

/** Fetch every page of a path. The first response tells us how many exist. */
async function allPages(path: string): Promise<MRData[]> {
  const first = await jolpicaQueue.json<Envelope>(url(path, 0));
  const total = toInt(first.MRData.total) ?? 0;
  const pages: MRData[] = [first.MRData];
  const offsets: number[] = [];
  for (let off = PAGE; off < total; off += PAGE) offsets.push(off);
  const rest = await Promise.all(offsets.map((off) => jolpicaQueue.json<Envelope>(url(path, off))));
  for (const r of rest) pages.push(r.MRData);
  return pages;
}

export async function fetchRaces(path: string): Promise<RawRace[]> {
  const pages = await allPages(path);
  return mergeRacePages(pages.map((p) => p.RaceTable?.Races ?? []));
}

export interface SeasonPayload {
  calendar: RawRace[];
  results: RawRace[];
  sprints: RawRace[];
  qualifying: RawRace[];
  driverStandings: { round: number | null; rows: RawStandingDriver[] };
  teamStandings: { round: number | null; rows: RawStandingTeam[] };
}

export async function fetchSeasonPayload(year: number, opts: { standings: boolean }): Promise<SeasonPayload> {
  const standings = async <T>(kind: 'driverstandings' | 'constructorstandings') => {
    const pages = await allPages(`${year}/${kind}`);
    const lists = pages.flatMap((p) => p.StandingsTable?.StandingsLists ?? []);
    const last = lists[lists.length - 1];
    const rows = (kind === 'driverstandings' ? last?.DriverStandings : last?.ConstructorStandings) ?? [];
    return { round: toInt(last?.round), rows: rows as T[] };
  };
  const [calendar, results, sprints, qualifying, driverStandings, teamStandings] = await Promise.all([
    fetchRaces(`${year}/races`),
    fetchRaces(`${year}/results`),
    fetchRaces(`${year}/sprint`),
    fetchRaces(`${year}/qualifying`),
    opts.standings ? standings<RawStandingDriver>('driverstandings') : Promise.resolve({ round: null, rows: [] }),
    opts.standings ? standings<RawStandingTeam>('constructorstandings') : Promise.resolve({ round: null, rows: [] }),
  ]);
  return { calendar, results, sprints, qualifying, driverStandings, teamStandings };
}

export function parseDriverStandings(rows: RawStandingDriver[]): DriverStanding[] {
  return rows.map((r) => ({
    driverId: r.Driver.driverId,
    teamIds: (r.Constructors ?? []).map((c) => c.constructorId),
    position: toInt(r.position),
    positionText: str(r.positionText ?? r.position, ''),
    points: toFloat(r.points) ?? 0,
    wins: toInt(r.wins) ?? 0,
  }));
}

export function parseTeamStandings(rows: RawStandingTeam[]): TeamStanding[] {
  return rows.map((r) => ({
    teamId: r.Constructor.constructorId,
    position: toInt(r.position),
    positionText: str(r.positionText ?? r.position, ''),
    points: toFloat(r.points) ?? 0,
    wins: toInt(r.wins) ?? 0,
  }));
}

/** Winners at a circuit across its whole history: one row per race, one request. */
export async function fetchCircuitWinners(circuitId: string): Promise<{ season: number; round: number; date: string; row: ResultRow; driver: DriverInfo; team: TeamInfo }[]> {
  const races = await fetchRaces(`circuits/${encodeURIComponent(circuitId)}/results/1`);
  const out: { season: number; round: number; date: string; row: ResultRow; driver: DriverInfo; team: TeamInfo }[] = [];
  for (const race of races) {
    const r = race.Results?.[0];
    if (!r) continue;
    out.push({
      season: toInt(race.season) ?? 0,
      round: toInt(race.round) ?? 0,
      date: race.date ?? '',
      row: parseResult(r, 0),
      driver: parseDriver(r.Driver),
      team: parseTeam(r.Constructor ?? { constructorId: 'unknown' }),
    });
  }
  return out;
}

/** Full results of one season's race at a circuit (used for "last visits" stats). */
export async function fetchCircuitSeasonResults(year: number, circuitId: string): Promise<ResultRow[]> {
  const races = await fetchRaces(`${year}/circuits/${encodeURIComponent(circuitId)}/results`);
  return (races[0]?.Results ?? []).map(parseResult);
}
