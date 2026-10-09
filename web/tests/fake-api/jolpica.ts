/**
 * Fake Jolpica server over the synthetic world. Mimics the real API's shape
 * and behaviour: string-typed numbers, absent optional blocks, row-level
 * pagination (so a race can split across pages), "R" for retirements,
 * classified-but-retired cars, empty-string Q2 times, standings with
 * constructor arrays, and status values from the 2025+ enumeration.
 */

import { RACE_POINTS, SPRINT_POINTS, type SimCar, type SimRace, type SimWeekend, type World, type WorldDriver } from './world';

const iso = (ms: number) => new Date(ms).toISOString();
const dateOf = (ms: number) => iso(ms).slice(0, 10);
const timeOf = (ms: number) => iso(ms).slice(11, 19) + 'Z';

function fmtRaceTime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = (ms % 60_000) / 1000;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
}

function fmtGap(ms: number): string {
  if (ms >= 60_000) {
    const m = Math.floor(ms / 60_000);
    return `+${m}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, '0')}`;
  }
  return `+${(ms / 1000).toFixed(3)}`;
}

function fmtLap(ms: number): string {
  const m = Math.floor(ms / 60_000);
  return `${m}:${((ms % 60_000) / 1000).toFixed(3).padStart(6, '0')}`;
}

const driverJson = (d: WorldDriver) => ({
  driverId: d.id,
  permanentNumber: String(d.number),
  code: d.code,
  url: `http://en.wikipedia.org/wiki/${encodeURIComponent(d.family)}`,
  givenName: d.given,
  familyName: d.family,
  dateOfBirth: '2000-01-01',
  nationality: d.nationality,
});

const constructorJson = (d: WorldDriver) => ({ constructorId: d.team, url: 'http://en.wikipedia.org/', name: d.teamName, nationality: 'Various' });

function raceJson(w: SimWeekend) {
  const e = w.entry;
  const s = w.sessions;
  const obj: Record<string, unknown> = {
    season: String(w.season),
    round: String(e.round),
    url: `https://en.wikipedia.org/wiki/${w.season}_${e.name.replace(/ /g, '_')}`,
    raceName: e.name,
    Circuit: {
      circuitId: e.circuitId,
      url: 'https://en.wikipedia.org/',
      circuitName: e.circuitName,
      Location: { lat: String(e.lat), long: String(e.lon), locality: e.locality, country: e.country },
    },
    date: dateOf(e.raceStart),
    time: timeOf(e.raceStart),
  };
  const sess = (ms: number | undefined) => (ms === undefined ? undefined : { date: dateOf(ms), time: timeOf(ms) });
  obj.FirstPractice = sess(s.fp1);
  if (s.fp2) obj.SecondPractice = sess(s.fp2);
  if (s.fp3) obj.ThirdPractice = sess(s.fp3);
  obj.Qualifying = sess(s.quali);
  if (s.sprint) obj.Sprint = sess(s.sprint);
  if (s.sprintQuali) obj.SprintQualifying = sess(s.sprintQuali);
  return obj;
}

function classification(race: SimRace, points: number[]) {
  const leaderLaps = race.order[0]!.lapsCompleted;
  const fastest = [...race.cars]
    .map((c) => ({ c, best: Math.min(...c.laps.filter((l) => Number.isFinite(l.durationMs) && l.lap > 1).map((l) => l.durationMs)) }))
    .filter((x) => Number.isFinite(x.best))
    .sort((a, b) => a.best - b.best);
  return race.order.map((c, idx) => {
    const finished = c.retiredOnLap === null;
    const classified = finished || c.lapsCompleted >= Math.ceil(race.laps * 0.9);
    const pos = idx + 1;
    const flRank = fastest.findIndex((x) => x.c === c);
    const row: Record<string, unknown> = {
      number: String(c.driver.number),
      position: String(pos),
      positionText: classified ? String(pos) : 'R',
      points: String(classified ? (points[idx] ?? 0) : 0),
      Driver: driverJson(c.driver),
      Constructor: constructorJson(c.driver),
      grid: String(c.grid),
      laps: String(c.lapsCompleted),
      status: !finished ? 'Retired' : c.lapsCompleted < leaderLaps ? 'Lapped' : 'Finished',
    };
    if (finished && c.lapsCompleted === leaderLaps) {
      const total = Math.round(c.finishTime! - race.start);
      const gap = Math.round(c.finishTime! - race.winnerTime);
      row.Time = { millis: String(total), time: idx === 0 ? fmtRaceTime(total) : fmtGap(gap) };
    } else if (!finished && classified) {
      row.Time = { millis: String(Math.round(c.crossing[c.lapsCompleted]! - race.start)), time: '' };
    }
    if (flRank >= 0) {
      row.FastestLap = { rank: String(flRank + 1), lap: '30', Time: { time: fmtLap(fastest[flRank]!.best) } };
    }
    return row;
  });
}

