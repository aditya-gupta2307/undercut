/**
 * Team identity: colours and lineage.
 *
 * Colours come live from OpenF1 (each team's own broadcast colour) whenever a
 * session from the season is available; the table below is only a fallback
 * for seasons or teams OpenF1 has not described yet.
 *
 * Lineage links a constructor id to the outfit it grew out of. Audi *is* the
 * Hinwil team that raced as Sauber; Racing Bulls *is* Faenza. The model uses
 * this to carry a team's form across a rename instead of treating it as a
 * brand-new entry with no history.
 */

import { adaptForSurface, hashedColour } from '../lib/color';
import type { Season, SessionDriver } from './types';

export const FALLBACK_COLOURS: Record<string, string> = {
  mercedes: '#00D7B6',
  ferrari: '#ED1131',
  red_bull: '#4781D7',
  mclaren: '#F47600',
  aston_martin: '#229971',
  alpine: '#00A1E8',
  williams: '#1868DB',
  rb: '#6C98FF',
  alphatauri: '#5E8FAA',
  haas: '#9C9FA2',
  sauber: '#01C00E',
  alfa: '#C92D4B',
  audi: '#F50537',
  cadillac: '#909090',
};

/** Successor -> predecessor. */
export const LINEAGE: Record<string, string> = {
  audi: 'sauber',
  sauber: 'alfa',
  rb: 'alphatauri',
  alphatauri: 'toro_rosso',
  alpine: 'renault',
  aston_martin: 'racing_point',
  racing_point: 'force_india',
};

/** The earliest ancestor we know of — a stable identity for modelling. */
export function lineageRoot(teamId: string): string {
  let id = teamId;
  const seen = new Set<string>();
  while (LINEAGE[id] && !seen.has(id)) {
    seen.add(id);
    id = LINEAGE[id]!;
  }
  return id;
}

export interface TeamPalette {
  /** Raw team colour (as published). */
  base: Record<string, string>;
  /** Adjusted for the current theme's surface. */
  forSurface: (teamId: string) => string;
}

/**
 * Build constructorId -> colour from an OpenF1 driver list: the driver's code
 * links them to a Jolpica driver, whose latest result links them to a team.
 */
export function teamColoursFromSession(
  sessionDrivers: SessionDriver[],
  season: Season,
  driverTeams: Record<string, string>,
): Record<string, string> {
  const codeToDriver: Record<string, string> = {};
  for (const d of Object.values(season.drivers)) codeToDriver[d.code.toUpperCase()] = d.id;
  const out: Record<string, string> = {};
  for (const sd of sessionDrivers) {
    if (!sd.teamColour) continue;
    const driverId = codeToDriver[sd.acronym.toUpperCase()];
    const teamId = driverId ? driverTeams[driverId] : undefined;
    if (teamId && !out[teamId]) out[teamId] = sd.teamColour;
  }
  return out;
}

export function makePalette(live: Record<string, string>, surface: string): TeamPalette {
  const cache = new Map<string, string>();
  const base = { ...FALLBACK_COLOURS, ...live };
  return {
    base,
    forSurface(teamId: string) {
      const hit = cache.get(teamId);
      if (hit) return hit;
      const raw = base[teamId] ?? base[lineageRoot(teamId)] ?? hashedColour(teamId);
      const adapted = adaptForSurface(raw, surface, 3);
      cache.set(teamId, adapted);
      return adapted;
    },
  };
}

/** Short display names; the API's official names can be long ("Haas F1 Team"). */
export function teamShortName(teamId: string, fullName?: string): string {
  const map: Record<string, string> = {
    red_bull: 'Red Bull',
    rb: 'Racing Bulls',
    aston_martin: 'Aston Martin',
    mclaren: 'McLaren',
    mercedes: 'Mercedes',
    ferrari: 'Ferrari',
    alpine: 'Alpine',
    williams: 'Williams',
    haas: 'Haas',
    sauber: 'Sauber',
    audi: 'Audi',
    cadillac: 'Cadillac',
    alphatauri: 'AlphaTauri',
    alfa: 'Alfa Romeo',
  };
  return map[teamId] ?? fullName ?? teamId;
}
