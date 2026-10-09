/**
 * Integration: the real data layer and models, end to end, against the fake
 * APIs. Checks that the two sources agree after parsing and linking, and that
 * every model runs on realistic, quirk-laden payloads.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld, fakeFetch } from '../fake-api/index';
import { jolpicaQueue, openf1Queue } from '../../src/lib/http';
import { loadSeason, eventStates, currentTeams } from '../../src/data/season';
import { fetchDrivers, fetchLaps, fetchLocations, fetchMeetings, fetchPits, fetchRaceControl, fetchSessionResult, fetchSessions, fetchStints, fetchRaceSessionsAtCircuit } from '../../src/data/openf1';
import { linkSessions } from '../../src/data/link';
import { buildRaceTiming, orderAtLap } from '../../src/model/raceTiming';
import { inRaceWinProbability } from '../../src/model/inrace';
import { fitTyreModel, planFromStints, searchStrategies } from '../../src/model/strategy';
import { estimatePitLoss } from '../../src/model/raceTiming';
import { fitModels, forecastRace } from '../../src/model/forecast';
import { simulateChampionship, tallyFromResults } from '../../src/model/championship';

const NOW = Date.UTC(2026, 9, 9, 8, 0);
const world = buildWorld(NOW);
const calls = new Map<string, number>();
globalThis.fetch = fakeFetch(world, calls);
for (const q of [jolpicaQueue, openf1Queue]) q.tune({ minIntervalMs: 0, rules: [], concurrency: 4, persist: false });

test('season loads through pagination and matches the calendar', async () => {
  const s = await loadSeason(2026);
  assert.equal(s.events.length, 23);
  assert.equal(Object.keys(s.results).length, 16, 'rounds 1–16 are complete on 9 Oct 2026');
  assert.equal(s.events[15]!.name, 'Bahrain Grand Prix in Malaysia');
  for (const rows of Object.values(s.results)) {
    assert.equal(rows.length, 22, 'every race has the full field after merging pages');
    assert.equal(rows.filter((r) => r.position === 1).length, 1);
  }
  assert.ok(Object.keys(s.sprints).length >= 5);
  assert.ok(s.driverStandings.length > 20);
  // Standings from the API equal the tally from results.
  const tally = tallyFromResults(s);
  for (const st of s.driverStandings) {
    assert.equal(tally.drivers.find((d) => d.driverId === st.driverId)?.points, st.points, st.driverId);
  }
  const states = eventStates(s, NOW);
  assert.equal(states.find((x) => x.status === 'next')?.event.round, 17);
});

test('every completed 2026 race links to an OpenF1 meeting and race session', async () => {
  const [s, meetings, sessions] = await Promise.all([loadSeason(2026), fetchMeetings(2026), fetchSessions(2026)]);
  for (const ev of s.events) {
    const linked = linkSessions(ev, meetings, sessions);
    assert.ok(linked, `round ${ev.round} (${ev.name}) did not link`);
    assert.ok(linked.race, `round ${ev.round} has no race session`);
    if (ev.hasSprint) assert.ok(linked.sprint && linked.sprintQuali, `round ${ev.round} sprint sessions`);
  }
  const malaysia = linkSessions(s.events[15]!, meetings, sessions)!;
  assert.equal(malaysia.meeting.key, 1308);
});

test('Jolpica classification and OpenF1 timing agree on the finishing order', async () => {
  const [s, meetings, sessions] = await Promise.all([loadSeason(2026), fetchMeetings(2026), fetchSessions(2026)]);
  for (const round of [1, 6, 16]) {
    const ev = s.events[round - 1]!;
    const link = linkSessions(ev, meetings, sessions)!;
    const key = link.race!.key;
    const [laps, pits, rc, result, stints, drivers] = await Promise.all([
      fetchLaps(key), fetchPits(key), fetchRaceControl(key), fetchSessionResult(key), fetchStints(key), fetchDrivers(key),
    ]);
    assert.equal(drivers.length, 22);
    const timing = buildRaceTiming(laps, pits, rc, result);
    const jolpica = s.results[round]!;
    const winnerCar = jolpica.find((r) => r.position === 1)!.carNumber;
    assert.equal(orderAtLap(timing, timing.totalLaps)[0], winnerCar, `round ${round} winner`);
    assert.equal(result[0]!.driverNumber, winnerCar);
    // Lapped cars: OpenF1 "+N LAP" agrees with Jolpica's lap counts.
    for (const r of result) {
      const j = jolpica.find((x) => x.carNumber === r.driverNumber)!;
      assert.equal(j.laps, r.laps, `laps for car ${r.driverNumber}`);
    }
    assert.ok(stints.length >= 22);
  }
});

test('race models run on fake-API data: swing chart, tyre model, strategy search', async () => {
  const [s, meetings, sessions] = await Promise.all([loadSeason(2026), fetchMeetings(2026), fetchSessions(2026)]);
  const ev = s.events[2]!;
  const key = linkSessions(ev, meetings, sessions)!.race!.key;
  const [laps, pits, rc, result, stints] = await Promise.all([fetchLaps(key), fetchPits(key), fetchRaceControl(key), fetchSessionResult(key), fetchStints(key)]);
  const timing = buildRaceTiming(laps, pits, rc, result);
  const grid = [...s.results[3]!].sort((a, b) => (a.grid ?? 99) - (b.grid ?? 99)).map((r) => r.carNumber!);
  const swing = inRaceWinProbability({ timing, stints, pits, gridOrder: grid, sims: 400 });
  assert.equal(swing.winner, s.results[3]!.find((r) => r.position === 1)!.carNumber);
  const model = fitTyreModel(timing, stints);
  assert.ok(model, 'tyre model fits on a dry synthetic race');
  assert.ok(model.deg.SOFT! > model.deg.HARD!, `soft deg ${model.deg.SOFT} should exceed hard ${model.deg.HARD}`);
  const winner = swing.winner!;
  const ctx = { model, timing, driver: winner, totalLaps: timing.totalLaps, pitLossMs: estimatePitLoss(timing, pits) };
  const search = searchStrategies(ctx, planFromStints(stints, winner, timing.totalLaps));
  assert.ok(search.best.length > 0);
});

test('track outlines come from location windows at a circuit', async () => {
  const races = await fetchRaceSessionsAtCircuit(61);
  assert.ok(races.length >= 1, 'Singapore has a past race to draw from');
  const done = races.filter((r) => r.end < NOW);
  const r = done[done.length - 1]!;
  const results = await fetchSessionResult(r.key);
  const pts = await fetchLocations(r.key, r.start + 15 * 60_000, r.start + 17 * 60_000, results[0]!.driverNumber);
  assert.ok(pts.length > 300, `got ${pts.length} location samples`);
  assert.ok(pts.every((p) => p.driverNumber === results[0]!.driverNumber));
});

test('forecast and title odds run on the loaded seasons', async () => {
  const [s25, s26] = await Promise.all([loadSeason(2025), loadSeason(2026)]);
  const teams = currentTeams(s26);
  const entrants = Object.entries(teams).filter(([id]) => s26.results[16]!.some((r) => r.driverId === id)).map(([driverId, teamId]) => ({ driverId, teamId }));
  assert.equal(entrants.length, 22);
  const models = fitModels([s25, s26], NOW, 2026, entrants);
  const f = forecastRace(models, entrants, { sims: 4000 });
  assert.ok(Math.abs(f.reduce((a, x) => a + x.pWin, 0) - 1) < 0.02);
  const title = simulateChampionship(s26, models, entrants, { sims: 1500 });
  assert.ok(Math.abs(title.drivers.reduce((a, d) => a + d.pChampion, 0) - 1) < 1e-9);
  assert.equal(title.remaining.length, 8, 'Singapore sprint + 7 Grands Prix remain');
});

test('request budget: two seasons cost about thirty Jolpica calls, and reloading is free', async () => {
  const before = calls.get('api.jolpi.ca') ?? 0;
  assert.ok(before > 0 && before <= 35, `Jolpica requests for two seasons: ${before}`);
  await loadSeason(2026);
  await loadSeason(2025);
  assert.equal(calls.get('api.jolpi.ca'), before, 'cached seasons must not refetch');
});