function qualiJson(w: SimWeekend) {
  const n = w.quali.length;
  const q2Cut = n - 6;
  return w.quali.map((c: SimCar, i: number) => {
    const row: Record<string, unknown> = {
      number: String(c.driver.number),
      position: String(i + 1),
      Driver: driverJson(c.driver),
      Constructor: constructorJson(c.driver),
      Q1: fmtLap(c.qualiMs + 700),
    };
    if (i < q2Cut) row.Q2 = i === q2Cut - 1 ? '' : fmtLap(c.qualiMs + 350); // one driver sets no Q2 time
    if (i < 10) row.Q3 = fmtLap(c.qualiMs);
    return row;
  });
}

interface Row {
  race: SimWeekend;
  key: 'Results' | 'SprintResults' | 'QualifyingResults';
  row: Record<string, unknown>;
}

function paginate(rows: Row[], limit: number, offset: number, path: string, season?: number) {
  const slice = rows.slice(offset, offset + limit);
  const races = new Map<string, Record<string, unknown>>();
  for (const r of slice) {
    const k = `${r.race.season}-${r.race.entry.round}`;
    let race = races.get(k);
    if (!race) {
      race = { ...raceJson(r.race) };
      // Result endpoints do not include the practice/qualifying session blocks.
      for (const s of ['FirstPractice', 'SecondPractice', 'ThirdPractice', 'Qualifying', 'Sprint', 'SprintQualifying']) delete race[s];
      race[r.key] = [];
      races.set(k, race);
    }
    (race[r.key] as unknown[]).push(r.row);
  }
  return envelope(path, limit, offset, rows.length, { RaceTable: { season: season ? String(season) : undefined, Races: [...races.values()] } });
}

function envelope(path: string, limit: number, offset: number, total: number, body: Record<string, unknown>) {
  return { MRData: { xmlns: '', series: 'f1', url: `http://api.jolpi.ca/ergast/f1/${path}/`, limit: String(limit), offset: String(offset), total: String(total), ...body } };
}

function standings(world: World, season: number) {
  const weekends = world.seasons.get(season) ?? [];
  const pts = new Map<string, { d: WorldDriver; points: number; wins: number; teams: Set<string> }>();
  const team = new Map<string, { d: WorldDriver; points: number; wins: number }>();
  let lastRound = 0;
  const add = (c: Record<string, unknown>, d: WorldDriver, win: boolean) => {
    const p = Number(c.points);
    const e = pts.get(d.id) ?? { d, points: 0, wins: 0, teams: new Set<string>() };
    e.points += p;
    if (win) e.wins++;
    e.teams.add(d.team);
    pts.set(d.id, e);
    const t = team.get(d.team) ?? { d, points: 0, wins: 0 };
    t.points += p;
    if (win) t.wins++;
    team.set(d.team, t);
  };
  for (const w of weekends) {
    if (w.sprint && w.sprintDone) classification(w.sprint, SPRINT_POINTS).forEach((r, i) => add(r, w.sprint!.order[i]!.driver, false));
    if (w.race && w.raceDone) {
      classification(w.race, RACE_POINTS).forEach((r, i) => add(r, w.race!.order[i]!.driver, i === 0));
      lastRound = w.entry.round;
    }
  }
  return { pts, team, lastRound };
}

