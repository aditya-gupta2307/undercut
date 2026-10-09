/**
 * OpenF1: Formula 1's live-timing archive as a REST API (2023 onwards).
 *
 * Historical data is free without authentication; real-time data during a
 * session needs a paid key, so this site only ever reads sessions that have
 * finished. Filters use query parameters, including comparison operators
 * ("date>2024-09-22T12:00:00"). Every list is re-filtered client-side as
 * well, so a server that ignored a filter could never leak another session's
 * rows into a chart.
 *
 * Quirks handled, all seen in real responses: six-digit fractional seconds in
 * timestamps, "+1 LAP" strings in place of numeric gaps, null positions for
 * some retirements, null lap durations (lap 1, red flags), and Sprint /
 * Sprint Qualifying sessions typed as "Race" / "Qualifying".
 */

import { HttpError, openf1Queue, type Priority } from '../lib/http';
import { hexColour, lapsDown, parseIso, secondsToMs, str, toFloat, toInt } from './parse';
import type {
  Compound,
  F1Session,
  GridSlot,
  IntervalSample,
  Lap,
  LocationSample,
  Meeting,
  Overtake,
  PitStop,
  PositionSample,
  RaceControlMessage,
  SessionDriver,
  SessionResultRow,
  Stint,
  TeamRadio,
  WeatherSample,
} from './types';

export const OPENF1_BASE = 'https://api.openf1.org/v1';

type Raw = Record<string, unknown>;
type Param = [key: string, op: '=' | '>' | '<' | '>=' | '<=', value: string | number];

/** Build an OpenF1 URL. Comparison operators are written literally, as in the docs. */
export function openf1Url(endpoint: string, params: Param[]): string {
  const query = params
    .map(([k, op, v]) => {
      const value = encodeURIComponent(String(v)).replace(/%3A/gi, ':');
      return `${k}${op}${value}`;
    })
    .join('&');
  return `${OPENF1_BASE}/${endpoint}${query ? '?' + query : ''}`;
}

/** UTC timestamp in the zone-less ISO form the API documents (no "+", which a query string would turn into a space). */
export function openf1Date(ms: number): string {
  return new Date(ms).toISOString().replace('Z', '');
}

async function list(endpoint: string, params: Param[], priority: Priority = 'high'): Promise<Raw[]> {
  try {
    const body = await openf1Queue.json<unknown>(openf1Url(endpoint, params), priority);
    return Array.isArray(body) ? (body as Raw[]) : [];
  } catch (err) {
    // Newer API versions answer "no rows" with 404 + {"detail": "No results found."}.
    if (err instanceof HttpError && err.status === 404) return [];
    throw err;
  }
}

const bySession = (sessionKey: number) => (r: Raw) => toInt(r.session_key) === sessionKey;

// ---------------------------------------------------------------------------
// Parsers (pure, exported for tests)
// ---------------------------------------------------------------------------

export function parseMeeting(r: Raw): Meeting | null {
  const start = parseIso(r.date_start);
  const key = toInt(r.meeting_key);
  if (key === null || start === null) return null;
  return {
    key,
    name: str(r.meeting_name),
    officialName: str(r.meeting_official_name),
    year: toInt(r.year) ?? new Date(start).getUTCFullYear(),
    circuitKey: toInt(r.circuit_key) ?? -1,
    circuitShortName: str(r.circuit_short_name),
    location: str(r.location),
    countryName: str(r.country_name),
    countryCode: str(r.country_code),
    start,
    end: parseIso(r.date_end) ?? start,
    gmtOffset: str(r.gmt_offset, '00:00:00'),
    cancelled: r.is_cancelled === true,
  };
}

export function parseSession(r: Raw): F1Session | null {
  const key = toInt(r.session_key);
  const start = parseIso(r.date_start);
  if (key === null || start === null) return null;
  return {
    key,
    meetingKey: toInt(r.meeting_key) ?? -1,
    name: str(r.session_name),
    type: str(r.session_type),
    start,
    end: parseIso(r.date_end) ?? start,
    circuitKey: toInt(r.circuit_key) ?? -1,
    circuitShortName: str(r.circuit_short_name),
    year: toInt(r.year) ?? new Date(start).getUTCFullYear(),
    gmtOffset: str(r.gmt_offset, '00:00:00'),
    cancelled: r.is_cancelled === true,
  };
}

