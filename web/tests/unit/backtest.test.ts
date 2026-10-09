import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreRaces, type BacktestRace, type Probs } from '../../src/model/backtest';

function race(round: number, winner: string, raceDay: Record<string, number>): BacktestRace {
  const ids = Object.keys(raceDay);
  const probs = (f: (id: string) => number) => new Map<string, Probs>(ids.map((id) => [id, { pWin: f(id), pPodium: Math.min(1, 3 * f(id)), pPoints: Math.min(1, 10 * f(id)) }]));
  return {
    round,
    name: `R${round}`,
    date: '2026-01-01',
    winnerId: winner,
    // Listed winner-first, as results are: a tie-breaker that leaned on order would cheat.
    entrants: [winner, ...ids.filter((x) => x !== winner)].map((driverId) => ({ driverId, teamId: 't' })),
    raceDay: probs((id) => raceDay[id]!),
    preQuali: null,
    grid: probs((id) => raceDay[id]!),
    outcome: new Map(ids.map((id) => [id, { position: id === winner ? 1 : 2, podium: id === winner, points: true }])),
  };
}

test('favourite hit rate: joint favourites share credit, so guessing scores 1/n', () => {
  const races = [race(1, 'a', { a: 0.6, b: 0.3, c: 0.1 }), race(2, 'b', { a: 0.6, b: 0.3, c: 0.1 })];
  const scores = scoreRaces(races);
  const model = scores.find((s) => s.variant === 'raceDay')!;
  assert.equal(model.favouriteHit, 0.5);
  const uniform = scores.find((s) => s.variant === 'uniform')!;
  assert.ok(Math.abs(uniform.favouriteHit - 1 / 3) < 1e-12, `uniform favourite hit ${uniform.favouriteHit}`);
  assert.equal(scores.some((s) => s.variant === 'preQuali'), false, 'no pre-qualifying forecasts, no row');
});
