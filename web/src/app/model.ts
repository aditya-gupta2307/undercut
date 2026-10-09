/**
 * Glue between data and models: who is racing, what the model predicts, and
 * how the championship plays out — each computed off the main paint and
 * cached by a key that captures every input, so revisiting a page is instant
 * and stale results can never be shown for new data.
 */

import { createContext, useContext } from 'react';
import { currentTeams, lastCompletedRound, raceTime } from '../data/season';
import type { RaceEvent, Season } from '../data/types';
import { DEFAULT_CONFIG, type ModelConfig } from '../model/config';
import type { Entrant } from '../model/dataset';
import { fitModels, forecastRace, type DriverForecast, type FittedModels } from '../model/forecast';
import { simulateChampionship, type ChampionshipResult } from '../model/championship';
import { useComputed } from './data';

// ---------------------------------------------------------------------------
// Model configuration (tunable in the Model Lab, used everywhere)
// ---------------------------------------------------------------------------

export interface ModelConfigValue {
  config: ModelConfig;
  setConfig: (c: ModelConfig) => void;
  isDefault: boolean;
}

export const ModelConfigContext = createContext<ModelConfigValue>({ config: DEFAULT_CONFIG, setConfig: () => undefined, isDefault: true });

export function useModelConfig(): ModelConfigValue {
  return useContext(ModelConfigContext);
}

export function configKey(c: ModelConfig): string {
  return [c.halfLifeRaces, c.priorSeasonWeight, c.sprintWeight, c.sdTeam, c.sdDriver, c.betaMean, c.sdBeta, c.dnfPriorStarts, c.sims].join('|');
}

// ---------------------------------------------------------------------------
// Entrants
// ---------------------------------------------------------------------------

export interface EntryList {
  entrants: Entrant[];
  /** Known grid from qualifying (driverId -> slot), or null to simulate qualifying. */
  grid: Map<string, number> | null;
  source: 'qualifying' | 'latest-race' | 'none';
}

/** Who is racing at `round`, and whether qualifying has already set the grid. */
export function entryList(season: Season, round: number): EntryList {
  const q = season.qualifying[round];
  if (q?.length) {
    return {
      entrants: q.map((r) => ({ driverId: r.driverId, teamId: r.teamId })),
      grid: new Map(q.map((r) => [r.driverId, r.position])),
      source: 'qualifying',
    };
  }
  const teams = currentTeams(season);
  const last = lastCompletedRound(season);
  if (last !== null) {
    const rows = season.results[last]!;
    return { entrants: rows.map((r) => ({ driverId: r.driverId, teamId: teams[r.driverId] ?? r.teamId })), grid: null, source: 'latest-race' };
  }
  return { entrants: [], grid: null, source: 'none' };
}

function seasonsFor(current: Season, previous: Season | null | undefined): Season[] {
  return previous ? [previous, current] : [current];
}

function stamp(s: Season | null | undefined): string {
  return s ? `${s.year}@${s.fetchedAt}` : 'none';
}

// ---------------------------------------------------------------------------
// Race forecast
// ---------------------------------------------------------------------------

export interface RaceForecast {
  drivers: DriverForecast[];
  models: FittedModels;
  gridKnown: boolean;
  source: EntryList['source'];
  cutoff: number;
}

/**
 * Forecast for a round. For a race still to come the cutoff is "now"; for a
 * race already run it is lights-out, so the page shows what the model said
 * *before* the race — never a forecast that has seen the result.
 * `previous` is undefined while the prior season is still loading: nothing is
 * computed until it settles, so a forecast is never shown and then replaced.
 */
export function useRaceForecast(
  current: Season | null,
  previous: Season | null | undefined,
  event: RaceEvent | null,
): { value: RaceForecast | null; computing: boolean; error: unknown } {
  const { config } = useModelConfig();
  const key = current && event && previous !== undefined ? `forecast:${stamp(current)}:${stamp(previous)}:${event.round}:${configKey(config)}` : null;
  const res = useComputed<RaceForecast | null>(key, () => {
    if (!current || !event) return null;
    const done = Boolean(current.results[event.round]?.length);
    const cutoff = done ? raceTime(event) : Date.now();
    let list = entryList(current, event.round);
    if (done) {
      const rows = current.results[event.round]!;
      list = { entrants: rows.map((r) => ({ driverId: r.driverId, teamId: r.teamId })), grid: new Map(rows.map((r) => [r.driverId, r.grid ?? 0])), source: 'qualifying' };
    }
    if (list.entrants.length === 0) return null;
    const models = fitModels(seasonsFor(current, previous), cutoff, current.year, list.entrants, config);
    const drivers = forecastRace(models, list.entrants, { grid: list.grid ?? undefined, sims: config.sims, seed: event.season * 100 + event.round });
    drivers.sort((a, b) => b.pWin - a.pWin || b.pPodium - a.pPodium);
    return { drivers, models, gridKnown: list.grid !== null, source: list.source, cutoff };
  });
  // Waiting for the prior season counts as computing, so pages show progress, not "no data".
  return current && event && previous === undefined ? { ...res, computing: true } : res;
}

// ---------------------------------------------------------------------------
// Championship
// ---------------------------------------------------------------------------

export function useChampionship(
  current: Season | null,
  previous: Season | null | undefined,
  fixed?: ReadonlyMap<number, readonly string[]>,
): { value: ChampionshipResult | null; computing: boolean; error: unknown } {
  const { config } = useModelConfig();
  const fixedKey = fixed ? [...fixed.entries()].map(([k, v]) => `${k}:${v.join(',')}`).join(';') : '';
  const key = current && previous !== undefined ? `title:${stamp(current)}:${stamp(previous)}:${configKey(config)}:${fixedKey}` : null;
  const res = useComputed<ChampionshipResult | null>(key, () => {
    if (!current) return null;
    const next = current.events.find((e) => !current.results[e.round]?.length);
    const list = entryList(current, next?.round ?? current.events[current.events.length - 1]?.round ?? 1);
    if (list.entrants.length === 0) return null;
    // The entry list for the title fight is the current line-up, not a qualifying order.
    const teams = currentTeams(current);
    const entrants = list.entrants.map((e) => ({ driverId: e.driverId, teamId: teams[e.driverId] ?? e.teamId }));
    const models = fitModels(seasonsFor(current, previous), Date.now(), current.year, entrants, config);
    return simulateChampionship(current, models, entrants, { sims: Math.min(8000, config.sims), seed: current.year, fixed });
  });
  return current && previous === undefined ? { ...res, computing: true } : res;
}