export function parseDriver(r: Raw): SessionDriver | null {
  const number = toInt(r.driver_number);
  if (number === null) return null;
  return {
    number,
    acronym: str(r.name_acronym, String(number)),
    fullName: str(r.full_name),
    firstName: str(r.first_name),
    lastName: str(r.last_name),
    teamName: str(r.team_name),
    teamColour: hexColour(r.team_colour),
  };
}

export function parseLap(r: Raw): Lap | null {
  const driverNumber = toInt(r.driver_number);
  const lap = toInt(r.lap_number);
  if (driverNumber === null || lap === null) return null;
  return {
    driverNumber,
    lap,
    start: parseIso(r.date_start),
    durationMs: secondsToMs(r.lap_duration),
    s1Ms: secondsToMs(r.duration_sector_1),
    s2Ms: secondsToMs(r.duration_sector_2),
    s3Ms: secondsToMs(r.duration_sector_3),
    pitOutLap: r.is_pit_out_lap === true,
    speedTrap: toFloat(r.st_speed),
  };
}

const COMPOUNDS: Compound[] = ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'];

export function parseCompound(v: unknown): Compound {
  const c = str(v).toUpperCase().trim();
  return (COMPOUNDS as string[]).includes(c) ? (c as Compound) : 'UNKNOWN';
}

export function parseStint(r: Raw): Stint | null {
  const driverNumber = toInt(r.driver_number);
  const lapStart = toInt(r.lap_start);
  if (driverNumber === null || lapStart === null) return null;
  return {
    driverNumber,
    stint: toInt(r.stint_number) ?? 0,
    compound: parseCompound(r.compound),
    lapStart,
    lapEnd: toInt(r.lap_end) ?? lapStart,
    tyreAgeAtStart: toInt(r.tyre_age_at_start) ?? 0,
  };
}

export function parsePit(r: Raw): PitStop | null {
  const driverNumber = toInt(r.driver_number);
  const lap = toInt(r.lap_number);
  const at = parseIso(r.date);
  if (driverNumber === null || lap === null || at === null) return null;
  // pit_duration is the deprecated name for lane_duration.
  return {
    driverNumber,
    lap,
    at,
    laneMs: secondsToMs(r.lane_duration ?? r.pit_duration),
    stopMs: secondsToMs(r.stop_duration),
  };
}

export function parseRaceControl(r: Raw): RaceControlMessage | null {
  const at = parseIso(r.date);
  if (at === null) return null;
  return {
    at,
    lap: toInt(r.lap_number),
    category: str(r.category),
    flag: r.flag === null || r.flag === undefined ? null : str(r.flag),
    scope: r.scope === null || r.scope === undefined ? null : str(r.scope),
    sector: toInt(r.sector),
    driverNumber: toInt(r.driver_number),
    message: str(r.message),
  };
}

export function parseWeather(r: Raw): WeatherSample | null {
  const at = parseIso(r.date);
  if (at === null) return null;
  return {
    at,
    airTemp: toFloat(r.air_temperature),
    trackTemp: toFloat(r.track_temperature),
    humidity: toFloat(r.humidity),
    pressure: toFloat(r.pressure),
    rainfall: Number(r.rainfall ?? 0) > 0,
    windSpeed: toFloat(r.wind_speed),
    windDirection: toInt(r.wind_direction),
  };
}

/** Durations/gaps are numbers for lead-lap cars, "+N LAP(S)" strings otherwise, arrays in qualifying. */
function lastNumeric(v: unknown): unknown {
  if (Array.isArray(v)) {
    for (let i = v.length - 1; i >= 0; i--) if (typeof v[i] === 'number') return v[i];
    return null;
  }
  return v;
}

