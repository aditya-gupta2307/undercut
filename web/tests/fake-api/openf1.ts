/**
 * Fake OpenF1 server over the synthetic world. Supports the filter syntax the
 * app uses (key=value, key>value, key<value, >=, <=), returns 404
 * {"detail": "No results found."} for empty results like the current API,
 * and reproduces the quirks the real data has: six-digit fractional seconds,
 * null lap-1 durations, "+1 LAP" gap strings, null positions for
 * unclassified retirements, and Sprint sessions typed as "Race".
 */

import { trackPoint, type SimCar, type SimRace, type SimWeekend, type World } from './world';

type Row = Record<string, unknown>;

/** ISO with six fractional digits, as OpenF1 sends it. */
const iso6 = (ms: number) => {
  const s = new Date(Math.round(ms)).toISOString(); // 2026-10-11T12:00:00.000Z
  return s.replace('Z', '000+00:00');
};

interface Filter {
  key: string;
  op: '=' | '>' | '<' | '>=' | '<=';
  value: string;
}

export function parseFilters(search: string): Filter[] {
  const out: Filter[] = [];
  for (const part of search.replace(/^\?/, '').split('&')) {
    if (!part) continue;
    const decoded = decodeURIComponent(part.replace(/\+/g, ' '));
    const m = /^([a-z_0-9]+)(>=|<=|>|<|=)(.*)$/.exec(decoded);
    if (m) out.push({ key: m[1]!, op: m[2] as Filter['op'], value: m[3]! });
  }
  return out;
}

function asTime(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/.test(v);
  const t = Date.parse(hasZone ? v : v + 'Z');
  return Number.isFinite(t) ? t : null;
}

function matches(row: Row, f: Filter): boolean {
  const raw = row[f.key];
  if (raw === undefined) return false;
  if (typeof raw === 'number') {
    const v = Number(f.value);
    switch (f.op) {
      case '=': return raw === v;
      case '>': return raw > v;
      case '<': return raw < v;
      case '>=': return raw >= v;
      case '<=': return raw <= v;
    }
  }
  if (typeof raw === 'boolean') return String(raw) === f.value.toLowerCase();
  const sv = String(raw);
  const a = asTime(sv);
  const b = asTime(f.value);
  if (a !== null && b !== null) {
    switch (f.op) {
      case '=': return a === b;
      case '>': return a > b;
      case '<': return a < b;
      case '>=': return a >= b;
      case '<=': return a <= b;
    }
  }
  return f.op === '=' && sv === f.value;
}

interface SessionInfo {
  key: number;
  name: string;
  type: string;
  start: number;
  end: number;
  weekend: SimWeekend;
  race: SimRace | null;
  done: boolean;
}

function sessionsOf(world: World): SessionInfo[] {
  const out: SessionInfo[] = [];
  for (const [, weekends] of world.seasons) {
    for (const w of weekends) {
      const s = w.sessions;
      const add = (id: string, name: string, type: string, start: number | undefined, dur: number, race: SimRace | null, done: boolean) => {
        if (start === undefined) return;
        out.push({ key: w.sessionKeys[id]!, name, type, start, end: start + dur, weekend: w, race, done });
      };
      add('fp1', 'Practice 1', 'Practice', s.fp1, 3_600_000, null, s.fp1 + 3_600_000 < world.now);
      add('fp2', 'Practice 2', 'Practice', s.fp2, 3_600_000, null, (s.fp2 ?? Infinity) + 3_600_000 < world.now);
      add('fp3', 'Practice 3', 'Practice', s.fp3, 3_600_000, null, (s.fp3 ?? Infinity) + 3_600_000 < world.now);
      add('sprintQuali', 'Sprint Qualifying', 'Qualifying', s.sprintQuali, 2_640_000, null, (s.sprintQuali ?? Infinity) + 2_640_000 < world.now);
      add('sprint', 'Sprint', 'Race', s.sprint, 3_600_000, w.sprint, w.sprintDone);
      add('quali', 'Qualifying', 'Qualifying', s.quali, 3_600_000, null, w.qualiDone);
      add('race', 'Race', 'Race', s.race, 7_200_000, w.race, w.raceDone);
    }
  }
  return out;
}

