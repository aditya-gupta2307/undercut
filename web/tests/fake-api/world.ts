/**
 * A synthetic Formula 1 world for end-to-end tests.
 *
 * TEST DATA ONLY. The calendar, meeting keys, circuits, roster, car numbers
 * and team colours mirror the real 2026 season (so the app is exercised on
 * realistic shapes, including the relocated "Bahrain Grand Prix in Malaysia"),
 * but every *result* is invented: races are simulated lap by lap with simple
 * physics (pace, tyre wear, fuel, pit stops, safety cars, retirements, lapped
 * cars). Both fake APIs read the same simulation, so the Jolpica classification
 * and the OpenF1 timing always agree — as they do in reality.
 */

import { mulberry32, normal, type Rng } from '../../src/lib/rng';

export interface WorldDriver {
  id: string;
  code: string;
  given: string;
  family: string;
  nationality: string;
  number: number;
  team: string;
  teamName: string;
  colour: string;
  /** Pace offset in ms per lap (lower = faster). */
  pace: number;
}

export interface CalendarEntry {
  round: number;
  name: string;
  circuitId: string;
  circuitName: string;
  locality: string;
  country: string;
  lat: number;
  lon: number;
  raceStart: number;
  sprint: boolean;
  meetingKey: number;
  circuitKey: number;
  meetingName: string;
  openf1Country: string;
  laps: number;
}

export interface SessionTimes {
  fp1: number;
  fp2?: number;
  fp3?: number;
  sprintQuali?: number;
  sprint?: number;
  quali: number;
  race: number;
}

export interface SimLap {
  lap: number;
  start: number;
  durationMs: number;
  pitOut: boolean;
  compound: string;
  tyreAge: number;
}

export interface SimCar {
  driver: WorldDriver;
  grid: number;
  qualiMs: number;
  laps: SimLap[];
  /** Crossing time of each completed lap (index = lap number). */
  crossing: number[];
  stints: { compound: string; lapStart: number; lapEnd: number; tyreAgeAtStart: number }[];
  pits: { lap: number; at: number; laneMs: number; stopMs: number }[];
  retiredOnLap: number | null;
  lapsCompleted: number;
  finishTime: number | null;
}

export interface SimRace {
  kind: 'race' | 'sprint';
  start: number;
  laps: number;
  cars: SimCar[];
  /** Classification order (finishers by laps then time, then retirements). */
  order: SimCar[];
  sc: { startLap: number; endLap: number; kind: 'SC' | 'VSC' }[];
  winnerTime: number;
}

export interface SimWeekend {
  season: number;
  entry: CalendarEntry;
  sessions: SessionTimes;
  sessionKeys: Record<string, number>;
  quali: SimCar[];
  race: SimRace | null;
  sprint: SimRace | null;
  qualiDone: boolean;
  sprintDone: boolean;
  raceDone: boolean;
  roster: WorldDriver[];
}

export interface World {
  now: number;
  seasons: Map<number, SimWeekend[]>;
  rosters: Map<number, WorldDriver[]>;
}

const DAY = 86_400_000;
const H = 3_600_000;

