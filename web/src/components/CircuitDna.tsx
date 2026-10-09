/**
 * Circuit DNA: what history says about a track, from every race Jolpica has
 * on record there — how often pole converts, how far back winners start, and
 * who has mastered the place.
 */

import { useMemo } from 'react';
import { useResource } from '../app/data';
import { fetchCircuitWinners } from '../data/jolpica';
import { pct, plural } from '../lib/format';
import { Stat, ErrorNotice, Lights, Empty } from './ui';
import { Term } from './Term';
import { teamShortName } from '../data/teams';

export function CircuitDna({ circuitId, circuitName }: { circuitId: string; circuitName: string }) {
  const res = useResource(`circuit-winners:v1:${circuitId}`, () => fetchCircuitWinners(circuitId), { ttlMs: 3 * 86_400_000 });
  const stats = useMemo(() => {
    const rows = res.data ?? [];
    if (rows.length === 0) return null;
    const withGrid = rows.filter((r) => r.row.grid !== null && r.row.grid > 0);
    const fromPole = withGrid.filter((r) => r.row.grid === 1).length;
    const outsideTop3 = withGrid.filter((r) => (r.row.grid ?? 0) > 3).length;
    const avgGrid = withGrid.reduce((s, r) => s + (r.row.grid ?? 0), 0) / Math.max(1, withGrid.length);
    const worst = withGrid.reduce((m, r) => ((r.row.grid ?? 0) > (m?.row.grid ?? 0) ? r : m), withGrid[0]);
    const count = <K extends string>(key: (r: (typeof rows)[number]) => K) => {
      const m = new Map<K, number>();
      for (const r of rows) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
      return [...m.entries()].sort((a, b) => b[1] - a[1]);
    };
    const drivers = count((r) => `${r.driver.givenName} ${r.driver.familyName}`);
    const teams = count((r) => teamShortName(r.team.id, r.team.name));
    const recent = [...rows].sort((a, b) => b.season - a.season).slice(0, 6);
    return { n: rows.length, first: Math.min(...rows.map((r) => r.season)), fromPole, withGrid: withGrid.length, outsideTop3, avgGrid, worst, drivers, teams, recent };
  }, [res.data]);

  if (res.loading) return <Lights label="Reading the history books" />;
  if (res.error) return <ErrorNotice error={res.error} onRetry={res.reload} what="circuit history" />;
  if (!stats) return <Empty>No Grand Prix has been held at {circuitName} yet. History starts this weekend.</Empty>;

  return (
    <div className="stack">
      <div className="stats">
        <Stat label={<><Term id="pole">Pole</Term> converted</>} value={pct(stats.fromPole / Math.max(1, stats.withGrid), 0)} note={`${stats.fromPole} of ${plural(stats.withGrid, 'race')}`} />
        <Stat label="Average winning grid slot" value={stats.avgGrid.toFixed(1)} note={stats.worst ? `Furthest back: P${stats.worst.row.grid} (${stats.worst.season})` : undefined} />
        <Stat label="Won from outside the top three" value={String(stats.outsideTop3)} note={`since ${stats.first}`} />
        <Stat label="Most wins" value={stats.drivers[0]?.[0].split(' ').slice(-1)[0] ?? '–'} note={stats.drivers[0] ? `${plural(stats.drivers[0][1], 'win')} · ${stats.teams[0]?.[0]} leads teams with ${stats.teams[0]?.[1]}` : undefined} />
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Recent winners at this circuit</caption>
          <thead>
            <tr>
              <th scope="col">Year</th>
              <th scope="col">Winner</th>
              <th scope="col">Team</th>
              <th scope="col" className="r">From grid</th>
            </tr>
          </thead>
          <tbody>
            {stats.recent.map((r) => (
              <tr key={`${r.season}-${r.round}`}>
                <td className="num">{r.season}</td>
                <td>
                  {r.driver.givenName} {r.driver.familyName}
                </td>
                <td className="muted">{teamShortName(r.team.id, r.team.name)}</td>
                <td className="r num">{r.row.grid === 0 ? 'Pit lane' : `P${r.row.grid}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
        {plural(stats.n, 'Grand Prix', 'Grands Prix')} at {circuitName} since {stats.first}.
      </p>
    </div>
  );
}
