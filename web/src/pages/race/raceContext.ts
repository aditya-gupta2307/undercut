/** Shared lookups for race pages: which car is which driver, in which colours. */

import { adaptForSurface } from '../../lib/color';
import { currentTeams } from '../../data/season';
import type { ResultRow, Season, SessionDriver } from '../../data/types';

export interface CarInfo {
  number: number;
  driverId: string | null;
  code: string;
  name: string;
  teamId: string | null;
  colour: string;
}

export function carDirectory(
  drivers: SessionDriver[],
  results: ResultRow[] | undefined,
  season: Season,
  colourOf: (teamId: string) => string,
  surface: string,
): Map<number, CarInfo> {
  const byNumber = new Map<number, ResultRow>();
  for (const r of results ?? []) if (r.carNumber !== null) byNumber.set(r.carNumber, r);
  const codeToDriver = new Map(Object.values(season.drivers).map((d) => [d.code.toUpperCase(), d.id]));
  const teams = currentTeams(season);
  const out = new Map<number, CarInfo>();
  const add = (number: number, sd: SessionDriver | undefined) => {
    const res = byNumber.get(number);
    const driverId = res?.driverId ?? (sd ? codeToDriver.get(sd.acronym.toUpperCase()) ?? null : null);
    const teamId = res?.teamId ?? (driverId ? teams[driverId] ?? null : null);
    const info = driverId ? season.drivers[driverId] : undefined;
    const colour = teamId ? colourOf(teamId) : sd?.teamColour ? adaptForSurface(sd.teamColour, surface) : '#888888';
    out.set(number, {
      number,
      driverId,
      code: info?.code ?? sd?.acronym ?? String(number),
      name: info ? info.familyName : sd?.lastName || sd?.fullName || `Car ${number}`,
      teamId,
      colour,
    });
  };
  for (const sd of drivers) add(sd.number, sd);
  for (const n of byNumber.keys()) if (!out.has(n)) add(n, undefined);
  return out;
}

export function compoundColour(c: string): string {
  switch (c) {
    case 'SOFT':
      return 'var(--tyre-soft)';
    case 'MEDIUM':
      return 'var(--tyre-medium)';
    case 'HARD':
      return 'var(--tyre-hard)';
    case 'INTERMEDIATE':
      return 'var(--tyre-inter)';
    case 'WET':
      return 'var(--tyre-wet)';
    default:
      return 'var(--tyre-unknown)';
  }
}
