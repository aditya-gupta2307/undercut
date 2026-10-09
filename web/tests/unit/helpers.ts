/**
 * Synthetic seasons for tests: results are *sampled from* a Plackett–Luce
 * model with known strengths, so a correct fitter must recover them.
 */

import { gumbel, mulberry32, type Rng } from '../../src/lib/rng';
import type { QualiRow, RaceEvent, ResultRow, Season } from '../../src/data/types';

export interface SynthDriver {
  id: string;
  code: string;
  team: string;
  /** True log-strength in the race. */
  race: number;
  /** True log-strength in qualifying. */
  quali: number;
  dnf: number;
}

export function sampleOrder(strengths: number[], rng: Rng): number[] {
  const keys = strengths.map((s) => s + gumbel(rng));
  return strengths.map((_, i) => i).sort((a, b) => keys[b]! - keys[a]!);
}

export function makeEvent(year: number, round: number, opts: { sprint?: boolean; start?: number } = {}): RaceEvent {
  const start = opts.start ?? Date.UTC(year, 2, 1) + (round - 1) * 14 * 86_400_000 + 14 * 3_600_000;
  const day = 86_400_000;
  return {
    season: year,
    round,
    name: `Test Grand Prix ${round}`,
    circuit: { id: `circuit_${round}`, name: `Circuit ${round}`, locality: 'Town', country: 'Country', lat: 0, lon: 0 },
    start,
    date: new Date(start).toISOString().slice(0, 10),
    sessions: opts.sprint
      ? { fp1: start - 2 * day, sprintQuali: start - 2 * day + 4 * 3_600_000, sprint: start - day, quali: start - day + 4 * 3_600_000, race: start }
      : { fp1: start - 2 * day, fp2: start - 2 * day + 4 * 3_600_000, fp3: start - day, quali: start - day + 4 * 3_600_000, race: start },
    hasSprint: Boolean(opts.sprint),
    wikiUrl: null,
  };
}

export function makeSeason(
  year: number,
  drivers: SynthDriver[],
  opts: { rounds: number; completed: number; seed: number; sprintRounds?: number[]; gridBeta?: number },
): Season {
  const rng = mulberry32(opts.seed);
  const events: RaceEvent[] = [];
  const results: Record<number, ResultRow[]> = {};
  const sprints: Record<number, ResultRow[]> = {};
  const qualifying: Record<number, QualiRow[]> = {};
  const beta = opts.gridBeta ?? 0.6;
  const points = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];

  const runRace = (grid: number[], isSprint: boolean): ResultRow[] => {
    // grid[i] = slot for driver i
    const s = drivers.map((d, i) => d.race + beta * -Math.log(grid[i]!));
    const dnf = drivers.map((d) => rng() < d.dnf * (isSprint ? 0.35 : 1));
    const finishers = sampleOrder(s, rng).filter((i) => !dnf[i]);
    const retirees = drivers.map((_, i) => i).filter((i) => dnf[i]);
    const rows: ResultRow[] = [];
    finishers.forEach((i, pos) => {
      const d = drivers[i]!;
      rows.push({
        driverId: d.id,
        teamId: d.team,
        carNumber: i + 1,
        grid: grid[i]!,
        position: pos + 1,
        order: pos + 1,
        positionText: String(pos + 1),
        points: isSprint ? Math.max(0, 8 - pos) : (points[pos] ?? 0),
        laps: isSprint ? 20 : 57,
        status: 'Finished',
        finish: 'finished',
        timeMs: 5_400_000 + pos * 4000,
        timeText: pos === 0 ? '1:30:00.000' : `+${(pos * 4).toFixed(3)}`,
        fastestLapRank: null,
        fastestLapNumber: null,
        fastestLapMs: null,
      });
    });
    retirees.forEach((i, k) => {
      const d = drivers[i]!;
      const order = finishers.length + k + 1;
      rows.push({
        driverId: d.id,
        teamId: d.team,
        carNumber: i + 1,
        grid: grid[i]!,
        position: null,
        order,
        positionText: 'R',
        points: 0,
        laps: 10,
        status: 'Retired',
        finish: 'dnf',
        timeMs: null,
        timeText: null,
        fastestLapRank: null,
        fastestLapNumber: null,
        fastestLapMs: null,
      });
    });
    return rows;
  };

  for (let round = 1; round <= opts.rounds; round++) {
    const sprint = opts.sprintRounds?.includes(round) ?? false;
    const ev = makeEvent(year, round, { sprint });
    events.push(ev);
    if (round > opts.completed) continue;
    const qOrder = sampleOrder(drivers.map((d) => d.quali), rng);
    const grid = new Array<number>(drivers.length);
    qOrder.forEach((i, slot) => (grid[i] = slot + 1));
    qualifying[round] = qOrder.map((i, slot) => ({
      driverId: drivers[i]!.id,
      teamId: drivers[i]!.team,
      carNumber: i + 1,
      position: slot + 1,
      q1Ms: 90_000 + slot * 100,
      q2Ms: slot < 16 ? 89_500 + slot * 100 : null,
      q3Ms: slot < 10 ? 89_000 + slot * 100 : null,
    }));
    if (sprint) sprints[round] = runRace(grid, true);
    results[round] = runRace(grid, false);
  }

  const drv: Season['drivers'] = {};
  const teams: Season['teams'] = {};
  drivers.forEach((d, i) => {
    drv[d.id] = { id: d.id, code: d.code, permanentNumber: i + 1, givenName: d.id, familyName: d.id, nationality: 'X', dateOfBirth: null };
    teams[d.team] = { id: d.team, name: d.team, nationality: 'X' };
  });

  return {
    year,
    events,
    drivers: drv,
    teams,
    results,
    sprints,
    qualifying,
    driverStandings: [],
    teamStandings: [],
    standingsRound: opts.completed,
    fetchedAt: 0,
  };
}

/** Ten teams of two with well-separated true strengths. */
export function standardGrid(): SynthDriver[] {
  const teams = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet'];
  const out: SynthDriver[] = [];
  teams.forEach((t, ti) => {
    const car = 2.4 - ti * 0.5;
    out.push({ id: `${t}_a`, code: `${t.slice(0, 2).toUpperCase()}A`, team: t, race: car + 0.25, quali: car + 0.2, dnf: 0.08 });
    out.push({ id: `${t}_b`, code: `${t.slice(0, 2).toUpperCase()}B`, team: t, race: car - 0.25, quali: car - 0.2, dnf: 0.08 });
  });
  return out;
}
