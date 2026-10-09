import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG } from '../../src/model/config';
import { seasonUpTo, titleOddsHistory } from '../../src/model/history';
import { tallyFromResults } from '../../src/model/championship';
import { makeSeason, standardGrid } from './helpers';

const drivers = standardGrid();
const prior = makeSeason(2025, drivers, { rounds: 12, completed: 12, seed: 3 });
const season = makeSeason(2026, drivers, { rounds: 12, completed: 6, seed: 4, sprintRounds: [2, 5, 9] });

test('seasonUpTo keeps only what was known after a round', () => {
  const s = seasonUpTo(season, 3);
  assert.deepEqual(Object.keys(s.results).map(Number).sort((a, b) => a - b), [1, 2, 3]);
  assert.ok(Object.keys(s.sprints).map(Number).every((r) => r <= 3));
  assert.equal(s.events.length, season.events.length);
  assert.equal(seasonUpTo(season, 0).standingsRound, null);
  const t = tallyFromResults(s);
  const full = tallyFromResults(season);
  assert.ok(t.drivers[0]!.points < full.drivers[0]!.points);
});

test('title odds history: one point per round, each a probability distribution', async () => {
  let progress = 0;
  const hist = await titleOddsHistory(season, prior, { ...DEFAULT_CONFIG, sims: 2000 }, { sims: 800, onProgress: (d) => (progress = d) });
  assert.ok(hist);
  assert.deepEqual(
    hist!.map((h) => h.round),
    [0, 1, 2, 3, 4, 5, 6],
  );
  assert.equal(progress, 7);
  for (const h of hist!) {
    const total = [...h.odds.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1) < 1e-9, `round ${h.round} sums to ${total}`);
    const teams = [...h.teamOdds.values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(teams - 1) < 1e-9);
  }
});

test('a finished season ends with certainty for the champion', async () => {
  const done = makeSeason(2026, drivers, { rounds: 6, completed: 6, seed: 9 });
  const hist = await titleOddsHistory(done, null, DEFAULT_CONFIG, { sims: 500 });
  const last = hist![hist!.length - 1]!;
  const champ = tallyFromResults(done).drivers[0]!.driverId;
  assert.equal(last.odds.get(champ), 1);
  assert.equal(hist![0]!.round, 1, 'no pre-season point without a previous season');
});

test('title odds history can be cancelled', async () => {
  let calls = 0;
  const res = await titleOddsHistory(season, prior, DEFAULT_CONFIG, { sims: 200, cancelled: () => ++calls > 2 });
  assert.equal(res, null);
});
