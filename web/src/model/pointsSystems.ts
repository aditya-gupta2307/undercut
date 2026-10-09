/**
 * Points systems through the ages, for the "Time Machine": re-score this
 * season's actual results under the rules of another era. Rules are applied
 * as written for that era — including the fastest-lap bonus and the old
 * "best N results count" dropped-score rule where it existed.
 */

import type { Season } from '../data/types';
import { compareCountback } from './championship';

export interface PointsSystem {
  id: string;
  name: string;
  era: string;
  blurb: string;
  race: number[];
  /** Points for sprints, or null when the era had no sprints (they are ignored). */
  sprint: number[] | null;
  /** Bonus for fastest lap, with the finishing-position condition if any. */
  fastestLap: { points: number; topN: number | null } | null;
  /** Count only a driver's best N Grand Prix scores (sprints count in full). */
  bestResults: number | null;
}

export const POINTS_SYSTEMS: PointsSystem[] = [
  {
    id: 'current',
    name: 'Today',
    era: '2025 –',
    blurb: 'Ten scorers, no fastest-lap bonus, sprints pay down to eighth.',
    race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprint: [8, 7, 6, 5, 4, 3, 2, 1],
    fastestLap: null,
    bestResults: null,
  },
  {
    id: '2019',
    name: 'Fastest-lap era',
    era: '2019 – 2024',
    blurb: 'An extra point for the fastest lap, but only if you finish in the top ten.',
    race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprint: [8, 7, 6, 5, 4, 3, 2, 1],
    fastestLap: { points: 1, topN: 10 },
    bestResults: null,
  },
  {
    id: '2010',
    name: 'Modern classic',
    era: '2010 – 2018',
    blurb: 'The 25-point win arrives. No sprints existed, so they count for nothing.',
    race: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1],
    sprint: null,
    fastestLap: null,
    bestResults: null,
  },
  {
    id: '2003',
    name: 'Eight to score',
    era: '2003 – 2009',
    blurb: 'Ten for a win, eight for second: consistency pays almost as well as winning.',
    race: [10, 8, 6, 5, 4, 3, 2, 1],
    sprint: null,
    fastestLap: null,
    bestResults: null,
  },
  {
    id: '1991',
    name: 'Six to score',
    era: '1991 – 2002',
    blurb: 'Only the top six score, and a win is worth four more than second.',
    race: [10, 6, 4, 3, 2, 1],
    sprint: null,
    fastestLap: null,
    bestResults: null,
  },
  {
    id: '1981',
    name: 'Dropped scores',
    era: '1981 – 1990',
    blurb: 'Nine for a win, and only your best eleven results count.',
    race: [9, 6, 4, 3, 2, 1],
    sprint: null,
    fastestLap: null,
    bestResults: 11,
  },
  {
    id: '1950',
    name: 'Founding rules',
    era: '1950 – 1959',
    blurb: 'Top five score, plus a point for the fastest lap wherever you finish.',
    race: [8, 6, 4, 3, 2],
    sprint: null,
    fastestLap: { points: 1, topN: null },
    bestResults: null,
  },
  {
    id: 'deep',
    name: 'Everyone scores',
    era: 'IndyCar-style',
    blurb: 'Every finishing position pays, so a bad day still counts for something.',
    race: [50, 40, 35, 32, 30, 28, 26, 24, 22, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5],
    sprint: null,
    fastestLap: null,
    bestResults: null,
  },
  {
    id: 'wins',
    name: 'Wins only',
    era: 'Medal table',
    blurb: 'The champion is whoever wins most; seconds and thirds only break ties.',
    race: [1],
    sprint: null,
    fastestLap: null,
    bestResults: null,
  },
];

export interface RescoredRow {
  driverId: string;
  points: number;
  countback: number[];
  /** Grand Prix scores dropped by a best-N rule. */
  dropped: number;
}

export function rescore(season: Season, system: PointsSystem): RescoredRow[] {
  const rows = new Map<string, { gp: number[]; sprint: number; countback: number[] }>();
  const get = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      r = { gp: [], sprint: 0, countback: new Array(30).fill(0) };
      rows.set(id, r);
    }
    return r;
  };
  for (const ev of season.events) {
    const res = season.results[ev.round];
    if (res?.length) {
      for (const r of res) {
        const d = get(r.driverId);
        let p = 0;
        if (r.position !== null) p += system.race[r.position - 1] ?? 0;
        if (system.fastestLap && r.fastestLapRank === 1 && r.position !== null) {
          if (system.fastestLap.topN === null || r.position <= system.fastestLap.topN) p += system.fastestLap.points;
        }
        d.gp.push(p);
        if (r.position !== null && r.position <= 30) d.countback[r.position - 1]!++;
      }
    }
    if (system.sprint) {
      for (const r of season.sprints[ev.round] ?? []) {
        if (r.position === null) {
          get(r.driverId);
          continue;
        }
        get(r.driverId).sprint += system.sprint[r.position - 1] ?? 0;
      }
    }
  }
  const out: RescoredRow[] = [];
  for (const [driverId, r] of rows) {
    const sorted = [...r.gp].sort((a, b) => b - a);
    const kept = system.bestResults !== null ? sorted.slice(0, system.bestResults) : sorted;
    const total = kept.reduce((a, b) => a + b, 0) + r.sprint;
    const all = sorted.reduce((a, b) => a + b, 0) + r.sprint;
    out.push({ driverId, points: total, countback: r.countback, dropped: all - total });
  }
  return out.sort((a, b) => b.points - a.points || compareCountback(b.countback, a.countback));
}
