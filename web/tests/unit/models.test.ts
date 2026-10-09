import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../src/model/config';
import { buildTrainingSet } from '../../src/model/dataset';
import { fitModels, forecastRace } from '../../src/model/forecast';
import { mathematicalStatus, remainingEvents, simulateChampionship, tallyFromResults } from '../../src/model/championship';
import { brier, calibration, winnerLogLoss } from '../../src/model/metrics';
import { runBacktest } from '../../src/model/backtest';
import { POINTS_SYSTEMS, rescore } from '../../src/model/pointsSystems';
import { fitRatings, teammateDuels } from '../../src/model/ratings';
import { currentTeams, eventStates } from '../../src/data/season';
import { makeSeason, standardGrid } from './helpers';

const drivers = standardGrid();
const season = makeSeason(2026, drivers, { rounds: 20, completed: 14, seed: 11, sprintRounds: [3, 7, 12, 17] });
const prior = makeSeason(2025, drivers, { rounds: 20, completed: 20, seed: 12 });
const entrants = drivers.map((d) => ({ driverId: d.id, teamId: d.team }));
const cutoff = season.events[14]!.start! - 1;

test('training set respects the cutoff and weights recent races more', () => {
  const ts = buildTrainingSet([prior, season], cutoff, 2026, DEFAULT_CONFIG);
  // 14 GPs this season + 20 last season + 3 sprints held before round 15.
  assert.equal(ts.race.length, 14 + 20 + 3);
  const weights = ts.race.map((e) => e.weight);
  assert.ok(Math.max(...weights) <= 1 + 1e-12);
  // Round 3 is a sprint weekend: its sprint runs the day before the Grand Prix.
  const r3 = season.events[2]!;
  const beforeSprint = buildTrainingSet([season], r3.sessions.sprint! - 1, 2026, DEFAULT_CONFIG);
  assert.equal(beforeSprint.race.length, 2, 'before the round-3 sprint only rounds 1 and 2 are known');
  const atLightsOut = buildTrainingSet([season], r3.start! - 1, 2026, DEFAULT_CONFIG);
  assert.equal(atLightsOut.race.length, 3, 'at round-3 lights out its sprint result is known, the race is not');
});

test('forecast probabilities are coherent', () => {
  const models = fitModels([prior, season], cutoff, 2026, entrants);
  const f = forecastRace(models, entrants, { sims: 6000, seed: 3 });
  const sumWin = f.reduce((s, x) => s + x.pWin, 0);
  const sumPodium = f.reduce((s, x) => s + x.pPodium, 0);
  const sumPoints = f.reduce((s, x) => s + x.pPoints, 0);
  const sumDnf = f.reduce((s, x) => s + x.pDnf, 0);
  assert.ok(Math.abs(sumWin - 1) < 0.02, `win probs sum to ${sumWin}`);
  // Podium/points places can go unfilled only if fewer than 3/10 cars finish.
  assert.ok(Math.abs(sumPodium - 3) < 0.05, `podium sums to ${sumPodium}`);
  assert.ok(Math.abs(sumPoints - 10) < 0.1, `points sums to ${sumPoints}`);
  assert.ok(sumDnf > 0.5 && sumDnf < 4, `expected DNFs ${sumDnf}`);
  for (const x of f) {
    assert.ok(x.pWin <= x.pPodium + 1e-9 && x.pPodium <= x.pPoints + 1e-9);
    assert.ok(x.pPole !== null && x.pPole >= 0);
  }
  // Strongest car should be favourite; weakest should be a long shot.
  const byWin = [...f].sort((a, b) => b.pWin - a.pWin);
  assert.ok(byWin[0]!.teamId === 'alpha' || byWin[0]!.teamId === 'bravo', `favourite was ${byWin[0]!.driverId}`);
  assert.ok(f.find((x) => x.driverId === 'juliet_b')!.pWin < 0.01);
});

