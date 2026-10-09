/**
 * The title fight: who can still win, how likely each outcome is, how the
 * odds moved race by race, and a what-if tool to play out the next result.
 */

import { useEffect, useMemo, useState } from 'react';
import { usePriorSeason, useSeasonData } from '../app/data';
import { configKey, useChampionship, useModelConfig } from '../app/model';
import { useSettings } from '../app/settings';
import { Link, useTitle } from '../app/router';
import { useTeams } from '../app/teams';
import type { Season } from '../data/types';
import { pct, plural } from '../lib/format';
import { mathematicalStatus, tallyFromResults, type ChampionshipResult, type MathStatus, type TitleOdds } from '../model/championship';
import { titleOddsHistory, type TitleHistoryPoint } from '../model/history';
import { DriverTag, Empty, ErrorNotice, Lights, Notice, Panel, ProbBar, Segmented } from '../components/ui';
import { LineChart, type LineSeries } from '../components/charts/LineChart';
import { Term, RookieNote } from '../components/Term';

export default function TitlePage() {
  const { season: year } = useSettings();
  useTitle(`${year} title fight`);
  const cur = useSeasonData(year);
  const prior = usePriorSeason(year);
  const title = useChampionship(cur.season, prior);
  const [whatIf, setWhatIf] = useState<Map<number, string[]> | null>(null);
  const alt = useChampionship(whatIf ? cur.season : null, prior, whatIf ?? undefined);

  if (!cur.season) {
    if (cur.error) return <ErrorNotice error={cur.error} onRetry={cur.reload} what={`the ${year} season`} />;
    return <Lights label={`Loading the ${year} season`} />;
  }
  const season = cur.season;
  if (!Object.keys(season.results).length) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <h1>The {year} title fight</h1>
        <Empty>The title odds appear after the first race of the season.</Empty>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <header className="page-head">
        <div className="eyebrow">{year} World Championship</div>
        <h1>The title fight</h1>
        {title.value ? <Summary season={season} result={title.value} /> : <p className="muted">Simulating the rest of the season…</p>}
      </header>
      <RookieNote>
        The model plays out every remaining <Term id="sprint">sprint</Term> and <Term id="grand-prix">Grand Prix</Term> thousands of times, adding points to the real
        table each time. A driver's title chance is the share of those seasons they finished on top; ties are broken by{' '}
        <Term id="countback">countback</Term>.
      </RookieNote>

      {title.error ? <ErrorNotice error={title.error} what="the title simulation" /> : null}
      {title.computing || !title.value ? (
        <Lights label="Simulating the rest of the season" />
      ) : (
        <>
          <DriverOdds season={season} result={title.value} />
          {title.value.remaining.length > 0 ? (
            <WhatIf season={season} result={title.value} alt={alt.value} altComputing={alt.computing} whatIf={whatIf} setWhatIf={setWhatIf} />
          ) : null}
          <History season={season} previous={prior ?? null} />
          <TeamOdds result={title.value} />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Summary({ season, result }: { season: Season; result: ChampionshipResult }) {
  const tally = tallyFromResults(season);
  const status = mathematicalStatus(tally, result.remaining);
  const name = (id: string) => {
    const d = season.drivers[id];
    return d ? `${d.givenName} ${d.familyName}` : id;
  };
  const [a, b] = tally.drivers;
  if (!a) return null;
  if (status.clinched) {
    return (
      <p className="muted" style={{ fontSize: 'var(--step-1)' }}>
        <strong style={{ color: 'var(--ink)' }}>{name(status.clinched)}</strong> is the {season.year} World Champion
        {result.remaining.length ? ' — no one can catch them now, whatever happens in the remaining races.' : '.'}
      </p>
    );
  }
  const lead = b ? a.points - b.points : a.points;
  const fav = result.drivers[0];
  return (
    <p className="muted" style={{ fontSize: 'var(--step-1)', maxWidth: '70ch' }}>
      <strong style={{ color: 'var(--ink)' }}>{name(a.driverId)}</strong> leads {b ? <>{name(b.driverId)} by {plural(lead, 'point')}</> : null} with{' '}
      {plural(result.remaining.length, 'session')} and {status.maxRemaining} points still to play for.
      {fav ? (
        <>
          {' '}
          The model makes {fav.driverId === a.driverId ? 'the leader' : name(fav.driverId)} the favourite at {pct(fav.pChampion)}.
        </>
      ) : null}
      {status.earliestClinch !== null ? <> The title could be decided as early as the {result.remaining[status.earliestClinch]!.name}{result.remaining[status.earliestClinch]!.kind === 'sprint' ? ' sprint' : ''}.</> : null}
    </p>
  );
}

function rangeDomain(rows: TitleOdds[]): [number, number] {
  const lo = Math.min(...rows.map((r) => r.currentPoints));
  const hi = Math.max(...rows.map((r) => r.p90));
  return [Math.max(0, Math.floor(lo / 10) * 10), Math.ceil(hi / 10) * 10 || 10];
}

function DriverOdds({ season, result }: { season: Season; result: ChampionshipResult }) {
  const { colour } = useTeams();
  const [all, setAll] = useState(false);
  const status: MathStatus = useMemo(() => mathematicalStatus(tallyFromResults(season), result.remaining), [season, result]);
  // Order by the real standings, so the table reads like the championship.
  const tally = useMemo(() => tallyFromResults(season), [season]);
  const rank = new Map(tally.drivers.map((d, i) => [d.driverId, i + 1]));
  const rows = [...result.drivers].sort((a, b) => (rank.get(a.driverId) ?? 99) - (rank.get(b.driverId) ?? 99));
  const shown = all ? rows : rows.slice(0, 10);
  const [lo, hi] = rangeDomain(shown);
  const x = (v: number) => `${((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo || 1)) * 100}%`;
  const maxP = Math.max(0.05, ...rows.map((r) => r.pChampion));

  return (
    <Panel
      title="Drivers' title odds"
      sub={`${result.sims.toLocaleString()} simulated finishes to the season`}
      flush
      foot={
        status.eliminated.size ? (
          <>
            {plural(status.eliminated.size, 'driver')} can no longer win the title, even by winning every remaining session ({status.maxRemaining} points).
          </>
        ) : (
          <>Everyone is still mathematically in it, with {status.maxRemaining} points left to win.</>
        )
      }
    >
      <div className="odds-row odds-head" aria-hidden="true">
        <span>Pos</span>
        <span>Driver</span>
        <span>Title chance</span>
        <span className="odds-range">
          Final points: <span className="faint">likely range, median ●, today │</span>
        </span>
        <span className="odds-exp r">Expected</span>
      </div>
      {shown.map((d) => {
        const out = status.eliminated.has(d.driverId);
        return (
          <div key={d.driverId} className={`odds-row ${out ? 'elim' : ''}`}>
            <span className="pos">{rank.get(d.driverId) ?? '–'}</span>
            <DriverTag driver={season.drivers[d.driverId]} driverId={d.driverId} teamId={d.teamId} showTeam link />
            {out ? (
              <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
                Out of contention
              </span>
            ) : (
              <ProbBar p={d.pChampion} colour={colour(d.teamId)} max={maxP} label={`${season.drivers[d.driverId]?.familyName ?? d.driverId} title chance`} />
            )}
            <div className="odds-range range-html" title={`Today ${d.currentPoints} · 80% of simulations end between ${Math.round(d.p10)} and ${Math.round(d.p90)} (median ${Math.round(d.p50)})`}>
              <span className="range-bar" style={{ left: x(d.p10), width: `calc(${x(d.p90)} - ${x(d.p10)})`, background: colour(d.teamId) }} />
              <span className="range-now" style={{ left: x(d.currentPoints) }} />
              <span className="range-mid" style={{ left: x(d.p50), borderColor: colour(d.teamId) }} />
              <span className="range-lbl num" style={{ left: x(d.p90) }}>
                {Math.round(d.p10)}–{Math.round(d.p90)}
              </span>
            </div>
            <span className="odds-exp r num">{Math.round(d.expectedPoints)}</span>
          </div>
        );
      })}
      {rows.length > 10 ? (
        <div style={{ padding: '10px 18px' }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setAll((v) => !v)}>
            {all ? 'Show the top ten' : `Show all ${rows.length} drivers`}
          </button>
        </div>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------

function WhatIf({
  season,
  result,
  alt,
  altComputing,
  whatIf,
  setWhatIf,
}: {
  season: Season;
  result: ChampionshipResult;
  alt: ChampionshipResult | null;
  altComputing: boolean;
  whatIf: Map<number, string[]> | null;
  setWhatIf: (m: Map<number, string[]> | null) => void;
}) {
  const { colour } = useTeams();
  const [eventIdx, setEventIdx] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const tally = useMemo(() => tallyFromResults(season), [season]);
  const contenders = useMemo(() => {
    const byPoints = new Map(tally.drivers.map((d, i) => [d.driverId, i]));
    return [...result.drivers].sort((a, b) => (byPoints.get(a.driverId) ?? 99) - (byPoints.get(b.driverId) ?? 99));
  }, [result, tally]);
  const ev = result.remaining[eventIdx];
  const toggle = (id: string) => setPicks((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 3 ? p : [...p, id]));
  const applied = whatIf !== null;

  const compare = useMemo(() => {
    if (!alt) return [];
    const after = new Map(alt.drivers.map((d) => [d.driverId, d.pChampion]));
    return result.drivers
      .map((d) => ({ d, before: d.pChampion, after: after.get(d.driverId) ?? 0 }))
      .filter((r) => r.before > 0.0005 || r.after > 0.0005)
      .sort((a, b) => b.after - a.after)
      .slice(0, 8);
  }, [alt, result]);

  return (
    <Panel
      title="What if…?"
      sub="Fix the podium of an upcoming session and re-run the whole season"
      actions={
        applied ? (
          <button
            className="btn btn-sm"
            onClick={() => {
              setWhatIf(null);
              setPicks([]);
            }}
          >
            Clear
          </button>
        ) : null
      }
    >
      <div className="stack" style={{ gap: 14 }}>
        <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
          <label className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Session{' '}
            <select
              className="select"
              value={eventIdx}
              onChange={(e) => {
                setEventIdx(Number(e.target.value));
                setWhatIf(null);
              }}
              aria-label="Session to fix"
            >
              {result.remaining.map((r, i) => (
                <option key={`${r.round}-${r.kind}`} value={i}>
                  R{r.round} {r.name.replace(/ Grand Prix.*/, '')} {r.kind === 'sprint' ? 'sprint' : 'GP'}
                </option>
              ))}
            </select>
          </label>
          <span className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Pick up to three finishers in order: {picks.length ? picks.map((id, i) => `P${i + 1} ${season.drivers[id]?.code ?? id}`).join(', ') : 'none yet'}.
          </span>
        </div>
        <div className="whatif" role="group" aria-label="Drivers">
          {contenders.map((d) => {
            const i = picks.indexOf(d.driverId);
            return (
              <button key={d.driverId} type="button" className="pick-chip" aria-pressed={i >= 0} onClick={() => toggle(d.driverId)} disabled={i < 0 && picks.length >= 3}>
                <span className="bar" style={{ background: colour(d.teamId) }} />
                {i >= 0 ? <strong>P{i + 1}</strong> : null}
                {season.drivers[d.driverId]?.code ?? d.driverId}
              </button>
            );
          })}
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary btn-sm" disabled={!picks.length || !ev} onClick={() => setWhatIf(new Map([[eventIdx, picks]]))}>
            Run the season with this result
          </button>
          {picks.length ? (
            <button className="btn btn-sm btn-ghost" onClick={() => setPicks([])}>
              Reset picks
            </button>
          ) : null}
        </div>
        {applied ? (
          altComputing || !alt ? (
            <Lights label="Re-running every remaining session" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <caption className="sr-only">Title odds before and after the what-if result</caption>
                <thead>
                  <tr>
                    <th scope="col">Driver</th>
                    <th scope="col" className="r">
                      Now
                    </th>
                    <th scope="col" className="r">
                      With your result
                    </th>
                    <th scope="col" className="r">
                      Change
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {compare.map(({ d, before, after }) => {
                    const delta = (after - before) * 100;
                    return (
                      <tr key={d.driverId}>
                        <td>
                          <DriverTag driver={season.drivers[d.driverId]} driverId={d.driverId} teamId={d.teamId} />
                        </td>
                        <td className="r num">{pct(before)}</td>
                        <td className="r num">
                          <strong>{pct(after)}</strong>
                        </td>
                        <td className={`r num ${delta > 0.5 ? 'delta-up' : delta < -0.5 ? 'delta-down' : 'delta-flat'}`}>
                          {Math.abs(delta) < 0.5 ? '–' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(0)} pts`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="faint" style={{ fontSize: 'var(--step--2)', padding: '8px 0 0' }}>
                Changes are in percentage points. Everything after the fixed session is still simulated.
              </p>
            </div>
          )
        ) : null}
      </div>
    </Panel>
  );
}

// ---------------------------------------------------------------------------

const historyCache = new Map<string, TitleHistoryPoint[]>();

function History({ season, previous }: { season: Season; previous: Season | null }) {
  const { config } = useModelConfig();
  const { colour, name } = useTeams();
  const key = `${season.year}@${season.fetchedAt}:${previous ? `${previous.year}@${previous.fetchedAt}` : 'none'}:${configKey(config)}`;
  const [state, setState] = useState<{ key: string; data: TitleHistoryPoint[] | null; done: number; total: number; error: unknown }>(() => ({
    key,
    data: historyCache.get(key) ?? null,
    done: 0,
    total: 0,
    error: null,
  }));
  const [view, setView] = useState<'drivers' | 'teams'>('drivers');

  useEffect(() => {
    const hit = historyCache.get(key);
    if (hit) {
      setState({ key, data: hit, done: hit.length, total: hit.length, error: null });
      return undefined;
    }
    let cancelled = false;
    setState({ key, data: null, done: 0, total: 0, error: null });
    titleOddsHistory(season, previous, config, {
      // Fewer draws per step than the headline odds: this runs once per round of history.
      sims: 1200,
      onProgress: (done, total) => !cancelled && setState((s) => ({ ...s, done, total })),
      cancelled: () => cancelled,
    }).then(
      (data) => {
        if (cancelled || !data) return;
        historyCache.set(key, data);
        setState({ key, data, done: data.length, total: data.length, error: null });
      },
      (error: unknown) => !cancelled && setState((s) => ({ ...s, error })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, season, previous, config]);

  const data = state.key === key ? state.data : null;
  const series: LineSeries[] = useMemo(() => {
    if (!data) return [];
    const ids = new Set<string>();
    for (const h of data) for (const id of (view === 'drivers' ? h.odds : h.teamOdds).keys()) ids.add(id);
    const peak = (id: string) => Math.max(...data.map((h) => (view === 'drivers' ? h.odds : h.teamOdds).get(id) ?? 0));
    const ranked = [...ids].sort((a, b) => peak(b) - peak(a));
    const top = new Set(ranked.slice(0, 6).filter((id) => peak(id) >= 0.02));
    const seen = new Set<string>();
    return ranked.map((id) => {
      const teamId = view === 'drivers' ? latestTeam(season, id) : id;
      const c = colour(teamId);
      const emphasis = top.has(id);
      const dashed = emphasis && view === 'drivers' && seen.has(c);
      if (emphasis) seen.add(c);
      return {
        id,
        label: view === 'drivers' ? season.drivers[id]?.code ?? id : name(id),
        colour: c,
        emphasis,
        dashed,
        values: data.map((h) => ((view === 'drivers' ? h.odds : h.teamOdds).get(id) ?? 0) * 100),
      };
    });
  }, [data, view, season, colour, name]);

  return (
    <Panel
      title="How the odds moved"
      sub="Title chances as the model would have rated them after each round, using only what was known at the time"
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
      {state.error ? (
        <ErrorNotice error={state.error} what="the odds history" />
      ) : !data ? (
        <div className="stack" style={{ gap: 10, padding: '20px 0' }}>
          <div className="faint" style={{ fontSize: 'var(--step--1)' }}>
            Re-running the season {state.total ? `· round ${state.done} of ${state.total}` : ''}… each step refits the model and simulates the rest of the year.
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={state.total || 1} aria-valuenow={state.done}>
            <div style={{ width: `${state.total ? (state.done / state.total) * 100 : 3}%` }} />
          </div>
        </div>
      ) : data.length < 2 ? (
        <Empty>The history appears after the second race.</Empty>
      ) : (
        <LineChart
          x={data.map((h) => h.round)}
          series={series}
          height={340}
          yDomain={[0, 100]}
          yTicks={[0, 25, 50, 75, 100]}
          yFormat={(v) => `${v}%`}
          xFormat={(v) => (v === 0 ? 'Pre' : `R${v}`)}
          xLabel="After round"
          tooltipTitle={(r) => (r === 0 ? 'Before the season' : `After ${season.events.find((e) => e.round === r)?.name ?? `round ${r}`}`)}
          tooltipFormat={(v) => pct(v / 100)}
          ariaLabel="Championship probability after each round"
        />
      )}
    </Panel>
  );
}

function latestTeam(season: Season, driverId: string): string {
  const rounds = Object.keys(season.results).map(Number).sort((a, b) => b - a);
  for (const r of rounds) {
    const row = season.results[r]!.find((x) => x.driverId === driverId);
    if (row) return row.teamId;
  }
  return '';
}

// ---------------------------------------------------------------------------

function TeamOdds({ result }: { result: ChampionshipResult }) {
  const { colour, name } = useTeams();
  const rows = [...result.teams].sort((a, b) => b.pChampion - a.pChampion || b.currentPoints - a.currentPoints);
  const maxP = Math.max(0.05, ...rows.map((r) => r.pChampion));
  if (!rows.length) return <Notice>No constructor data yet.</Notice>;
  return (
    <Panel title={<><Term id="constructor">Constructors'</Term> title odds</>} sub="Both cars' points count" flush>
      {rows.map((t, i) => (
        <div key={t.teamId} className="odds-row team-odds">
          <span className="pos">{i + 1}</span>
          <span className="driver-tag">
            <span className="bar" style={{ background: colour(t.teamId) }} aria-hidden="true" />
            <span className="name" style={{ fontWeight: 500 }}>
              {name(t.teamId)}
            </span>
          </span>
          <ProbBar p={t.pChampion} colour={colour(t.teamId)} max={maxP} label={`${name(t.teamId)} title chance`} />
          <span className="odds-range num faint" style={{ fontSize: 'var(--step--1)' }}>
            {t.currentPoints} pts now
          </span>
          <span className="odds-exp r num">{Math.round(t.expectedPoints)}</span>
        </div>
      ))}
      <div style={{ padding: '10px 18px' }} className="faint">
        <span style={{ fontSize: 'var(--step--1)' }}>
          Expected final points on the right. <Link to="/model">How good is the model?</Link>
        </span>
      </div>
    </Panel>
  );
}