const ROSTER_2026: Omit<WorldDriver, 'pace'>[] = [
  { id: 'antonelli', code: 'ANT', given: 'Andrea Kimi', family: 'Antonelli', nationality: 'Italian', number: 12, team: 'mercedes', teamName: 'Mercedes', colour: '00D7B6' },
  { id: 'russell', code: 'RUS', given: 'George', family: 'Russell', nationality: 'British', number: 63, team: 'mercedes', teamName: 'Mercedes', colour: '00D7B6' },
  { id: 'hamilton', code: 'HAM', given: 'Lewis', family: 'Hamilton', nationality: 'British', number: 44, team: 'ferrari', teamName: 'Ferrari', colour: 'ED1131' },
  { id: 'leclerc', code: 'LEC', given: 'Charles', family: 'Leclerc', nationality: 'Monegasque', number: 16, team: 'ferrari', teamName: 'Ferrari', colour: 'ED1131' },
  { id: 'norris', code: 'NOR', given: 'Lando', family: 'Norris', nationality: 'British', number: 1, team: 'mclaren', teamName: 'McLaren', colour: 'F47600' },
  { id: 'piastri', code: 'PIA', given: 'Oscar', family: 'Piastri', nationality: 'Australian', number: 81, team: 'mclaren', teamName: 'McLaren', colour: 'F47600' },
  { id: 'max_verstappen', code: 'VER', given: 'Max', family: 'Verstappen', nationality: 'Dutch', number: 3, team: 'red_bull', teamName: 'Red Bull Racing', colour: '4781D7' },
  { id: 'hadjar', code: 'HAD', given: 'Isack', family: 'Hadjar', nationality: 'French', number: 6, team: 'red_bull', teamName: 'Red Bull Racing', colour: '4781D7' },
  { id: 'lawson', code: 'LAW', given: 'Liam', family: 'Lawson', nationality: 'New Zealander', number: 30, team: 'rb', teamName: 'Racing Bulls', colour: '6C98FF' },
  { id: 'arvid_lindblad', code: 'LIN', given: 'Arvid', family: 'Lindblad', nationality: 'British', number: 41, team: 'rb', teamName: 'Racing Bulls', colour: '6C98FF' },
  { id: 'gasly', code: 'GAS', given: 'Pierre', family: 'Gasly', nationality: 'French', number: 10, team: 'alpine', teamName: 'Alpine', colour: '00A1E8' },
  { id: 'colapinto', code: 'COL', given: 'Franco', family: 'Colapinto', nationality: 'Argentine', number: 43, team: 'alpine', teamName: 'Alpine', colour: '00A1E8' },
  { id: 'bearman', code: 'BEA', given: 'Oliver', family: 'Bearman', nationality: 'British', number: 87, team: 'haas', teamName: 'Haas F1 Team', colour: '9C9FA2' },
  { id: 'ocon', code: 'OCO', given: 'Esteban', family: 'Ocon', nationality: 'French', number: 31, team: 'haas', teamName: 'Haas F1 Team', colour: '9C9FA2' },
  { id: 'bortoleto', code: 'BOR', given: 'Gabriel', family: 'Bortoleto', nationality: 'Brazilian', number: 5, team: 'audi', teamName: 'Audi', colour: 'F50537' },
  { id: 'hulkenberg', code: 'HUL', given: 'Nico', family: 'Hülkenberg', nationality: 'German', number: 27, team: 'audi', teamName: 'Audi', colour: 'F50537' },
  { id: 'alonso', code: 'ALO', given: 'Fernando', family: 'Alonso', nationality: 'Spanish', number: 14, team: 'aston_martin', teamName: 'Aston Martin', colour: '229971' },
  { id: 'stroll', code: 'STR', given: 'Lance', family: 'Stroll', nationality: 'Canadian', number: 18, team: 'aston_martin', teamName: 'Aston Martin', colour: '229971' },
  { id: 'sainz', code: 'SAI', given: 'Carlos', family: 'Sainz', nationality: 'Spanish', number: 55, team: 'williams', teamName: 'Williams', colour: '1868DB' },
  { id: 'albon', code: 'ALB', given: 'Alexander', family: 'Albon', nationality: 'Thai', number: 23, team: 'williams', teamName: 'Williams', colour: '1868DB' },
  { id: 'bottas', code: 'BOT', given: 'Valtteri', family: 'Bottas', nationality: 'Finnish', number: 77, team: 'cadillac', teamName: 'Cadillac', colour: '909090' },
  { id: 'perez', code: 'PER', given: 'Sergio', family: 'Pérez', nationality: 'Mexican', number: 11, team: 'cadillac', teamName: 'Cadillac', colour: '909090' },
];

const TEAM_PACE: Record<string, number> = {
  mercedes: 0, ferrari: 250, mclaren: 300, red_bull: 330, rb: 900, alpine: 1100, haas: 1250, audi: 1400, aston_martin: 1450, williams: 1500, cadillac: 2100, sauber: 1400,
};
const DRIVER_PACE: Record<string, number> = {
  antonelli: -60, russell: 20, hamilton: 10, leclerc: -40, norris: -50, piastri: 30, max_verstappen: -120, hadjar: 60, lawson: 0, arvid_lindblad: 40,
  gasly: -30, colapinto: 50, bearman: -10, ocon: 20, bortoleto: 0, hulkenberg: 10, alonso: -40, stroll: 80, sainz: -30, albon: 10, bottas: 0, perez: 30,
  tsunoda: 20,
};