function meetingRow(w: SimWeekend): Row {
  const e = w.entry;
  const start = w.sessions.fp1;
  return {
    circuit_key: e.circuitKey,
    circuit_short_name: e.locality,
    circuit_type: 'Permanent',
    country_code: e.openf1Country.slice(0, 3).toUpperCase(),
    country_name: e.openf1Country,
    date_end: iso6(e.raceStart + 2 * 3_600_000).replace('.000000', ''),
    date_start: iso6(start).replace('.000000', ''),
    gmt_offset: '08:00:00',
    is_cancelled: false,
    location: e.locality,
    meeting_key: w.season === 2026 ? e.meetingKey : 1250 + e.round,
    meeting_name: e.meetingName,
    meeting_official_name: `FORMULA 1 ${e.meetingName.toUpperCase()} ${w.season}`,
    year: w.season,
  };
}

function sessionRow(s: SessionInfo): Row {
  const m = meetingRow(s.weekend);
  return {
    session_key: s.key,
    session_type: s.type,
    session_name: s.name,
    date_start: iso6(s.start).replace('.000000', ''),
    date_end: iso6(s.end).replace('.000000', ''),
    meeting_key: m.meeting_key,
    circuit_key: m.circuit_key,
    circuit_short_name: m.circuit_short_name,
    country_key: 1,
    country_code: m.country_code,
    country_name: m.country_name,
    location: m.location,
    gmt_offset: '08:00:00',
    year: s.weekend.season,
    is_cancelled: false,
  };
}

function base(s: SessionInfo): Row {
  return { meeting_key: sessionRow(s).meeting_key, session_key: s.key };
}

function lapsRows(s: SessionInfo): Row[] {
  const out: Row[] = [];
  for (const c of s.race!.cars) {
    for (const l of c.laps) {
      const dur = Number.isFinite(l.durationMs) ? l.durationMs / 1000 : null;
      out.push({
        ...base(s),
        driver_number: c.driver.number,
        lap_number: l.lap,
        date_start: l.lap === 1 ? null : iso6(l.start),
        duration_sector_1: dur && l.lap > 1 ? +(dur * 0.32).toFixed(3) : null,
        duration_sector_2: dur && l.lap > 1 ? +(dur * 0.41).toFixed(3) : null,
        duration_sector_3: dur && l.lap > 1 ? +(dur * 0.27).toFixed(3) : null,
        i1_speed: 290,
        i2_speed: 270,
        is_pit_out_lap: l.pitOut,
        lap_duration: l.lap === 1 ? null : dur === null ? null : +dur.toFixed(3),
        st_speed: 310 + (c.driver.number % 7),
        segments_sector_1: [2049, 2049],
        segments_sector_2: [2049],
        segments_sector_3: [2048],
      });
    }
  }
  return out;
}

function orderAt(race: SimRace, L: number): SimCar[] {
  return race.cars.filter((c) => c.crossing[L] !== undefined).sort((a, b) => a.crossing[L]! - b.crossing[L]!);
}