export function parseSessionResult(r: Raw): SessionResultRow | null {
  const driverNumber = toInt(r.driver_number);
  if (driverNumber === null) return null;
  const gapRaw = lastNumeric(r.gap_to_leader);
  return {
    driverNumber,
    position: toInt(r.position),
    laps: toInt(r.number_of_laps) ?? 0,
    points: toFloat(r.points),
    dnf: r.dnf === true,
    dns: r.dns === true,
    dsq: r.dsq === true,
    durationMs: secondsToMs(lastNumeric(r.duration)),
    gapMs: typeof gapRaw === 'number' ? Math.round(gapRaw * 1000) : null,
    lapsDown: lapsDown(gapRaw),
  };
}

export function parseGrid(r: Raw): GridSlot | null {
  const driverNumber = toInt(r.driver_number);
  const position = toInt(r.position);
  if (driverNumber === null || position === null) return null;
  return { driverNumber, position, lapMs: secondsToMs(r.lap_duration) };
}

export function parsePosition(r: Raw): PositionSample | null {
  const at = parseIso(r.date);
  const driverNumber = toInt(r.driver_number);
  const position = toInt(r.position);
  if (at === null || driverNumber === null || position === null) return null;
  return { at, driverNumber, position };
}

export function parseInterval(r: Raw): IntervalSample | null {
  const at = parseIso(r.date);
  const driverNumber = toInt(r.driver_number);
  if (at === null || driverNumber === null) return null;
  return {
    at,
    driverNumber,
    gapToLeaderMs: typeof r.gap_to_leader === 'number' ? Math.round(r.gap_to_leader * 1000) : null,
    intervalMs: typeof r.interval === 'number' ? Math.round(r.interval * 1000) : null,
    lapsDown: lapsDown(r.gap_to_leader),
  };
}