interface CalendarSeed {
  round: number;
  name: string;
  circuitId: string;
  circuitName: string;
  locality: string;
  country: string;
  lat: number;
  lon: number;
  start: string;
  sprint: boolean;
  meetingKey: number;
  circuitKey: number;
  meetingName: string;
  openf1Country: string;
  laps: number;
}

// The real 2026 calendar as published by Jolpica and OpenF1 (keys and dates are real).
const CAL_2026: CalendarSeed[] = [
  { round: 1, name: 'Australian Grand Prix', circuitId: 'albert_park', circuitName: 'Albert Park Grand Prix Circuit', locality: 'Melbourne', country: 'Australia', lat: -37.8497, lon: 144.968, start: '2026-03-08T04:00:00Z', sprint: false, meetingKey: 1279, circuitKey: 10, meetingName: 'Australian Grand Prix', openf1Country: 'Australia', laps: 58 },
  { round: 2, name: 'Chinese Grand Prix', circuitId: 'shanghai', circuitName: 'Shanghai International Circuit', locality: 'Shanghai', country: 'China', lat: 31.3389, lon: 121.22, start: '2026-03-15T07:00:00Z', sprint: true, meetingKey: 1280, circuitKey: 49, meetingName: 'Chinese Grand Prix', openf1Country: 'China', laps: 56 },
  { round: 3, name: 'Japanese Grand Prix', circuitId: 'suzuka', circuitName: 'Suzuka Circuit', locality: 'Suzuka', country: 'Japan', lat: 34.8431, lon: 136.541, start: '2026-03-29T05:00:00Z', sprint: false, meetingKey: 1281, circuitKey: 46, meetingName: 'Japanese Grand Prix', openf1Country: 'Japan', laps: 53 },
  { round: 4, name: 'Miami Grand Prix', circuitId: 'miami', circuitName: 'Miami International Autodrome', locality: 'Miami', country: 'USA', lat: 25.9581, lon: -80.2389, start: '2026-05-03T20:00:00Z', sprint: true, meetingKey: 1284, circuitKey: 151, meetingName: 'Miami Grand Prix', openf1Country: 'United States', laps: 57 },
  { round: 5, name: 'Canadian Grand Prix', circuitId: 'villeneuve', circuitName: 'Circuit Gilles Villeneuve', locality: 'Montreal', country: 'Canada', lat: 45.5, lon: -73.5228, start: '2026-05-24T20:00:00Z', sprint: true, meetingKey: 1285, circuitKey: 23, meetingName: 'Canadian Grand Prix', openf1Country: 'Canada', laps: 70 },
  { round: 6, name: 'Monaco Grand Prix', circuitId: 'monaco', circuitName: 'Circuit de Monaco', locality: 'Monte-Carlo', country: 'Monaco', lat: 43.7347, lon: 7.42056, start: '2026-06-07T13:00:00Z', sprint: false, meetingKey: 1286, circuitKey: 22, meetingName: 'Monaco Grand Prix', openf1Country: 'Monaco', laps: 78 },
  { round: 7, name: 'Barcelona Grand Prix', circuitId: 'catalunya', circuitName: 'Circuit de Barcelona-Catalunya', locality: 'Montmeló', country: 'Spain', lat: 41.57, lon: 2.26111, start: '2026-06-14T13:00:00Z', sprint: false, meetingKey: 1287, circuitKey: 15, meetingName: 'Barcelona Grand Prix', openf1Country: 'Spain', laps: 66 },
  { round: 8, name: 'Austrian Grand Prix', circuitId: 'red_bull_ring', circuitName: 'Red Bull Ring', locality: 'Spielberg', country: 'Austria', lat: 47.2197, lon: 14.7647, start: '2026-06-28T13:00:00Z', sprint: false, meetingKey: 1288, circuitKey: 19, meetingName: 'Austrian Grand Prix', openf1Country: 'Austria', laps: 71 },
  { round: 9, name: 'British Grand Prix', circuitId: 'silverstone', circuitName: 'Silverstone Circuit', locality: 'Silverstone', country: 'UK', lat: 52.0786, lon: -1.01694, start: '2026-07-05T14:00:00Z', sprint: true, meetingKey: 1289, circuitKey: 2, meetingName: 'British Grand Prix', openf1Country: 'United Kingdom', laps: 52 },
  { round: 10, name: 'Belgian Grand Prix', circuitId: 'spa', circuitName: 'Circuit de Spa-Francorchamps', locality: 'Spa', country: 'Belgium', lat: 50.4372, lon: 5.97139, start: '2026-07-19T13:00:00Z', sprint: false, meetingKey: 1290, circuitKey: 7, meetingName: 'Belgian Grand Prix', openf1Country: 'Belgium', laps: 44 },
  { round: 11, name: 'Hungarian Grand Prix', circuitId: 'hungaroring', circuitName: 'Hungaroring', locality: 'Budapest', country: 'Hungary', lat: 47.5789, lon: 19.2486, start: '2026-07-26T13:00:00Z', sprint: false, meetingKey: 1291, circuitKey: 4, meetingName: 'Hungarian Grand Prix', openf1Country: 'Hungary', laps: 70 },
  { round: 12, name: 'Dutch Grand Prix', circuitId: 'zandvoort', circuitName: 'Circuit Park Zandvoort', locality: 'Zandvoort', country: 'Netherlands', lat: 52.3888, lon: 4.54092, start: '2026-08-23T13:00:00Z', sprint: true, meetingKey: 1292, circuitKey: 55, meetingName: 'Dutch Grand Prix', openf1Country: 'Netherlands', laps: 72 },
  { round: 13, name: 'Italian Grand Prix', circuitId: 'monza', circuitName: 'Autodromo Nazionale di Monza', locality: 'Monza', country: 'Italy', lat: 45.6156, lon: 9.28111, start: '2026-09-06T13:00:00Z', sprint: false, meetingKey: 1293, circuitKey: 39, meetingName: 'Italian Grand Prix', openf1Country: 'Italy', laps: 53 },
  { round: 14, name: 'Spanish Grand Prix', circuitId: 'madring', circuitName: 'Madring', locality: 'Madrid', country: 'Spain', lat: 40.4637, lon: -3.6197, start: '2026-09-13T13:00:00Z', sprint: false, meetingKey: 1294, circuitKey: 153, meetingName: 'Spanish Grand Prix', openf1Country: 'Spain', laps: 57 },
  { round: 15, name: 'Azerbaijan Grand Prix', circuitId: 'baku', circuitName: 'Baku City Circuit', locality: 'Baku', country: 'Azerbaijan', lat: 40.3725, lon: 49.8533, start: '2026-09-26T11:00:00Z', sprint: false, meetingKey: 1295, circuitKey: 144, meetingName: 'Azerbaijan Grand Prix', openf1Country: 'Azerbaijan', laps: 51 },
  { round: 16, name: 'Bahrain Grand Prix in Malaysia', circuitId: 'sepang', circuitName: 'Sepang International Circuit', locality: 'Kuala Lumpur', country: 'Malaysia', lat: 2.76083, lon: 101.738, start: '2026-10-04T07:00:00Z', sprint: false, meetingKey: 1308, circuitKey: 12, meetingName: 'Bahrain Grand Prix', openf1Country: 'Bahrain', laps: 55 },
  { round: 17, name: 'Singapore Grand Prix', circuitId: 'marina_bay', circuitName: 'Marina Bay Street Circuit', locality: 'Marina Bay', country: 'Singapore', lat: 1.2914, lon: 103.864, start: '2026-10-11T12:00:00Z', sprint: true, meetingKey: 1296, circuitKey: 61, meetingName: 'Singapore Grand Prix', openf1Country: 'Singapore', laps: 62 },
  { round: 18, name: 'United States Grand Prix', circuitId: 'americas', circuitName: 'Circuit of the Americas', locality: 'Austin', country: 'USA', lat: 30.1328, lon: -97.6411, start: '2026-10-25T20:00:00Z', sprint: false, meetingKey: 1297, circuitKey: 9, meetingName: 'United States Grand Prix', openf1Country: 'United States', laps: 56 },
  { round: 19, name: 'Mexico City Grand Prix', circuitId: 'rodriguez', circuitName: 'Autódromo Hermanos Rodríguez', locality: 'Mexico City', country: 'Mexico', lat: 19.4042, lon: -99.0907, start: '2026-11-01T20:00:00Z', sprint: false, meetingKey: 1298, circuitKey: 65, meetingName: 'Mexico City Grand Prix', openf1Country: 'Mexico', laps: 71 },
  { round: 20, name: 'Brazilian Grand Prix', circuitId: 'interlagos', circuitName: 'Autódromo José Carlos Pace', locality: 'São Paulo', country: 'Brazil', lat: -23.7036, lon: -46.6997, start: '2026-11-08T17:00:00Z', sprint: false, meetingKey: 1299, circuitKey: 14, meetingName: 'São Paulo Grand Prix', openf1Country: 'Brazil', laps: 71 },
  { round: 21, name: 'Las Vegas Grand Prix', circuitId: 'vegas', circuitName: 'Las Vegas Strip Street Circuit', locality: 'Las Vegas', country: 'USA', lat: 36.1147, lon: -115.173, start: '2026-11-22T04:00:00Z', sprint: false, meetingKey: 1300, circuitKey: 152, meetingName: 'Las Vegas Grand Prix', openf1Country: 'United States', laps: 50 },
  { round: 22, name: 'Qatar Grand Prix', circuitId: 'losail', circuitName: 'Losail International Circuit', locality: 'Al Daayen', country: 'Qatar', lat: 25.49, lon: 51.4542, start: '2026-11-29T16:00:00Z', sprint: false, meetingKey: 1301, circuitKey: 150, meetingName: 'Qatar Grand Prix', openf1Country: 'Qatar', laps: 57 },
  { round: 23, name: 'Abu Dhabi Grand Prix', circuitId: 'yas_marina', circuitName: 'Yas Marina Circuit', locality: 'Abu Dhabi', country: 'UAE', lat: 24.4672, lon: 54.6031, start: '2026-12-06T13:00:00Z', sprint: false, meetingKey: 1302, circuitKey: 70, meetingName: 'Abu Dhabi Grand Prix', openf1Country: 'United Arab Emirates', laps: 58 },
];