function raceControlRows(s: SessionInfo): Row[] {
  const r = s.race!;
  const rows: Row[] = [];
  const msg = (at: number, lap: number, category: string, message: string, extra: Row = {}) =>
    rows.push({ ...base(s), date: iso6(at).replace('.000000', ''), lap_number: lap, category, flag: null, scope: null, sector: null, driver_number: null, message, qualifying_phase: null, ...extra });
  msg(r.start - 2_400_000, 1, 'Flag', 'GREEN LIGHT - PIT EXIT OPEN', { flag: 'GREEN', scope: 'Track' });
  msg(r.start, 1, 'SessionStatus', 'SESSION STARTED');
  const leader = r.order[0]!;
  for (const p of r.sc) {
    const at = leader.crossing[p.startLap - 1] ?? r.start;
    if (p.kind === 'SC') {
      msg(at + 20_000, p.startLap, 'SafetyCar', 'SAFETY CAR DEPLOYED', { scope: 'Track' });
      msg((leader.crossing[p.endLap - 1] ?? at) + 30_000, p.endLap, 'SafetyCar', 'SAFETY CAR IN THIS LAP', { scope: 'Track' });
    } else {
      msg(at + 20_000, p.startLap, 'SafetyCar', 'VIRTUAL SAFETY CAR DEPLOYED', { scope: 'Track' });
      msg((leader.crossing[p.endLap] ?? at) - 10_000, p.endLap, 'SafetyCar', 'VIRTUAL SAFETY CAR ENDING', { scope: 'Track' });
    }
  }
  const slow = r.order[r.order.length - 3];
  if (slow) msg(r.start + 3_000_000, 30, 'Flag', `WAVED BLUE FLAG FOR CAR ${slow.driver.number} (${slow.driver.code}) TIMED AT 13:50:00`, { flag: 'BLUE', scope: 'Driver', driver_number: slow.driver.number });
  const mid = r.order[8];
  if (mid) msg(r.start + 1_800_000, 18, 'Other', `CAR ${mid.driver.number} (${mid.driver.code}) TIME 1:35.112 DELETED - TRACK LIMITS AT TURN 7 LAP 17 13:29:41`);
  for (const c of r.cars) if (c.retiredOnLap !== null) msg((c.crossing[c.lapsCompleted] ?? r.start) + 40_000, c.retiredOnLap, 'Flag', 'YELLOW IN TRACK SECTOR 9', { flag: 'YELLOW', scope: 'Sector', sector: 9 });
  msg(r.winnerTime, r.laps, 'Flag', 'CHEQUERED FLAG', { flag: 'CHEQUERED', scope: 'Track' });
  return rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function sessionResultRows(s: SessionInfo): Row[] {
  const r = s.race!;
  const leaderLaps = r.order[0]!.lapsCompleted;
  const pts = s.name === 'Sprint' ? [8, 7, 6, 5, 4, 3, 2, 1] : [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
  return r.order.map((c, i) => {
    const finished = c.retiredOnLap === null;
    const classified = finished || c.lapsCompleted >= Math.ceil(r.laps * 0.9);
    const down = leaderLaps - c.lapsCompleted;
    return {
      ...base(s),
      position: classified ? i + 1 : null,
      driver_number: c.driver.number,
      number_of_laps: c.lapsCompleted,
      points: classified ? (pts[i] ?? 0) : 0,
      dnf: !finished,
      dns: false,
      dsq: false,
      duration: finished && down === 0 ? +((c.finishTime! - r.start) / 1000).toFixed(3) : null,
      gap_to_leader: !finished ? null : down > 0 ? `+${down} LAP${down > 1 ? 'S' : ''}` : i === 0 ? 0 : +((c.finishTime! - r.winnerTime) / 1000).toFixed(3),
    };
  });
}

function locationRows(s: SessionInfo, filters: Filter[]): Row[] {
  const r = s.race!;
  const dn = filters.find((f) => f.key === 'driver_number' && f.op === '=');
  const from = filters.filter((f) => f.key === 'date' && (f.op === '>' || f.op === '>=')).map((f) => asTime(f.value)!).filter(Number.isFinite);
  const to = filters.filter((f) => f.key === 'date' && (f.op === '<' || f.op === '<=')).map((f) => asTime(f.value)!).filter(Number.isFinite);
  const A = from.length ? Math.max(...from) : r.start;
  const B = to.length ? Math.min(...to) : r.start + 600_000;
  if (B - A > 30 * 60_000) return []; // the real API caps huge responses; force windows
  const key = s.weekend.entry.circuitKey;
  const out: Row[] = [];
  for (const c of r.cars) {
    if (dn && Number(dn.value) !== c.driver.number) continue;
    const offset = (c.driver.number % 11) * 23;
    for (let t = Math.ceil(A / 270) * 270 + offset; t < B; t += 270) {
      let frac: number;
      if (t < r.start) frac = -0.004 * c.grid;
      else {
        let L = 1;
        while (c.crossing[L] !== undefined && c.crossing[L]! <= t) L++;
        const lapStart = c.crossing[L - 1];
        const lapEnd = c.crossing[L];
        if (lapStart === undefined) continue;
        if (lapEnd === undefined) {
          if (c.retiredOnLap !== null) frac = L - 1 + 0.35; // parked out on track
          else continue; // finished: off the track
        } else frac = L - 1 + (t - lapStart) / (lapEnd - lapStart);
      }
      const p = trackPoint(key, ((frac % 1) + 1) % 1);
      out.push({ ...base(s), date: iso6(t), driver_number: c.driver.number, x: Math.round(p.x), y: Math.round(p.y), z: 120 });
    }
  }
  return out;
}

function radioRows(s: SessionInfo): Row[] {
  const r = s.race!;
  return r.order.slice(0, 4).map((c, i) => ({
    ...base(s),
    date: iso6(r.start + (i + 1) * 900_000),
    driver_number: c.driver.number,
    recording_url: `https://livetiming.formula1.com/static/${s.weekend.season}/TeamRadio/${c.driver.code}_${i}.mp3`,
  }));
}

function positionRows(s: SessionInfo): Row[] {
  const r = s.race!;
  const out: Row[] = [];
  const last = new Map<number, number>();
  const grid = [...r.cars].sort((a, b) => a.grid - b.grid);
  grid.forEach((c) => {
    out.push({ ...base(s), date: iso6(r.start - 300_000), driver_number: c.driver.number, position: c.grid });
    last.set(c.driver.number, c.grid);
  });
  for (let L = 1; L <= r.laps; L++) {
    const order = orderAt(r, L);
    order.forEach((c, i) => {
      if (last.get(c.driver.number) !== i + 1) {
        out.push({ ...base(s), date: iso6(c.crossing[L]!), driver_number: c.driver.number, position: i + 1 });
        last.set(c.driver.number, i + 1);
      }
    });
  }
  return out;
}

function overtakeRows(s: SessionInfo): Row[] {
  const r = s.race!;
  const out: Row[] = [];
  let prev = orderAt(r, 1).map((c) => c.driver.number);
  for (let L = 2; L <= r.laps; L++) {
    const cur = orderAt(r, L).map((c) => c.driver.number);
    cur.forEach((d, i) => {
      const before = prev.indexOf(d);
      if (before > i) {
        const passed = prev[i];
        if (passed !== undefined && cur.indexOf(passed) > i) {
          const car = r.cars.find((c) => c.driver.number === d)!;
          out.push({ ...base(s), date: iso6(car.crossing[L]! - 20_000), overtaking_driver_number: d, overtaken_driver_number: passed, position: i + 1 });
        }
      }
    });
    prev = cur;
  }
  return out;
}

function intervalRows(s: SessionInfo): Row[] {
  const r = s.race!;
  const out: Row[] = [];
  for (let L = 1; L <= r.laps; L++) {
    const order = orderAt(r, L);
    const lead = order[0];
    if (!lead) continue;
    const leadLap = lead.crossing[L]! - (lead.crossing[L - 1] ?? r.start);
    order.forEach((c, i) => {
      const down = c.crossing[L]! - lead.crossing[L]! > leadLap ? 1 : 0;
      out.push({
        ...base(s),
        date: iso6(c.crossing[L]!),
        driver_number: c.driver.number,
        gap_to_leader: down ? `+${down} LAP` : i === 0 ? 0 : +((c.crossing[L]! - lead.crossing[L]!) / 1000).toFixed(3),
        interval: i === 0 ? 0 : +((c.crossing[L]! - order[i - 1]!.crossing[L]!) / 1000).toFixed(3),
      });
    });
  }
  return out;
}

function weatherRows(s: SessionInfo): Row[] {
  const out: Row[] = [];
  for (let t = s.start - 1_800_000, i = 0; t < s.end; t += 60_000, i++) {
    out.push({ ...base(s), date: iso6(t), air_temperature: +(29 + Math.sin(i / 20)).toFixed(1), track_temperature: +(36 + 3 * Math.sin(i / 30)).toFixed(1), humidity: 70, pressure: 1008.4, rainfall: 0, wind_direction: 120 + (i % 40), wind_speed: 1.2 });
  }
  return out;
}

export function handleOpenF1(world: World, url: URL): { status: number; body: unknown } {
  const endpoint = url.pathname.replace(/^\/v1\//, '');
  const filters = parseFilters(url.search);
  const sessions = sessionsOf(world);
  const sk = filters.find((f) => f.key === 'session_key' && f.op === '=');
  const session = sk ? sessions.find((s) => s.key === Number(sk.value)) : undefined;

  let rows: Row[] = [];
  switch (endpoint) {
    case 'meetings': {
      const list: Row[] = [];
      for (const [, weekends] of world.seasons) for (const w of weekends) list.push(meetingRow(w));
      // Real-world extras the app must ignore: cancelled rounds and testing.
      list.push({ ...meetingRow(world.seasons.get(2026)![0]!), meeting_key: 1282, meeting_name: 'Bahrain Grand Prix', is_cancelled: true, date_start: '2026-04-10T11:30:00+00:00', date_end: '2026-04-12T17:00:00+00:00', circuit_key: 63 });
      list.push({ ...meetingRow(world.seasons.get(2026)![0]!), meeting_key: 1305, meeting_name: 'Pre-Season Testing', date_start: '2026-02-18T07:00:00+00:00', date_end: '2026-02-20T16:00:00+00:00', circuit_key: 63 });
      rows = list;
      break;
    }
    case 'sessions':
      rows = sessions.map(sessionRow);
      break;
    case 'drivers':
      if (session && session.start < world.now) {
        rows = session.weekend.roster.map((d) => ({
          ...base(session),
          driver_number: d.number,
          broadcast_name: `${d.given[0]} ${d.family.toUpperCase()}`,
          full_name: `${d.given} ${d.family.toUpperCase()}`,
          name_acronym: d.code,
          team_name: d.teamName,
          team_colour: d.colour,
          first_name: d.given,
          last_name: d.family,
          headshot_url: null,
          country_code: null,
        }));
      }
      break;
    default: {
      if (!session || !session.done || !session.race) {
        if (endpoint === 'weather' && session && session.done) rows = weatherRows(session);
        break;
      }
      switch (endpoint) {
        case 'laps': rows = lapsRows(session); break;
        case 'stints': rows = session.race.cars.flatMap((c) => c.stints.map((st, i) => ({ ...base(session), driver_number: c.driver.number, stint_number: i + 1, compound: st.compound, lap_start: st.lapStart, lap_end: st.lapEnd, tyre_age_at_start: st.tyreAgeAtStart }))); break;
        case 'pit': rows = session.race.cars.flatMap((c) => c.pits.map((p) => ({ ...base(session), date: iso6(p.at), driver_number: c.driver.number, lap_number: p.lap, lane_duration: +(p.laneMs / 1000).toFixed(3), pit_duration: +(p.laneMs / 1000).toFixed(3), stop_duration: +(p.stopMs / 1000).toFixed(1) }))); break;
        case 'race_control': rows = raceControlRows(session); break;
        case 'session_result': rows = sessionResultRows(session); break;
        case 'starting_grid': rows = [...session.race.cars].sort((a, b) => a.grid - b.grid).map((c) => ({ ...base(session), position: c.grid, driver_number: c.driver.number, lap_duration: +(c.qualiMs / 1000).toFixed(3) })); break;
        case 'position': rows = positionRows(session); break;
        case 'intervals': rows = intervalRows(session); break;
        case 'team_radio': rows = radioRows(session); break;
        case 'overtakes': rows = overtakeRows(session); break;
        case 'weather': rows = weatherRows(session); break;
        case 'location': rows = locationRows(session, filters); break;
        default: return { status: 404, body: { detail: 'Not Found' } };
      }
    }
  }
  // Location already applied its own filters; everything else is filtered generically.
  const generic = endpoint === 'location' ? filters.filter((f) => f.key !== 'date') : filters;
  const out = rows.filter((r) => generic.every((f) => matches(r, f)));
  if (out.length === 0) return { status: 404, body: { detail: 'No results found.' } };
  return { status: 200, body: out };
}
