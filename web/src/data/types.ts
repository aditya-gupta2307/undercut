/**
 * Domain model. Raw API responses are converted into these shapes in exactly
 * one place (jolpica.ts / openf1.ts); nothing else in the app touches raw JSON.
 * Times are epoch milliseconds (UTC); durations are milliseconds.
 */

export interface Circuit {
  id: string;
  name: string;
  locality: string;
  country: string;
  lat: number | null;
  lon: number | null;
}

export interface SessionTimes {
  fp1?: number;
  fp2?: number;
  fp3?: number;
  sprintQuali?: number;
  sprint?: number;
  quali?: number;
  race?: number;
}

/** One Grand Prix weekend, as listed in the Jolpica calendar. */
export interface RaceEvent {
  season: number;
  round: number;
  name: string;
  circuit: Circuit;
  /** Race start, epoch ms. Null for older events published without a time. */
  start: number | null;
  /** Race date, YYYY-MM-DD (UTC). */
  date: string;
  sessions: SessionTimes;
  hasSprint: boolean;
  wikiUrl: string | null;
}

export interface DriverInfo {
  id: string;
  code: string;
  permanentNumber: number | null;
  givenName: string;
  familyName: string;
  nationality: string;
  dateOfBirth: string | null;
}

export interface TeamInfo {
  id: string;
  name: string;
  nationality: string;
}

/**
 * finished: took the flag and was classified (includes lapped cars).
 * dnf:      started but did not finish (even if classified on distance).
 * dsq:      disqualified or excluded.
 * dns:      entered but did not take the start (or withdrew / failed to qualify).
 */
export type FinishStatus = 'finished' | 'dnf' | 'dsq' | 'dns';

export interface ResultRow {
  driverId: string;
  teamId: string;
  carNumber: number | null;
  /** Starting grid slot; 0 means a pit-lane start; null when unknown. */
  grid: number | null;
  /** Classified finishing position, or null when not classified. */
  position: number | null;
  /** Order in which the result was listed (always 1..n) — useful for display. */
  order: number;
  positionText: string;
  points: number;
  laps: number;
  status: string;
  finish: FinishStatus;
  /** Total race time in ms for classified cars that have one. */
  timeMs: number | null;
  /** As published: "1:47:14.808" for the winner, "+2.307" for others. */
  timeText: string | null;
  fastestLapRank: number | null;
  fastestLapNumber: number | null;
  fastestLapMs: number | null;
}

export interface QualiRow {
  driverId: string;
  teamId: string;
  carNumber: number | null;
  position: number;
  q1Ms: number | null;
  q2Ms: number | null;
  q3Ms: number | null;
}

export interface DriverStanding {
  driverId: string;
  teamIds: string[];
  position: number | null;
  positionText: string;
  points: number;
  wins: number;
}

export interface TeamStanding {
  teamId: string;
  position: number | null;
  positionText: string;
  points: number;
  wins: number;
}

export interface Season {
  year: number;
  events: RaceEvent[];
  drivers: Record<string, DriverInfo>;
  teams: Record<string, TeamInfo>;
  /** Grand Prix results keyed by round. */
  results: Record<number, ResultRow[]>;
  /** Sprint results keyed by round. */
  sprints: Record<number, ResultRow[]>;
  qualifying: Record<number, QualiRow[]>;
  driverStandings: DriverStanding[];
  teamStandings: TeamStanding[];
  standingsRound: number | null;
  fetchedAt: number;
}

// ---------------------------------------------------------------------------
// OpenF1 (timing data, 2023 onwards)
// ---------------------------------------------------------------------------

export interface Meeting {
  key: number;
  name: string;
  officialName: string;
  year: number;
  circuitKey: number;
  circuitShortName: string;
  location: string;
  countryName: string;
  countryCode: string;
  start: number;
  end: number;
  gmtOffset: string;
  cancelled: boolean;
}

export type SessionName =
  | 'Practice 1'
  | 'Practice 2'
  | 'Practice 3'
  | 'Qualifying'
  | 'Sprint Qualifying'
  | 'Sprint Shootout'
  | 'Sprint'
  | 'Race'
  | string;

export interface F1Session {
  key: number;
  meetingKey: number;
  name: SessionName;
  type: string;
  start: number;
  end: number;
  circuitKey: number;
  circuitShortName: string;
  year: number;
  gmtOffset: string;
  cancelled: boolean;
}

export interface SessionDriver {
  number: number;
  acronym: string;
  fullName: string;
  firstName: string;
  lastName: string;
  teamName: string;
  teamColour: string | null;
}

export interface Lap {
  driverNumber: number;
  lap: number;
  start: number | null;
  durationMs: number | null;
  s1Ms: number | null;
  s2Ms: number | null;
  s3Ms: number | null;
  pitOutLap: boolean;
  speedTrap: number | null;
}

export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET' | 'UNKNOWN';

export interface Stint {
  driverNumber: number;
  stint: number;
  compound: Compound;
  lapStart: number;
  lapEnd: number;
  tyreAgeAtStart: number;
}

export interface PitStop {
  driverNumber: number;
  lap: number;
  at: number;
  laneMs: number | null;
  stopMs: number | null;
}

export interface RaceControlMessage {
  at: number;
  lap: number | null;
  category: string;
  flag: string | null;
  scope: string | null;
  sector: number | null;
  driverNumber: number | null;
  message: string;
}

export interface WeatherSample {
  at: number;
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  pressure: number | null;
  rainfall: boolean;
  windSpeed: number | null;
  windDirection: number | null;
}

export interface SessionResultRow {
  driverNumber: number;
  position: number | null;
  laps: number;
  points: number | null;
  dnf: boolean;
  dns: boolean;
  dsq: boolean;
  /** Seconds-based durations converted to ms; null for lapped or non-finishers. */
  durationMs: number | null;
  /** Gap in ms when on the lead lap; null otherwise. */
  gapMs: number | null;
  /** Laps behind the leader (from "+1 LAP" style gaps), else 0. */
  lapsDown: number;
}

export interface GridSlot {
  driverNumber: number;
  position: number;
  lapMs: number | null;
}

export interface PositionSample {
  at: number;
  driverNumber: number;
  position: number;
}

export interface TeamRadio {
  at: number;
  driverNumber: number;
  url: string;
}

export interface LocationSample {
  at: number;
  driverNumber: number;
  x: number;
  y: number;
}

export interface Overtake {
  at: number;
  overtaking: number;
  overtaken: number;
  position: number;
}

export interface IntervalSample {
  at: number;
  driverNumber: number;
  gapToLeaderMs: number | null;
  intervalMs: number | null;
  lapsDown: number;
}
