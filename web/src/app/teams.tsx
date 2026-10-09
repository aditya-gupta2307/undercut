/**
 * Team colours and names for the season being viewed, adapted to the
 * current theme so every team mark clears 3:1 contrast on its surface.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { fetchDrivers } from '../data/openf1';
import { currentTeams } from '../data/season';
import { makePalette, teamColoursFromSession, teamShortName } from '../data/teams';
import type { F1Session, Season } from '../data/types';
import { useResource } from './data';
import { SURFACE, useSettings } from './settings';

interface TeamsValue {
  colour: (teamId: string) => string;
  raw: (teamId: string) => string;
  name: (teamId: string) => string;
}

const fallback: TeamsValue = (() => {
  const p = makePalette({}, SURFACE.dark);
  return { colour: p.forSurface, raw: (t) => p.base[t] ?? p.forSurface(t), name: (t) => teamShortName(t) };
})();

const TeamsContext = createContext<TeamsValue>(fallback);

export function TeamsProvider({ season, sessions, children }: { season: Season | null; sessions: F1Session[] | null; children: ReactNode }) {
  const { resolvedTheme } = useSettings();
  // The most recent race that has finished: its driver list carries this year's colours.
  const latestRace = useMemo(() => {
    if (!sessions) return null;
    const now = Date.now();
    const races = sessions.filter((s) => s.name === 'Race' && s.end < now && !s.cancelled);
    return races[races.length - 1] ?? null;
  }, [sessions]);
  const drivers = useResource(latestRace ? `drivers:v1:${latestRace.key}` : null, () => fetchDrivers(latestRace!.key, 'low'), {
    ttlMs: Number.POSITIVE_INFINITY,
  });

  const value = useMemo<TeamsValue>(() => {
    const live = season && drivers.data ? teamColoursFromSession(drivers.data, season, currentTeams(season)) : {};
    const palette = makePalette(live, SURFACE[resolvedTheme]);
    const names = season?.teams ?? {};
    return {
      colour: palette.forSurface,
      raw: (t) => palette.base[t] ?? palette.forSurface(t),
      name: (t) => teamShortName(t, names[t]?.name),
    };
  }, [season, drivers.data, resolvedTheme]);

  return <TeamsContext.Provider value={value}>{children}</TeamsContext.Provider>;
}

export function useTeams(): TeamsValue {
  return useContext(TeamsContext);
}