export function handleJolpica(world: World, url: URL): { status: number; body: unknown } {
  const path = url.pathname.replace(/^\/ergast\/f1\//, '').replace(/\.json$/, '').replace(/\/$/, '');
  const limit = Math.min(100, Number(url.searchParams.get('limit') ?? 30));
  const offset = Number(url.searchParams.get('offset') ?? 0);
  const parts = path.split('/');

  // circuits/{id}/results/1  -> winners at a circuit, every season
  if (parts[0] === 'circuits' && parts[2] === 'results') {
    const circuit = parts[1]!;
    const rows: Row[] = [];
    for (const [, weekends] of world.seasons) {
      for (const w of weekends) {
        if (w.entry.circuitId !== circuit || !w.raceDone || !w.race) continue;
        const cls = classification(w.race, RACE_POINTS);
        const wanted = parts[3] ? cls.filter((r) => r.position === parts[3]) : cls;
        for (const row of wanted) rows.push({ race: w, key: 'Results', row });
      }
    }
    return { status: 200, body: paginate(rows, limit, offset, path) };
  }

  const season = Number(parts[0]);
  const weekends = world.seasons.get(season);
  if (!weekends) return { status: 200, body: envelope(path, limit, offset, 0, { RaceTable: { season: String(season), Races: [] } }) };

  // {year}/circuits/{id}/results
  if (parts[1] === 'circuits' && parts[3] === 'results') {
    const rows: Row[] = [];
    for (const w of weekends) {
      if (w.entry.circuitId !== parts[2] || !w.raceDone || !w.race) continue;
      for (const row of classification(w.race, RACE_POINTS)) rows.push({ race: w, key: 'Results', row });
    }
    return { status: 200, body: paginate(rows, limit, offset, path, season) };
  }

  switch (parts[1]) {
    case 'races': {
      const all = weekends.map(raceJson);
      return { status: 200, body: envelope(path, limit, offset, all.length, { RaceTable: { season: String(season), Races: all.slice(offset, offset + limit) } }) };
    }
    case 'results': {
      const rows: Row[] = [];
      for (const w of weekends) if (w.raceDone && w.race) for (const row of classification(w.race, RACE_POINTS)) rows.push({ race: w, key: 'Results', row });
      return { status: 200, body: paginate(rows, limit, offset, path, season) };
    }
    case 'sprint': {
      const rows: Row[] = [];
      for (const w of weekends) if (w.sprintDone && w.sprint) for (const row of classification(w.sprint, SPRINT_POINTS)) rows.push({ race: w, key: 'SprintResults', row });
      return { status: 200, body: paginate(rows, limit, offset, path, season) };
    }
    case 'qualifying': {
      const rows: Row[] = [];
      for (const w of weekends) if (w.qualiDone) for (const row of qualiJson(w)) rows.push({ race: w, key: 'QualifyingResults', row });
      return { status: 200, body: paginate(rows, limit, offset, path, season) };
    }
    case 'driverstandings': {
      const { pts, lastRound } = standings(world, season);
      const list = [...pts.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
      const rows = list.map((e, i) => ({
        position: String(i + 1),
        positionText: String(i + 1),
        points: String(e.points),
        wins: String(e.wins),
        Driver: driverJson(e.d),
        Constructors: [...e.teams].map((t) => ({ constructorId: t, url: '', name: t, nationality: '' })),
      }));
      return {
        status: 200,
        body: envelope(path, limit, offset, rows.length, {
          StandingsTable: { season: String(season), round: String(lastRound), StandingsLists: rows.length ? [{ season: String(season), round: String(lastRound), DriverStandings: rows.slice(offset, offset + limit) }] : [] },
        }),
      };
    }
    case 'constructorstandings': {
      const { team, lastRound } = standings(world, season);
      const list = [...team.values()].sort((a, b) => b.points - a.points || b.wins - a.wins);
      const rows = list.map((e, i) => ({
        position: String(i + 1),
        positionText: String(i + 1),
        points: String(e.points),
        wins: String(e.wins),
        Constructor: constructorJson(e.d),
      }));
      return {
        status: 200,
        body: envelope(path, limit, offset, rows.length, {
          StandingsTable: { season: String(season), round: String(lastRound), StandingsLists: rows.length ? [{ season: String(season), round: String(lastRound), ConstructorStandings: rows.slice(offset, offset + limit) }] : [] },
        }),
      };
    }
    default:
      return { status: 400, body: { detail: `Unsupported fake endpoint ${path}` } };
  }
}