test('a known grid moves the forecast: pole helps', () => {
  const models = fitModels([prior, season], cutoff, 2026, entrants);
  const front = new Map(entrants.map((e, i) => [e.driverId, i + 1]));
  const reversed = new Map(entrants.map((e, i) => [e.driverId, entrants.length - i]));
  const a = forecastRace(models, entrants, { grid: front, sims: 3000 });
  const b = forecastRace(models, entrants, { grid: reversed, sims: 3000 });
  const leader = entrants[0]!.driverId;
  assert.ok(models.race.beta > 0, `grid effect should be positive, got ${models.race.beta}`);
  assert.ok(a.find((x) => x.driverId === leader)!.pWin > b.find((x) => x.driverId === leader)!.pWin);
  assert.equal(a[0]!.pPole, null, 'no pole probability when the grid is given');
});

test('forecasts are reproducible for a fixed seed', () => {
  const models = fitModels([prior, season], cutoff, 2026, entrants);
  const a = forecastRace(models, entrants, { sims: 2000, seed: 9 });
  const b = forecastRace(models, entrants, { sims: 2000, seed: 9 });
  assert.deepEqual(a.map((x) => x.pWin), b.map((x) => x.pWin));
});

test('tally matches the sum of published points, sprints included', () => {
  const tally = tallyFromResults(season);
  let total = 0;
  for (const r of Object.values(season.results)) for (const x of r) total += x.points;
  for (const r of Object.values(season.sprints)) for (const x of r) total += x.points;
  const tallied = tally.drivers.reduce((s, d) => s + d.points, 0);
  assert.equal(tallied, total);
  const wins = tally.drivers.reduce((s, d) => s + d.countback[0]!, 0);
  assert.equal(wins, 14);
});

test('remaining events list sprints before their Grand Prix', () => {
  const rem = remainingEvents(season);
  // Rounds 15..20 remain, with a sprint at 17.
  assert.deepEqual(
    rem.map((e) => `${e.round}${e.kind[0]}`),
    ['15r', '16r', '17s', '17r', '18r', '19r', '20r'],
  );
  assert.equal(rem.reduce((s, e) => s + e.maxPoints, 0), 6 * 25 + 8);
});

test('mathematical elimination and clinch logic', () => {
  const tally = {
    drivers: [
      { driverId: 'a', points: 300, countback: [8], teamIds: ['x'] },
      { driverId: 'b', points: 260, countback: [3], teamIds: ['x'] },
      { driverId: 'c', points: 100, countback: [0], teamIds: ['y'] },
    ],
    teams: [],
  };
  const rem = [
    { round: 20, name: 'A', kind: 'race' as const, maxPoints: 25 },
    { round: 21, name: 'B', kind: 'race' as const, maxPoints: 25 },
  ];
  const st = mathematicalStatus(tally, rem);
  assert.ok(st.eliminated.has('c'));
  assert.ok(!st.eliminated.has('b'));
  assert.equal(st.clinched, null);
  // 300 + 25 = 325 > 260 + 25 = 285 -> could clinch after the first event.
  assert.equal(st.earliestClinch, 0);
  const done = mathematicalStatus(tally, rem.slice(0, 1));
  assert.equal(done.clinched, 'a', '300 > 260 + 25');
});

test('championship simulation sums to one and respects elimination', () => {
  const models = fitModels([prior, season], cutoff, 2026, entrants);
  const res = simulateChampionship(season, models, entrants, { sims: 3000 });
  const total = res.drivers.reduce((s, d) => s + d.pChampion, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `title odds sum to ${total}`);
  const teamTotal = res.teams.reduce((s, d) => s + d.pChampion, 0);
  assert.ok(Math.abs(teamTotal - 1) < 1e-9);
  const status = mathematicalStatus(tallyFromResults(season), res.remaining);
  for (const id of status.eliminated) {
    assert.equal(res.drivers.find((d) => d.driverId === id)?.pChampion ?? 0, 0, `${id} is eliminated but has title odds`);
  }
  for (const d of res.drivers) assert.ok(d.p10 <= d.p50 && d.p50 <= d.p90 && d.p10 >= d.currentPoints);
});

