/**
 * Parsing tests against payloads copied from real 2026 API responses
 * (trimmed to the rows that exercise each quirk).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFinish, mergeRacePages, parseQualifying, parseRaceEvent, parseResult, type RawRace } from '../../src/data/jolpica';
import { normaliseClassification } from '../../src/data/season';
import { parseSessionResult, parseLap, parseRaceControl, parseMeeting, openf1Url, openf1Date, parsePit } from '../../src/data/openf1';
import { findMeeting, linkDrivers } from '../../src/data/link';
import { RequestQueue, HttpError } from '../../src/lib/http';
import { adaptForSurface, contrast } from '../../src/lib/color';
import { lineageRoot } from '../../src/data/teams';
import type { Meeting } from '../../src/data/types';

const driver = (id: string, code: string) => ({ driverId: id, code, givenName: id, familyName: id, nationality: 'X' });
const team = (id: string) => ({ constructorId: id, name: id, nationality: 'X' });

test('race result quirks from the 2026 Malaysian round', () => {
  // Classified on distance but retired: positionText "20", status "Retired", empty time.
  const russell = parseResult(
    { number: '63', position: '20', positionText: '20', points: '0', grid: '7', laps: '49', status: 'Retired', Driver: driver('russell', 'RUS'), Constructor: team('mercedes'), Time: { millis: '5738170', time: '' } },
    19,
  );
  assert.equal(russell.position, 20);
  assert.equal(russell.finish, 'dnf');
  assert.equal(russell.timeMs, null);
  assert.equal(russell.timeText, null);

  const albon = parseResult(
    { number: '23', position: '21', positionText: 'R', points: '0', grid: '18', laps: '41', status: 'Retired', Driver: driver('albon', 'ALB'), Constructor: team('williams') },
    20,
  );
  assert.equal(albon.position, null);
  assert.equal(albon.order, 21);
  assert.equal(albon.finish, 'dnf');

  const winner = parseResult(
    {
      number: '3', position: '1', positionText: '1', points: '25', grid: '1', laps: '55', status: 'Finished',
      Driver: driver('max_verstappen', 'VER'), Constructor: team('red_bull'),
      Time: { millis: '6434808', time: '1:47:14.808' }, FastestLap: { rank: '1', lap: '55', Time: { time: '1:38.220' } },
    },
    0,
  );
  assert.equal(winner.finish, 'finished');
  assert.equal(winner.timeMs, 6_434_808);
  assert.equal(winner.fastestLapMs, 98_220);
  assert.equal(winner.carNumber, 3);
});

test('sprint quirk: "Lapped" status with positionText "R" is a retirement', () => {
  assert.equal(classifyFinish('R', 'Lapped'), 'dnf');
  assert.equal(classifyFinish('19', 'Lapped'), 'finished');
  assert.equal(classifyFinish('5', '+1 Lap'), 'finished');
  assert.equal(classifyFinish('D', 'Disqualified'), 'dsq');
  assert.equal(classifyFinish('W', 'Did not start'), 'dns');
  assert.equal(classifyFinish('18', 'Did not start'), 'dns');
  assert.equal(classifyFinish('3', 'Engine'), 'dnf');
});

test('a lapped car never shows a seconds gap', () => {
  const rows = [
    parseResult({ number: '63', position: '1', positionText: '1', points: '8', grid: '1', laps: '24', status: 'Finished', Driver: driver('russell', 'RUS'), Constructor: team('mercedes'), Time: { millis: '1825318', time: '30:25.318' } }, 0),
    parseResult({ number: '77', position: '19', positionText: '19', points: '0', grid: '19', laps: '23', status: 'Lapped', Driver: driver('bottas', 'BOT'), Constructor: team('cadillac'), Time: { millis: '1829227', time: '+3.909' } }, 18),
  ];
  const fixed = normaliseClassification(rows);
  assert.equal(fixed[1]!.timeText, '+1 Lap');
  assert.equal(fixed[1]!.timeMs, null);
  assert.equal(fixed[0]!.timeText, '30:25.318');
});

test('qualifying: empty and missing Q times are both null', () => {
  const q = parseQualifying({ number: '43', position: '15', Driver: driver('colapinto', 'COL'), Constructor: team('alpine'), Q1: '1:37.179', Q2: '' }, 14);
  assert.equal(q.q1Ms, 97_179);
  assert.equal(q.q2Ms, null);
  assert.equal(q.q3Ms, null);
});

test('race calendar entries parse session times, including sprint weekends', () => {
  const ev = parseRaceEvent({
    season: '2026', round: '17', raceName: 'Singapore Grand Prix', date: '2026-10-11', time: '12:00:00Z',
    Circuit: { circuitId: 'marina_bay', circuitName: 'Marina Bay Street Circuit', Location: { lat: '1.2914', long: '103.864', locality: 'Marina Bay', country: 'Singapore' } },
    FirstPractice: { date: '2026-10-09', time: '08:30:00Z' },
    SprintQualifying: { date: '2026-10-09', time: '12:30:00Z' },
    Sprint: { date: '2026-10-10', time: '09:00:00Z' },
    Qualifying: { date: '2026-10-10', time: '13:00:00Z' },
  });
  assert.equal(ev.round, 17);
  assert.equal(ev.hasSprint, true);
  assert.equal(ev.start, Date.UTC(2026, 9, 11, 12));
  assert.equal(ev.sessions.sprintQuali, Date.UTC(2026, 9, 9, 12, 30));
  assert.equal(ev.sessions.fp2, undefined);
  assert.equal(ev.circuit.lon, 103.864);
});

test('pages that split one race are merged back together', () => {
  const page1: RawRace[] = [{ season: '2026', round: '1', Results: [{ position: '1', Driver: driver('a', 'AAA') }, { position: '2', Driver: driver('b', 'BBB') }] }];
  const page2: RawRace[] = [
    { season: '2026', round: '1', Results: [{ position: '3', Driver: driver('c', 'CCC') }] },
    { season: '2026', round: '2', Results: [{ position: '1', Driver: driver('b', 'BBB') }] },
  ];
  const merged = mergeRacePages([page2, page1]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0]!.Results!.map((r) => r.Driver.driverId), ['a', 'b', 'c']);
  // Overlapping pages do not duplicate rows.
  const dup = mergeRacePages([page1, page1]);
  assert.equal(dup[0]!.Results!.length, 2);
});

test('OpenF1 session results: lapped cars, null positions', () => {
  const lapped = parseSessionResult({ position: 8, driver_number: 14, number_of_laps: 61, dnf: false, dns: false, dsq: false, duration: null, gap_to_leader: '+1 LAP', session_key: 9606 })!;
  assert.equal(lapped.lapsDown, 1);
  assert.equal(lapped.gapMs, null);
  const out = parseSessionResult({ position: null, driver_number: 23, number_of_laps: 15, dnf: true, dns: false, dsq: false, duration: null, gap_to_leader: null, session_key: 9606 })!;
  assert.equal(out.position, null);
  assert.equal(out.dnf, true);
  const win = parseSessionResult({ position: 1, driver_number: 4, number_of_laps: 62, dnf: false, dns: false, dsq: false, duration: 6052.571, gap_to_leader: 0, session_key: 9606 })!;
  assert.equal(win.durationMs, 6_052_571);
  // Qualifying uses arrays: take the furthest session reached.
  const q = parseSessionResult({ position: 1, driver_number: 1, number_of_laps: 24, duration: [77.9, 77.1, 76.5], gap_to_leader: [0, 0, 0], session_key: 1 })!;
  assert.equal(q.durationMs, 76_500);
});

test('OpenF1 laps, pits and race control parse', () => {
  const lap = parseLap({ driver_number: 63, lap_number: 8, date_start: '2023-09-16T13:59:07.606000+00:00', lap_duration: 91.743, duration_sector_1: 26.966, is_pit_out_lap: false, st_speed: 298 })!;
  assert.equal(lap.durationMs, 91_743);
  assert.equal(lap.start, Date.UTC(2023, 8, 16, 13, 59, 7, 606));
  const firstLap = parseLap({ driver_number: 63, lap_number: 1, date_start: null, lap_duration: null })!;
  assert.equal(firstLap.durationMs, null);
  assert.equal(firstLap.start, null);
  const pit = parsePit({ date: '2025-10-26T20:46:37.358000+00:00', driver_number: 16, lane_duration: 22.215, lap_number: 31, stop_duration: 2.2, session_key: 1 })!;
  assert.equal(pit.stopMs, 2200);
  const legacy = parsePit({ date: '2024-09-22T13:00:00+00:00', driver_number: 4, pit_duration: 21.5, lap_number: 30 })!;
  assert.equal(legacy.laneMs, 21_500);
  const rc = parseRaceControl({ date: '2024-09-22T13:07:07+00:00', lap_number: 39, category: 'Flag', flag: 'BLUE', scope: 'Driver', sector: null, driver_number: 18, message: 'WAVED BLUE FLAG FOR CAR 18 (STR)' })!;
  assert.equal(rc.flag, 'BLUE');
  assert.equal(rc.driverNumber, 18);
});

test('OpenF1 URLs keep operators literal and avoid "+" in dates', () => {
  const url = openf1Url('location', [['session_key', '=', 9606], ['date', '>', openf1Date(Date.UTC(2024, 8, 22, 12, 30))]]);
  assert.equal(url, 'https://api.openf1.org/v1/location?session_key=9606&date>2024-09-22T12:30:00.000');
  assert.ok(!url.includes('+'));
});

const meeting = (key: number, name: string, start: string, end: string, cancelled = false): Meeting =>
  parseMeeting({ meeting_key: key, meeting_name: name, meeting_official_name: name, year: 2026, circuit_key: key, date_start: start, date_end: end, is_cancelled: cancelled })!;

test('events are linked by time, which survives the 2026 "Bahrain in Malaysia" naming', () => {
  const meetings = [
    meeting(1282, 'Bahrain Grand Prix', '2026-04-10T11:30:00+00:00', '2026-04-12T17:00:00+00:00', true),
    meeting(1308, 'Bahrain Grand Prix', '2026-10-02T04:30:00+00:00', '2026-10-04T09:00:00+00:00'),
    meeting(1296, 'Singapore Grand Prix', '2026-10-09T08:30:00+00:00', '2026-10-11T14:00:00+00:00'),
    meeting(1305, 'Pre-Season Testing', '2026-02-18T07:00:00+00:00', '2026-02-20T16:00:00+00:00'),
  ];
  const malaysia = parseRaceEvent({ season: '2026', round: '16', raceName: 'Bahrain Grand Prix in Malaysia', date: '2026-10-04', time: '07:00:00Z', Circuit: { circuitId: 'sepang' } });
  assert.equal(findMeeting(malaysia, meetings)?.key, 1308);
  const singapore = parseRaceEvent({ season: '2026', round: '17', raceName: 'Singapore Grand Prix', date: '2026-10-11', time: '12:00:00Z' });
  assert.equal(findMeeting(singapore, meetings)?.key, 1296);
});

test('drivers link by car number, falling back to the three-letter code', () => {
  const links = linkDrivers(
    [
      { number: 3, acronym: 'VER', fullName: 'Max VERSTAPPEN', firstName: 'Max', lastName: 'Verstappen', teamName: 'Red Bull Racing', teamColour: '#4781D7' },
      { number: 41, acronym: 'LIN', fullName: 'Arvid LINDBLAD', firstName: 'Arvid', lastName: 'Lindblad', teamName: 'Racing Bulls', teamColour: '#6C98FF' },
    ],
    [{ driverId: 'max_verstappen', teamId: 'red_bull', carNumber: 3 } as never],
    { LIN: 'arvid_lindblad' },
  );
  assert.equal(links[0]!.driverId, 'max_verstappen');
  assert.equal(links[1]!.driverId, 'arvid_lindblad');
});

test('team lineage connects renamed outfits', () => {
  assert.equal(lineageRoot('audi'), 'alfa');
  assert.equal(lineageRoot('sauber'), 'alfa');
  assert.equal(lineageRoot('rb'), 'toro_rosso');
  assert.equal(lineageRoot('ferrari'), 'ferrari');
});

test('team colours are adapted to clear 3:1 on the surface', () => {
  const mercedesOnWhite = adaptForSurface('#00D7B6', '#FFFFFF', 3);
  assert.ok(contrast(mercedesOnWhite, '#FFFFFF') >= 3, mercedesOnWhite);
  const haasOnDark = adaptForSurface('#9C9FA2', '#13171C', 3);
  assert.ok(contrast(haasOnDark, '#13171C') >= 3);
  assert.equal(adaptForSurface('#ED1131', '#FFFFFF', 3), '#ED1131', 'already fine, left alone');
});

// --- request queue ----------------------------------------------------------

function fakeFetch(responses: Record<string, Array<{ status: number; body?: unknown; headers?: Record<string, string> }>>) {
  const calls: string[] = [];
  const impl = async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const queue = responses[u];
    const next = queue?.shift() ?? { status: 404 };
    return new Response(next.body === undefined ? null : JSON.stringify(next.body), { status: next.status, headers: next.headers });
  };
  return { impl: impl as typeof fetch, calls };
}

test('request queue deduplicates concurrent identical requests', async () => {
  const { impl, calls } = fakeFetch({ 'https://x/a': [{ status: 200, body: [1] }] });
  const q = new RequestQueue({ name: 't1', concurrency: 2, minIntervalMs: 0, rules: [], persist: false, fetchImpl: impl });
  const [a, b] = await Promise.all([q.json('https://x/a'), q.json('https://x/a')]);
  assert.deepEqual(a, [1]);
  assert.deepEqual(b, [1]);
  assert.equal(calls.length, 1);
});

test('request queue retries a 429 and honours Retry-After', async () => {
  const { impl, calls } = fakeFetch({
    'https://x/b': [{ status: 429, headers: { 'Retry-After': '0' } }, { status: 200, body: { ok: true } }],
  });
  const q = new RequestQueue({ name: 't2', concurrency: 1, minIntervalMs: 0, rules: [], persist: false, fetchImpl: impl });
  const res = await q.json<{ ok: boolean }>('https://x/b');
  assert.equal(res.ok, true);
  assert.equal(calls.length, 2);
});

test('request queue surfaces non-retryable errors', async () => {
  const { impl } = fakeFetch({ 'https://x/c': [{ status: 400 }] });
  const q = new RequestQueue({ name: 't3', concurrency: 1, minIntervalMs: 0, rules: [], persist: false, fetchImpl: impl });
  await assert.rejects(q.json('https://x/c'), (e: unknown) => e instanceof HttpError && e.status === 400);
});

test('request queue enforces a sliding-window limit', async () => {
  let t = 0;
  const { impl } = fakeFetch(Object.fromEntries([1, 2, 3].map((i) => [`https://x/${i}`, [{ status: 200, body: i }]])));
  const q = new RequestQueue({ name: 't4', concurrency: 3, minIntervalMs: 0, rules: [{ max: 2, windowMs: 50 }], persist: false, fetchImpl: impl, now: () => Date.now() + t });
  const started = Date.now();
  await Promise.all([1, 2, 3].map((i) => q.json(`https://x/${i}`)));
  assert.ok(Date.now() - started >= 45, 'third request must wait for the window to slide');
  t = 0;
});
