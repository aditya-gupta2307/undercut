/**
 * Points Time Machine: this season's real results, re-scored under the rules
 * of other eras. Would the champion still be the champion?
 */

import { useMemo, useState } from 'react';
import { useSeasonData } from '../app/data';
import { useSettings } from '../app/settings';
import { useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import { currentTeams } from '../data/season';
import type { Season } from '../data/types';
import { plural } from '../lib/format';
import { tallyFromResults } from '../model/championship';
import { POINTS_SYSTEMS, rescore, type PointsSystem, type RescoredRow } from '../model/pointsSystems';
import { Delta, DriverTag, Empty, ErrorNotice, Lights, Panel } from '../components/ui';
import { Term, RookieNote } from '../components/Term';

export default function TimeMachine() {
  const { season: year } = useSettings();
  useTitle('Points time machine');
  const cur = useSeasonData(year);
  const [sysId, setSysId] = useState('1991');

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;
  const system = POINTS_SYSTEMS.find((s) => s.id === sysId) ?? POINTS_SYSTEMS[0]!;
  const ran = Object.keys(season.results).length;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header className="page-head">
        <div className="eyebrow">Points time machine</div>
        <h1>Same races, different rules</h1>
        <p className="muted" style={{ maxWidth: '70ch' }}>
          Every {year} result, re-scored as if it had happened in another era. Points systems shape what drivers are rewarded for — winning, or simply finishing
          — and sometimes they decide who is champion.
        </p>
      </header>
      {ran === 0 ? (
        <Empty>Nothing to re-score until the first race of {year} has been run.</Empty>
      ) : (
        <>
          <div className="systems" role="group" aria-label="Points system">
            {POINTS_SYSTEMS.map((s) => (
              <button key={s.id} type="button" className="system-card" aria-pressed={s.id === system.id} onClick={() => setSysId(s.id)}>
                <span className="sys-name">{s.name}</span>
                <span className="sys-era">{s.era}</span>
                <span className="sys-blurb">{s.blurb}</span>
              </button>
            ))}
          </div>
          <Rescored season={season} system={system} />
          <Champions season={season} onPick={setSysId} current={system.id} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Rescored({ season, system }: { season: Season; system: PointsSystem }) {
  const { colour } = useTeams();
  const teams = useMemo(() => currentTeams(season), [season]);
  const real = useMemo(() => tallyFromResults(season).drivers, [season]);
  const rows = useMemo(() => rescore(season, system), [season, system]);
  const realRank = new Map(real.map((r, i) => [r.driverId, i + 1]));
  const realPts = new Map(real.map((r) => [r.driverId, r.points]));
  const champ = rows[0];
  const realChamp = real[0];
  const done = season.events.every((e) => season.results[e.round]?.length);
  const changed = champ && realChamp && champ.driverId !== realChamp.driverId;
  const name = (id: string) => {
    const d = season.drivers[id];
    return d ? `${d.givenName} ${d.familyName}` : id;
  };
  const pts = system.race.slice(0, 6).join('-');

  return (
    <div className="grid">
      <Panel
        className="span-7"
        title={`${system.name} rules`}
        sub={`${system.race.length > 10 ? `${system.race.length} scorers` : `Points ${pts}${system.race.length > 6 ? '…' : ''}`}${system.sprint ? ', sprints count' : ', sprints ignored'}${system.fastestLap ? ', fastest-lap bonus' : ''}${system.bestResults ? `, best ${system.bestResults} results` : ''}`}
        flush
      >
        {champ ? (
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
            {changed ? (
              <>
                <span className="eyebrow" style={{ color: 'var(--accent-text)' }}>
                  A different {done ? 'champion' : 'leader'}
                </span>
                <div style={{ fontSize: 'var(--step-1)', marginTop: 4 }}>
                  Under these rules <strong>{name(champ.driverId)}</strong> would {done ? 'be champion' : 'lead the championship'}, not {name(realChamp!.driverId)}.
                </div>
              </>
            ) : (
              <>
                <span className="eyebrow">Same {done ? 'champion' : 'leader'}</span>
                <div style={{ fontSize: 'var(--step-1)', marginTop: 4 }}>
                  <strong>{name(champ.driverId)}</strong> {done ? 'is champion' : 'leads'} under these rules too
                  {rows[1] ? `, by ${plural(champ.points - rows[1].points, 'point')}` : ''}.
                </div>
              </>
            )}
          </div>
        ) : null}
        <div className="table-wrap">
          <table className="data-table">
            <caption className="sr-only">Standings re-scored under {system.name} rules</caption>
            <thead>
              <tr>
                <th scope="col">Pos</th>
                <th scope="col">Driver</th>
                <th scope="col" className="r">
                  Points
                </th>
                <th scope="col" className="r">
                  Real
                </th>
                <th scope="col" className="r">
                  Places
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const rr = realRank.get(r.driverId) ?? null;
                return (
                  <tr key={r.driverId}>
                    <td>
                      <span className="pos">{i + 1}</span>
                    </td>
                    <td>
                      <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={teams[r.driverId] ?? ''} showTeam />
                    </td>
                    <td className="r num">
                      <strong>{r.points}</strong>
                      {r.dropped ? (
                        <span className="faint" title={`${r.dropped} points dropped by the best-${system.bestResults} rule`}>
                          {' '}
                          (−{r.dropped})
                        </span>
                      ) : null}
                    </td>
                    <td className="r num faint">
                      P{rr ?? '–'} · {realPts.get(r.driverId) ?? 0}
                    </td>
                    <td className="r num">{rr !== null ? <Delta value={rr - (i + 1)} /> : '–'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel className="span-5" title="Who moves" sub="Real top ten (left) against the re-scored order (right)">
        <RookieNote>Lines that cross are drivers swapping places. Steep lines mean the rules reward a very different kind of season.</RookieNote>
        <Slope season={season} real={real.map((r) => r.driverId)} rescored={rows} teams={teams} colour={colour} />
      </Panel>
    </div>
  );
}

function Slope({ season, real, rescored, teams, colour }: { season: Season; real: string[]; rescored: RescoredRow[]; teams: Record<string, string>; colour: (t: string) => string }) {
  const n = Math.min(10, real.length);
  const ids = real.slice(0, n);
  const newRank = new Map(rescored.map((r, i) => [r.driverId, i + 1]));
  const H = 30 * n + 20;
  const y = (rank: number) => 14 + (rank - 1) * 30;
  const maxRank = Math.max(n, ...ids.map((id) => newRank.get(id) ?? n));
  const yR = (rank: number) => (rank <= n ? y(rank) : y(n) + 14);
  const code = (id: string) => season.drivers[id]?.code ?? id.slice(0, 3).toUpperCase();
  return (
    <svg viewBox={`0 0 320 ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Slope chart of real against re-scored championship positions">
      {ids.map((id, i) => {
        const r0 = i + 1;
        const r1 = newRank.get(id) ?? maxRank;
        const c = colour(teams[id] ?? '');
        const moved = r1 !== r0;
        return (
          <g key={id} opacity={moved ? 1 : 0.55}>
            <line x1={92} y1={y(r0)} x2={228} y2={yR(r1)} stroke={c} strokeWidth={moved ? 2.5 : 1.5} strokeLinecap="round" />
            <circle cx={92} cy={y(r0)} r={4} fill={c} stroke="var(--surface-1)" strokeWidth={2} />
            <circle cx={228} cy={yR(r1)} r={4} fill={c} stroke="var(--surface-1)" strokeWidth={2} />
            <text x={80} y={y(r0)} dy="0.35em" textAnchor="end" style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
              P{r0} {code(id)}
            </text>
            <text x={240} y={yR(r1)} dy="0.35em" style={{ fill: 'var(--ink)', fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600 }}>
              P{r1} {code(id)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Champions({ season, onPick, current }: { season: Season; onPick: (id: string) => void; current: string }) {
  const teams = useMemo(() => currentTeams(season), [season]);
  const leaders = useMemo(
    () =>
      POINTS_SYSTEMS.map((s) => {
        const rows = rescore(season, s);
        return { s, first: rows[0], margin: rows[0] && rows[1] ? rows[0].points - rows[1].points : null };
      }),
    [season],
  );
  const distinct = new Set(leaders.map((l) => l.first?.driverId)).size;
  return (
    <Panel
      title="Every era's champion"
      sub={`${distinct === 1 ? 'Every system agrees' : `${distinct} different ${distinct === 1 ? 'leader' : 'leaders'}`} across ${POINTS_SYSTEMS.length} points systems`}
      flush
    >
      <div className="table-wrap">
        <table className="data-table">
          <caption className="sr-only">Championship leader under each points system</caption>
          <thead>
            <tr>
              <th scope="col">System</th>
              <th scope="col">Era</th>
              <th scope="col">Leader</th>
              <th scope="col" className="r">
                Margin
              </th>
            </tr>
          </thead>
          <tbody>
            {leaders.map(({ s, first, margin }) => (
              <tr key={s.id} style={s.id === current ? { background: 'var(--accent-soft)' } : undefined}>
                <td>
                  <button className="plain-link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', color: 'inherit', font: 'inherit', fontWeight: 600 }} onClick={() => onPick(s.id)}>
                    {s.name}
                  </button>
                </td>
                <td className="faint num">{s.era}</td>
                <td>{first ? <DriverTag driver={season.drivers[first.driverId]} driverId={first.driverId} teamId={teams[first.driverId] ?? ''} /> : '–'}</td>
                <td className="r num">{margin !== null ? `+${margin}` : '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--2)', padding: '8px 18px 14px' }}>
        Ties are broken by <Term id="countback">countback</Term>. Results are the real ones — drivers would have raced differently under other rules, which no re-scoring
        can capture.
      </p>
    </Panel>
  );
}
