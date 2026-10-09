/**
 * The season: every round on a calendar of real track outlines, the
 * championship tables, and the points race as it unfolded.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useF1Index, useNow, useSeasonData } from '../app/data';
import { useSettings } from '../app/settings';
import { Link, useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import { eventStates, type EventState } from '../data/season';
import { linkSessions } from '../data/link';
import type { RaceEvent, Season } from '../data/types';
import { countdown, longDate, plural, shortDate } from '../lib/format';
import { DriverTag, ErrorNotice, Lights, Panel, Segmented, Stat } from '../components/ui';
import { TrackMap } from '../components/TrackMap';
import { LineChart, type LineSeries } from '../components/charts/LineChart';
import { Term, RookieNote } from '../components/Term';

export default function SeasonPage() {
  const { season: year } = useSettings();
  useTitle(`${year} season`);
  const cur = useSeasonData(year);
  const idx = useF1Index(year);
  const now = useNow(60_000);
  const states = useMemo(() => (cur.season ? eventStates(cur.season, now) : []), [cur.season, now]);

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;
  const done = states.filter((s) => s.status === 'completed').length;
  const sprints = season.events.filter((e) => e.hasSprint).length;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <header className="page-head">
        <div className="eyebrow">Formula 1 World Championship</div>
        <h1>The {year} season</h1>
        <p className="muted">
          {plural(season.events.length, 'round')} · {done} complete · {plural(sprints, 'sprint weekend')}. Click any round for its forecast, report, replay and
          Strategy Lab.
        </p>
      </header>
      {cur.error ? <ErrorNotice error={cur.error} onRetry={cur.reload} what="the latest results" /> : null}

      <SeasonGlance season={season} />

      <Calendar season={season} states={states} index={idx.data} now={now} />

      <div className="grid">
        <Panel className="span-7" title="Drivers' championship" sub={season.standingsRound ? `After round ${season.standingsRound}` : 'No races yet'} flush>
          <DriverTable season={season} />
        </Panel>
        <Panel className="span-5" title={<><Term id="constructor">Constructors'</Term> championship</>} sub="Both drivers' points count" flush>
          <TeamTable season={season} />
        </Panel>
      </div>

      <PointsRace season={season} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function parseGapSeconds(text: string | null): number | null {
  if (!text) return null;
  const m = /^\+(\d+(?:\.\d+)?)s?$/.exec(text.trim());
  return m ? Number(m[1]) : null;
}

function SeasonGlance({ season }: { season: Season }) {
  const stats = useMemo(() => {
    const rounds = Object.keys(season.results).map(Number).filter((r) => season.results[r]!.length);
    const winners = new Map<string, number>();
    let poleWins = 0;
    let closest: { round: number; gap: number } | null = null;
    let biggest: { round: number; gap: number } | null = null;
    let fromBack: { round: number; grid: number; driverId: string } | null = null;
    for (const r of rounds) {
      const rows = season.results[r]!;
      const w = rows.find((x) => x.position === 1);
      if (w) {
        winners.set(w.driverId, (winners.get(w.driverId) ?? 0) + 1);
        if (w.grid === 1) poleWins++;
        // A pit-lane start (grid 0) is the furthest back of all.
        const depth = (g: number) => (g === 0 ? 99 : g);
        if (w.grid !== null && (fromBack === null || depth(w.grid) > depth(fromBack.grid))) fromBack = { round: r, grid: w.grid, driverId: w.driverId };
      }
      const second = rows.find((x) => x.position === 2);
      const gap = parseGapSeconds(second?.timeText ?? null);
      if (gap !== null) {
        if (!closest || gap < closest.gap) closest = { round: r, gap };
        if (!biggest || gap > biggest.gap) biggest = { round: r, gap };
      }
    }
    const most = [...winners.entries()].sort((a, b) => b[1] - a[1])[0];
    return { rounds: rounds.length, winners: winners.size, most, poleWins, closest, biggest, fromBack };
  }, [season]);
  if (stats.rounds === 0) return null;
  const name = (id: string) => season.drivers[id]?.familyName ?? id;
  const ev = (round: number) => season.events.find((e) => e.round === round)?.name.replace(/ Grand Prix.*/, '') ?? `R${round}`;
  return (
    <div className="stats">
      <Stat label="Different winners" value={String(stats.winners)} note={`in ${plural(stats.rounds, 'race')}`} />
      <Stat label="Most wins" value={stats.most ? name(stats.most[0]) : '–'} note={stats.most ? plural(stats.most[1], 'win') : undefined} />
      <Stat label={<>Won from <Term id="pole">pole</Term></>} value={`${stats.poleWins} of ${stats.rounds}`} />
      <Stat label="Closest finish" value={stats.closest ? `${stats.closest.gap.toFixed(3)}s` : '–'} note={stats.closest ? ev(stats.closest.round) : undefined} />
      <Stat label="Biggest win" value={stats.biggest ? `${stats.biggest.gap.toFixed(1)}s` : '–'} note={stats.biggest ? ev(stats.biggest.round) : undefined} />
      <Stat
        label="Win from furthest back"
        value={stats.fromBack ? (stats.fromBack.grid === 0 ? 'Pit lane' : `P${stats.fromBack.grid}`) : '–'}
        note={stats.fromBack ? `${name(stats.fromBack.driverId)}, ${ev(stats.fromBack.round)}` : undefined}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Mounts its children only once scrolled near the viewport, so off-screen maps cost nothing. */
function WhenVisible({ children, height }: { children: ReactNode; height: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      setSeen(true);
      return undefined;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return (
    <div ref={ref} style={{ height }}>
      {seen ? children : null}
    </div>
  );
}

function statusChip(s: EventState['status']) {
  switch (s) {
    case 'completed':
      return <span className="chip chip-done">Done</span>;
    case 'live':
      return <span className="chip chip-live">Race weekend</span>;
    case 'next':
      return <span className="chip chip-accent">Next</span>;
    case 'awaiting-results':
      return <span className="chip">Results soon</span>;
    default:
      return null;
  }
}

function Calendar({ season, states, index, now }: { season: Season; states: EventState[]; index: ReturnType<typeof useF1Index>['data']; now: number }) {
  return (
    <section aria-label="Calendar">
      <ol className="rounds" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {states.map((st) => (
          <li key={st.event.round} style={{ minWidth: 0 }}>
            <RoundCard season={season} state={st} circuitKey={index ? linkSessions(st.event, index.meetings, index.sessions)?.meeting.circuitKey ?? null : null} now={now} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function RoundCard({ season, state, circuitKey, now }: { season: Season; state: EventState; circuitKey: number | null; now: number }) {
  const e: RaceEvent = state.event;
  const winner = season.results[e.round]?.find((r) => r.position === 1);
  const isNext = state.status === 'next' || state.status === 'live';
  return (
    <Link to={`/race/${e.season}/${e.round}`} className={`round-card ${isNext ? 'is-next' : ''}`} aria-label={`Round ${e.round}: ${e.name}`}>
      <div className="rc-head">
        <span className="rc-round">R{e.round}</span>
        <span className="row" style={{ gap: 4 }}>
          {e.hasSprint ? <span className="chip">Sprint</span> : null}
          {statusChip(state.status)}
        </span>
      </div>
      <div className="rc-name">{e.name.replace(/ Grand Prix$/, '').replace(/ Grand Prix in /, ' GP in ')}</div>
      <div className="rc-meta">
        {e.circuit.locality}, {e.circuit.country} · {e.start ? shortDate(e.start) : e.date}
      </div>
      <div className="rc-track">
        {circuitKey !== null ? (
          <WhenVisible height={104}>
            <TrackMap circuitKey={circuitKey} height={104} compact strokeWidth={22} label={`${e.circuit.name} layout`} />
          </WhenVisible>
        ) : (
          <div className="track-empty" style={{ height: 104 }} />
        )}
      </div>
      <div className="rc-foot">
        {winner ? (
          <span className="row" style={{ gap: 6 }}>
            <span className="faint">Winner</span>
            <DriverTag driver={season.drivers[winner.driverId]} driverId={winner.driverId} teamId={winner.teamId} />
          </span>
        ) : isNext && e.start ? (
          <span>
            <span className="faint">Lights out in</span> <strong className="num">{countdown(e.start - now)}</strong>
          </span>
        ) : state.status === 'awaiting-results' ? (
          <span className="faint">Race run — waiting for results</span>
        ) : (
          <span className="faint">{e.start ? longDate(e.start) : e.date}</span>
        )}
      </div>
    </Link>
  );
}

// ---------------------------------------------------------------------------

function DriverTable({ season }: { season: Season }) {
  const rows = season.driverStandings;
  if (!rows.length) return <div className="empty">The standings appear after the first race.</div>;
  const leader = rows[0]!.points;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Drivers' championship standings</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Driver</th>
            <th scope="col" className="r">
              Wins
            </th>
            <th scope="col" className="r">
              <Term id="points">Points</Term>
            </th>
            <th scope="col" className="r">
              Behind
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.driverId}>
              <td>
                <span className="pos">{r.position ?? r.positionText}</span>
              </td>
              <td>
                <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamIds[r.teamIds.length - 1] ?? ''} showTeam link />
              </td>
              <td className="r num">{r.wins || ''}</td>
              <td className="r num">
                <strong>{r.points}</strong>
              </td>
              <td className="r num faint">{r.points === leader ? '–' : `−${leader - r.points}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TeamTable({ season }: { season: Season }) {
  const { colour, name } = useTeams();
  const rows = season.teamStandings;
  if (!rows.length) return <div className="empty">The standings appear after the first race.</div>;
  const leader = rows[0]!.points;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Constructors' championship standings</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Team</th>
            <th scope="col" className="r">
              Wins
            </th>
            <th scope="col" className="r">
              Points
            </th>
            <th scope="col" className="r">
              Behind
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.teamId}>
              <td>
                <span className="pos">{r.position ?? r.positionText}</span>
              </td>
              <td>
                <span className="driver-tag">
                  <span className="bar" style={{ background: colour(r.teamId) }} aria-hidden="true" />
                  <span className="name" style={{ fontWeight: 500 }}>
                    {name(r.teamId)}
                  </span>
                </span>
              </td>
              <td className="r num">{r.wins || ''}</td>
              <td className="r num">
                <strong>{r.points}</strong>
              </td>
              <td className="r num faint">{r.points === leader ? '–' : `−${leader - r.points}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PointsRace({ season }: { season: Season }) {
  const { colour, name } = useTeams();
  const [view, setView] = useState<'drivers' | 'teams'>('drivers');
  const data = useMemo(() => {
    const rounds = season.events.filter((e) => season.results[e.round]?.length).map((e) => e.round);
    const drivers = new Map<string, { team: string; cum: number[] }>();
    const teams = new Map<string, number[]>();
    rounds.forEach((round, i) => {
      const rows = [...(season.sprints[round] ?? []), ...(season.results[round] ?? [])];
      for (const r of rows) {
        let d = drivers.get(r.driverId);
        if (!d) {
          d = { team: r.teamId, cum: new Array(rounds.length).fill(0) };
          drivers.set(r.driverId, d);
        }
        d.team = r.teamId;
        let t = teams.get(r.teamId);
        if (!t) {
          t = new Array(rounds.length).fill(0);
          teams.set(r.teamId, t);
        }
        d.cum[i]! += r.points;
        t[i]! += r.points;
      }
    });
    const accumulate = (xs: number[]) => {
      let sum = 0;
      return xs.map((v) => (sum += v));
    };
    return {
      rounds,
      drivers: [...drivers.entries()].map(([id, d]) => ({ id, team: d.team, values: accumulate(d.cum) })),
      teams: [...teams.entries()].map(([id, t]) => ({ id, values: accumulate(t) })),
    };
  }, [season]);

  if (data.rounds.length < 2) return null;
  const last = (v: number[]) => v[v.length - 1] ?? 0;
  let series: LineSeries[];
  if (view === 'drivers') {
    const sorted = [...data.drivers].sort((a, b) => last(b.values) - last(a.values));
    const top = new Set(sorted.slice(0, 6).map((d) => d.id));
    const seen = new Set<string>();
    series = sorted.map((d) => {
      const emphasis = top.has(d.id);
      const c = colour(d.team);
      const dashed = emphasis && seen.has(c);
      if (emphasis) seen.add(c);
      return { id: d.id, label: season.drivers[d.id]?.code ?? d.id, colour: c, emphasis, dashed, values: d.values };
    });
  } else {
    const sorted = [...data.teams].sort((a, b) => last(b.values) - last(a.values));
    series = sorted.map((t, i) => ({ id: t.id, label: name(t.id), colour: colour(t.id), emphasis: i < 6, values: t.values }));
  }
  return (
    <Panel
      title="The points race"
      sub={view === 'drivers' ? 'Cumulative points after each round, sprints included — the top six highlighted' : 'Cumulative constructors’ points after each round'}
      actions={
        <Segmented
          label="Championship"
          value={view}
          onChange={setView}
          options={[
            { value: 'drivers', label: 'Drivers' },
            { value: 'teams', label: 'Teams' },
          ]}
        />
      }
    >
      <RookieNote>Steeper lines are drivers on a run of form. Hover a line or its legend entry to pick it out from the pack.</RookieNote>
      <LineChart
        x={data.rounds}
        series={series}
        height={360}
        yFormat={(v) => String(v)}
        xFormat={(v) => `R${v}`}
        xLabel="Round"
        tooltipTitle={(r) => season.events.find((e) => e.round === r)?.name ?? `Round ${r}`}
        tooltipFormat={(v) => `${v} pts`}
        ariaLabel={view === 'drivers' ? 'Cumulative drivers championship points by round' : 'Cumulative constructors championship points by round'}
        maxTooltipRows={10}
      />
    </Panel>
  );
}