/** A plausible 2025 calendar reusing the same circuits (synthetic dates and keys). */
function calendar2025(): CalendarSeed[] {
  const circuits = [...CAL_2026.filter((c) => c.circuitId !== 'madring' && c.circuitId !== 'sepang')];
  const extras: CalendarSeed[] = [
    { ...CAL_2026[0]!, round: 0, name: 'Bahrain Grand Prix', circuitId: 'bahrain', circuitName: 'Bahrain International Circuit', locality: 'Sakhir', country: 'Bahrain', lat: 26.0325, lon: 50.5106, circuitKey: 63, meetingName: 'Bahrain Grand Prix', openf1Country: 'Bahrain', laps: 57, sprint: false },
    { ...CAL_2026[0]!, round: 0, name: 'Saudi Arabian Grand Prix', circuitId: 'jeddah', circuitName: 'Jeddah Corniche Circuit', locality: 'Jeddah', country: 'Saudi Arabia', lat: 21.6319, lon: 39.1044, circuitKey: 149, meetingName: 'Saudi Arabian Grand Prix', openf1Country: 'Saudi Arabia', laps: 50, sprint: false },
    { ...CAL_2026[0]!, round: 0, name: 'Emilia Romagna Grand Prix', circuitId: 'imola', circuitName: 'Autodromo Enzo e Dino Ferrari', locality: 'Imola', country: 'Italy', lat: 44.3439, lon: 11.7167, circuitKey: 6, meetingName: 'Emilia Romagna Grand Prix', openf1Country: 'Italy', laps: 63, sprint: false },
  ];
  const all = [...circuits.slice(0, 3), extras[0]!, extras[1]!, circuits[3]!, extras[2]!, ...circuits.slice(4)];
  const first = Date.UTC(2025, 2, 16, 4);
  return all.slice(0, 24).map((c, i) => ({
    ...c,
    round: i + 1,
    start: new Date(first + i * 11 * DAY).toISOString(),
    meetingKey: 1250 + i,
    sprint: [2, 6, 13, 19, 21].includes(i + 1),
  }));
}