test('a what-if win changes the odds in the expected direction', () => {
  const models = fitModels([prior, season], cutoff, 2026, entrants);
  const base = simulateChampionship(season, models, entrants, { sims: 2000, seed: 1 });
  const challenger = base.drivers[1]!.driverId;
  const fixed = new Map([[0, [challenger]]]);
  const what = simulateChampionship(season, models, entrants, { sims: 2000, seed: 1, fixed });
  const before = base.drivers.find((d) => d.driverId === challenger)!.pChampion;
  const after = what.drivers.find((d) => d.driverId === challenger)!.pChampion;
  assert.ok(after >= before, `${challenger} winning next race should not lower their odds (${before} -> ${after})`);
});

test('metrics: Brier, log loss and calibration', () => {
  assert.equal(brier([{ p: 1, outcome: true }, { p: 0, outcome: false }]), 0);
  assert.equal(brier([{ p: 0.5, outcome: true }]), 0.25);
  assert.ok(Math.abs(winnerLogLoss([0.5]) - Math.log(2)) < 1e-12);
  assert.ok(Number.isFinite(winnerLogLoss([0])), 'floored, never infinite');
  const bins = calibration([
    { p: 0.01, outcome: false },
    { p: 0.015, outcome: false },
    { p: 0.6, outcome: true },
    { p: 0.65, outcome: false },
  ]);
  assert.equal(bins.length, 2);
  assert.equal(bins[1]!.observed, 0.5);
  assert.ok(bins[1]!.ciLow < 0.5 && bins[1]!.ciHigh > 0.5);
});

test('walk-forward backtest beats the uniform baseline on informative data', async () => {
  const res = await runBacktest([prior, season], 2026, { sims: 1500 });
  assert.ok(res);
  assert.equal(res.races.length, 14);
  const model = res.scores.find((s) => s.variant === 'raceDay')!;
  const uniform = res.scores.find((s) => s.variant === 'uniform')!;
  assert.ok(model.winLogLoss < uniform.winLogLoss, `model ${model.winLogLoss} vs uniform ${uniform.winLogLoss}`);
  assert.ok(model.winBrier < uniform.winBrier);
  for (const race of res.races) {
    const total = [...race.raceDay.values()].reduce((s, p) => s + p.pWin, 0);
    assert.ok(Math.abs(total - 1) < 0.03, `race ${race.round} win probs sum to ${total}`);
  }
});

test('points systems: today matches the published points', () => {
  const today = POINTS_SYSTEMS.find((s) => s.id === 'current')!;
  const rescored = rescore(season, today);
  const tally = tallyFromResults(season);
  for (const r of tally.drivers) {
    assert.equal(rescored.find((x) => x.driverId === r.driverId)?.points, r.points, r.driverId);
  }
  const wins = rescore(season, POINTS_SYSTEMS.find((s) => s.id === 'wins')!);
  assert.equal(wins.reduce((s, r) => s + r.points, 0), 14);
  const dropped = rescore(season, POINTS_SYSTEMS.find((s) => s.id === '1981')!);
  assert.ok(dropped.some((r) => r.dropped > 0), 'best-11 rule should drop something over 14 races');
});

test('ratings separate car from driver and teammate duels add up', () => {
  const teams = currentTeams(season);
  const race = fitRatings([prior, season], 2026, cutoff, DEFAULT_CONFIG, teams, 'race');
  const alpha = race.teams.find((t) => t.id === 'alpha')!;
  const juliet = race.teams.find((t) => t.id === 'juliet')!;
  assert.ok(alpha.mean > juliet.mean);
  const a = race.drivers.find((d) => d.id === 'alpha_a')!;
  const b = race.drivers.find((d) => d.id === 'alpha_b')!;
  assert.ok(a.mean > b.mean, 'the stronger teammate should rate higher');
  assert.ok(a.sd > 0 && Number.isFinite(a.sd));
  const duels = teammateDuels(season);
  assert.equal(duels.length, 10);
  for (const d of duels) assert.equal(d.qualiA + d.qualiB, 14);
});

test('event states: completed, next, upcoming', () => {
  const now = season.events[14]!.start! - 3 * 86_400_000;
  const st = eventStates(season, now);
  assert.equal(st.filter((s) => s.status === 'completed').length, 14);
  assert.equal(st[14]!.status, 'next');
  assert.equal(st[15]!.status, 'upcoming');
  const during = eventStates(season, season.events[14]!.start! - 3_600_000);
  assert.equal(during[14]!.status, 'live');
});