export function parseRadio(r: Raw): TeamRadio | null {
  const at = parseIso(r.date);
  const driverNumber = toInt(r.driver_number);
  const url = str(r.recording_url);
  if (at === null || driverNumber === null || !/^https:\/\//.test(url)) return null;
  return { at, driverNumber, url };
}

export function parseLocation(r: Raw): LocationSample | null {
  const at = parseIso(r.date);
  const driverNumber = toInt(r.driver_number);
  const x = toFloat(r.x);
  const y = toFloat(r.y);
  if (at === null || driverNumber === null || x === null || y === null) return null;
  return { at, driverNumber, x, y };
}

export function parseOvertake(r: Raw): Overtake | null {
  const at = parseIso(r.date);
  const a = toInt(r.overtaking_driver_number);
  const b = toInt(r.overtaken_driver_number);
  if (at === null || a === null || b === null) return null;
  return { at, overtaking: a, overtaken: b, position: toInt(r.position) ?? 0 };
}

function keep<T>(rows: Raw[], parse: (r: Raw) => T | null, filter?: (r: Raw) => boolean): T[] {
  const out: T[] = [];
  for (const r of rows) {
    if (filter && !filter(r)) continue;
    const v = parse(r);
    if (v !== null) out.push(v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export async function fetchMeetings(year: number): Promise<Meeting[]> {
  const rows = await list('meetings', [['year', '=', year]]);
  return keep(rows, parseMeeting, (r) => toInt(r.year) === year).sort((a, b) => a.start - b.start);
}

export async function fetchSessions(year: number): Promise<F1Session[]> {
  const rows = await list('sessions', [['year', '=', year]]);
  return keep(rows, parseSession, (r) => toInt(r.year) === year).sort((a, b) => a.start - b.start);
}

/** All race sessions ever recorded at a circuit (for track outlines and history). */
export async function fetchRaceSessionsAtCircuit(circuitKey: number): Promise<F1Session[]> {
  const rows = await list('sessions', [['circuit_key', '=', circuitKey], ['session_name', '=', 'Race']]);
  return keep(rows, parseSession, (r) => toInt(r.circuit_key) === circuitKey && r.session_name === 'Race').sort(
    (a, b) => a.start - b.start,
  );
}

export async function fetchDrivers(sessionKey: number, priority?: Priority): Promise<SessionDriver[]> {
  const rows = await list('drivers', [['session_key', '=', sessionKey]], priority);
  const seen = new Map<number, SessionDriver>();
  for (const d of keep(rows, parseDriver, bySession(sessionKey))) seen.set(d.number, d);
  return [...seen.values()].sort((a, b) => a.number - b.number);
}

export async function fetchLaps(sessionKey: number): Promise<Lap[]> {
  const rows = await list('laps', [['session_key', '=', sessionKey]]);
  return keep(rows, parseLap, bySession(sessionKey)).sort((a, b) => a.driverNumber - b.driverNumber || a.lap - b.lap);
}

export async function fetchStints(sessionKey: number): Promise<Stint[]> {
  const rows = await list('stints', [['session_key', '=', sessionKey]]);
  return keep(rows, parseStint, bySession(sessionKey)).sort((a, b) => a.driverNumber - b.driverNumber || a.lapStart - b.lapStart);
}

export async function fetchPits(sessionKey: number): Promise<PitStop[]> {
  const rows = await list('pit', [['session_key', '=', sessionKey]]);
  return keep(rows, parsePit, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchRaceControl(sessionKey: number, priority?: Priority): Promise<RaceControlMessage[]> {
  const rows = await list('race_control', [['session_key', '=', sessionKey]], priority);
  return keep(rows, parseRaceControl, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchWeather(sessionKey: number): Promise<WeatherSample[]> {
  const rows = await list('weather', [['session_key', '=', sessionKey]]);
  return keep(rows, parseWeather, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchSessionResult(sessionKey: number, priority?: Priority): Promise<SessionResultRow[]> {
  const rows = await list('session_result', [['session_key', '=', sessionKey]], priority);
  return keep(rows, parseSessionResult, bySession(sessionKey)).sort(
    (a, b) => (a.position ?? 99) - (b.position ?? 99) || b.laps - a.laps,
  );
}

export async function fetchStartingGrid(sessionKey: number): Promise<GridSlot[]> {
  const rows = await list('starting_grid', [['session_key', '=', sessionKey]]);
  return keep(rows, parseGrid, bySession(sessionKey)).sort((a, b) => a.position - b.position);
}

export async function fetchPositions(sessionKey: number): Promise<PositionSample[]> {
  const rows = await list('position', [['session_key', '=', sessionKey]]);
  return keep(rows, parsePosition, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchIntervals(sessionKey: number, priority: Priority = 'low'): Promise<IntervalSample[]> {
  const rows = await list('intervals', [['session_key', '=', sessionKey]], priority);
  return keep(rows, parseInterval, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchTeamRadio(sessionKey: number): Promise<TeamRadio[]> {
  const rows = await list('team_radio', [['session_key', '=', sessionKey]], 'low');
  return keep(rows, parseRadio, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

export async function fetchOvertakes(sessionKey: number): Promise<Overtake[]> {
  const rows = await list('overtakes', [['session_key', '=', sessionKey]], 'low');
  return keep(rows, parseOvertake, bySession(sessionKey)).sort((a, b) => a.at - b.at);
}

/** Car positions on track inside a time window, optionally for one car. */
export async function fetchLocations(
  sessionKey: number,
  fromMs: number,
  toMs: number,
  driverNumber?: number,
  priority: Priority = 'low',
): Promise<LocationSample[]> {
  const params: Param[] = [['session_key', '=', sessionKey]];
  if (driverNumber !== undefined) params.push(['driver_number', '=', driverNumber]);
  params.push(['date', '>', openf1Date(fromMs)], ['date', '<', openf1Date(toMs)]);
  const rows = await list('location', params, priority);
  return keep(rows, parseLocation, (r) => {
    if (!bySession(sessionKey)(r)) return false;
    if (driverNumber !== undefined && toInt(r.driver_number) !== driverNumber) return false;
    return true;
  })
    .filter((p) => p.at > fromMs && p.at < toMs)
    .sort((a, b) => a.at - b.at);
}