function sessionTimes(start: number, sprint: boolean): SessionTimes {
  return sprint
    ? { fp1: start - 2 * DAY - 3.5 * H, sprintQuali: start - 2 * DAY + 0.5 * H, sprint: start - DAY - 3 * H, quali: start - DAY + H, race: start }
    : { fp1: start - 2 * DAY - 3.5 * H, fp2: start - 2 * DAY, fp3: start - DAY - 3.5 * H, quali: start - DAY, race: start };
}

const COMPOUND_OFFSET: Record<string, number> = { SOFT: -650, MEDIUM: 0, HARD: 420 };
const COMPOUND_DEG: Record<string, number> = { SOFT: 85, MEDIUM: 48, HARD: 24 };

function pickStrategy(rng: Rng, laps: number, sprint: boolean): { compound: string; laps: number }[] {
  if (sprint) return [{ compound: rng() < 0.5 ? 'MEDIUM' : 'SOFT', laps }];
  const r = rng();
  if (r < 0.45) {
    const p = Math.round(laps * (0.35 + rng() * 0.15));
    return [{ compound: 'MEDIUM', laps: p }, { compound: 'HARD', laps: laps - p }];
  }
  if (r < 0.75) {
    const p = Math.round(laps * (0.25 + rng() * 0.1));
    return [{ compound: 'SOFT', laps: p }, { compound: 'HARD', laps: laps - p }];
  }
  if (r < 0.88) {
    const p = Math.round(laps * (0.5 + rng() * 0.1));
    return [{ compound: 'HARD', laps: p }, { compound: 'MEDIUM', laps: laps - p }];
  }
  const p1 = Math.round(laps * 0.28);
  const p2 = Math.round(laps * 0.62);
  return [{ compound: 'SOFT', laps: p1 }, { compound: 'MEDIUM', laps: p2 - p1 }, { compound: 'HARD', laps: laps - p2 }];
}

function simulateRace(rng: Rng, grid: SimCar[], start: number, totalLaps: number, kind: 'race' | 'sprint', baseLap: number): SimRace {
  const cars: SimCar[] = grid.map((q, slot) => ({
    driver: q.driver,
    grid: slot + 1,
    qualiMs: q.qualiMs,
    laps: [],
    crossing: [start],
    stints: [],
    pits: [],
    retiredOnLap: null,
    lapsCompleted: 0,
    finishTime: null,
  }));
  const plans = cars.map(() => pickStrategy(rng, totalLaps, kind === 'sprint'));
  const dayForm = cars.map(() => normal(rng) * 120);
  const retire = cars.map(() => (rng() < (kind === 'sprint' ? 0.03 : 0.085) ? 2 + Math.floor(rng() * (totalLaps - 3)) : null));
  // Safety car: about half of races, 3-5 laps.
  const sc: SimRace['sc'] = [];
  if (kind === 'race' && rng() < 0.55) {
    const s = 5 + Math.floor(rng() * (totalLaps - 15));
    sc.push({ startLap: s, endLap: s + 2 + Math.floor(rng() * 3), kind: rng() < 0.7 ? 'SC' : 'VSC' });
  }
  const scLap = (L: number) => sc.find((p) => L >= p.startLap && L <= p.endLap) ?? null;

  // Stint bookkeeping per car.
  const stintIdx = cars.map(() => 0);
  const stintLap = cars.map(() => 0);
  cars.forEach((c, i) => c.stints.push({ compound: plans[i]![0]!.compound, lapStart: 1, lapEnd: plans[i]![0]!.laps, tyreAgeAtStart: rng() < 0.4 ? 3 : 0 }));

  for (let L = 1; L <= totalLaps; L++) {
    const neutral = scLap(L);
    // Natural lap times.
    const natural: number[] = cars.map((c, i) => {
      if (c.retiredOnLap !== null) return Number.NaN;
      const plan = plans[i]!;
      const st = plan[stintIdx[i]!]!;
      const age = (c.stints[stintIdx[i]!]!.tyreAgeAtStart) + stintLap[i]!;
      let t = baseLap + c.driver.pace + dayForm[i]! + (COMPOUND_OFFSET[st.compound] ?? 0) + (COMPOUND_DEG[st.compound] ?? 0) * age - 55 * L + normal(rng) * 230;
      if (L === 1) t += 2600 + (c.grid - 1) * 260;
      const inLap = stintLap[i]! === st.laps - 1 && stintIdx[i]! < plan.length - 1;
      if (inLap) t += 9500;
      if (stintLap[i]! === 0 && stintIdx[i]! > 0) t += 11500;
      if (neutral) t = neutral.kind === 'SC' ? 128_000 + normal(rng) * 400 : 118_000 + normal(rng) * 400;
      return t;
    });
    // Crossing times; under a safety car the field bunches up behind the leader.
    const prov = cars.map((c, i) => (Number.isNaN(natural[i]!) ? Number.NaN : c.crossing[L - 1]! + natural[i]!));
    if (neutral && neutral.kind === 'SC') {
      const order = cars.map((_, i) => i).filter((i) => !Number.isNaN(prov[i]!)).sort((a, b) => prov[a]! - prov[b]!);
      order.forEach((i, rank) => {
        if (rank === 0) return;
        const leader = prov[order[0]!]!;
        if (prov[i]! - leader < 90_000) prov[i] = Math.max(leader + rank * 850, prov[i]! - 0.6 * (prov[i]! - leader));
      });
    }
    cars.forEach((c, i) => {
      if (Number.isNaN(prov[i]!)) return;
      const plan = plans[i]!;
      const st = plan[stintIdx[i]!]!;
      const lapStart = c.crossing[L - 1]!;
      if (retire[i] === L) {
        // Retires during this lap: a partial lap record with no duration.
        c.laps.push({ lap: L, start: lapStart, durationMs: Number.NaN, pitOut: stintLap[i]! === 0 && stintIdx[i]! > 0, compound: st.compound, tyreAge: stintLap[i]! });
        c.retiredOnLap = L;
        c.stints[stintIdx[i]!]!.lapEnd = L;
        return;
      }
      c.laps.push({ lap: L, start: lapStart, durationMs: prov[i]! - lapStart, pitOut: stintLap[i]! === 0 && stintIdx[i]! > 0, compound: st.compound, tyreAge: stintLap[i]! });
      c.crossing[L] = prov[i]!;
      c.lapsCompleted = L;
      stintLap[i]!++;
      if (stintLap[i]! >= st.laps && stintIdx[i]! < plan.length - 1) {
        c.pits.push({ lap: L, at: prov[i]! - 4000, laneMs: 20_500 + rng() * 2500, stopMs: 2000 + rng() * 1400 });
        stintIdx[i]!++;
        stintLap[i] = 0;
        const next = plan[stintIdx[i]!]!;
        c.stints.push({ compound: next.compound, lapStart: L + 1, lapEnd: L + next.laps, tyreAgeAtStart: 0 });
      }
    });
  }

  // The chequered flag falls when the leader completes the distance; everyone
  // else finishes on the lap they are on, so lapped cars complete fewer laps.
  const finishers = cars.filter((c) => c.retiredOnLap === null);
  const winnerTime = Math.min(...finishers.map((c) => c.crossing[totalLaps]!));
  for (const c of finishers) {
    let L = 1;
    while (L < totalLaps && c.crossing[L]! < winnerTime) L++;
    c.lapsCompleted = L;
    c.finishTime = c.crossing[L]!;
    c.laps = c.laps.filter((l) => l.lap <= L);
    c.crossing = c.crossing.slice(0, L + 1);
    c.stints = c.stints.filter((s) => s.lapStart <= L).map((s) => ({ ...s, lapEnd: Math.min(s.lapEnd, L) }));
    c.pits = c.pits.filter((p) => p.lap < L);
  }
  for (const c of cars.filter((c) => c.retiredOnLap !== null)) c.lapsCompleted = c.retiredOnLap! - 1;

  const order = [
    ...finishers.sort((a, b) => b.lapsCompleted - a.lapsCompleted || a.finishTime! - b.finishTime!),
    ...cars.filter((c) => c.retiredOnLap !== null).sort((a, b) => b.lapsCompleted - a.lapsCompleted),
  ];
  return { kind, start, laps: totalLaps, cars, order, sc, winnerTime };
}

function simulateQuali(rng: Rng, roster: WorldDriver[], baseLap: number): SimCar[] {
  return roster
    .map((d) => ({
      driver: d,
      grid: 0,
      qualiMs: Math.round(baseLap - 4000 + d.pace + normal(rng) * 160),
      laps: [],
      crossing: [],
      stints: [],
      pits: [],
      retiredOnLap: null,
      lapsCompleted: 0,
      finishTime: null,
    }))
    .sort((a, b) => a.qualiMs - b.qualiMs);
}

function rosterFor(season: number): WorldDriver[] {
  const base = ROSTER_2026.map((d) => ({ ...d, pace: (TEAM_PACE[d.team] ?? 1500) + (DRIVER_PACE[d.id] ?? 0) }));
  if (season === 2026) return base;
  // 2025: no Cadillac, Audi was still Sauber, Tsunoda in the second Red Bull.
  return base
    .filter((d) => d.team !== 'cadillac' && d.id !== 'arvid_lindblad')
    .map((d) => (d.team === 'audi' ? { ...d, team: 'sauber', teamName: 'Kick Sauber', colour: '52E252', pace: TEAM_PACE.sauber! + (DRIVER_PACE[d.id] ?? 0) } : d))
    .map((d) => (d.id === 'hadjar' ? { ...d, team: 'rb', teamName: 'Racing Bulls', colour: '6C98FF', pace: TEAM_PACE.rb! } : d))
    .concat([{ id: 'tsunoda', code: 'TSU', given: 'Yuki', family: 'Tsunoda', nationality: 'Japanese', number: 22, team: 'red_bull', teamName: 'Red Bull Racing', colour: '4781D7', pace: TEAM_PACE.red_bull! + 200 }])
    .map((d) => ({ ...d, pace: d.pace + (d.team === 'mercedes' ? 350 : d.team === 'mclaren' ? -300 : 0) }));
}

export function buildWorld(now: number): World {
  const seasons = new Map<number, SimWeekend[]>();
  const rosters = new Map<number, WorldDriver[]>();
  let sessionKey = 9800;
  for (const season of [2025, 2026]) {
    const roster = rosterFor(season);
    rosters.set(season, roster);
    const cal = season === 2026 ? CAL_2026 : calendar2025();
    const weekends: SimWeekend[] = [];
    for (const c of cal) {
      const rng = mulberry32(season * 1000 + c.round);
      const raceStart = Date.parse(c.start);
      const entry: CalendarEntry = { ...c, raceStart };
      const sessions = sessionTimes(raceStart, c.sprint);
      const keys: Record<string, number> = {};
      for (const name of Object.keys(sessions)) keys[name] = sessionKey++;
      const baseLap = 88_000 + (c.circuitKey % 9) * 1700;
      const quali = simulateQuali(rng, roster, baseLap);
      const qualiDone = sessions.quali + H < now;
      const sprintDone = c.sprint && sessions.sprint! + 0.75 * H < now;
      const raceDone = raceStart + 2.2 * H < now;
      let sprint: SimRace | null = null;
      if (c.sprint) {
        const sq = simulateQuali(rng, roster, baseLap);
        sprint = simulateRace(rng, sq, sessions.sprint!, Math.round(c.laps / 3), 'sprint', baseLap);
      }
      const race = simulateRace(rng, quali, raceStart, c.laps, 'race', baseLap);
      weekends.push({ season, entry, sessions, sessionKeys: keys, quali, race, sprint, qualiDone, sprintDone, raceDone, roster });
    }
    seasons.set(season, weekends);
  }
  return { now, seasons, rosters };
}

/** Track outline for a circuit key: a closed curve with circuit-specific character. */
export function trackPoint(circuitKey: number, t: number): { x: number; y: number } {
  const a = 1 + (circuitKey % 5) * 0.12;
  const b = 0.25 + (circuitKey % 3) * 0.1;
  const c = 0.12 + (circuitKey % 4) * 0.05;
  const th = 2 * Math.PI * t;
  const r = 1 + b * Math.cos(2 * th + circuitKey) + c * Math.sin(3 * th);
  return { x: 5200 * a * r * Math.cos(th), y: 3600 * r * Math.sin(th) + 600 * Math.sin(2 * th) };
}

export const RACE_POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const SPRINT_POINTS = [8, 7, 6, 5, 4, 3, 2, 1];
