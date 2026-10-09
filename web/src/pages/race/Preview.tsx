/** The race centre before a Grand Prix: the model's call, the grid, the weather and the circuit's history. */

import { useMemo, useState } from 'react';
import { useNow, useResource } from '../../app/data';
import { useRaceForecast } from '../../app/model';
import { raceTime } from '../../data/season';
import { sessionList } from '../../data/weekend';
import { fetchRaceWeather, forecastAvailable, summariseRaceWeather, weatherLabel, type HourlyForecast } from '../../data/weather';
import type { LinkedSessions } from '../../data/link';
import type { QualiRow, RaceEvent, ResultRow, Season } from '../../data/types';
import { clock, countdown, gmtLabel, hourLabel, lapTime, longDate, pct, trackClock } from '../../lib/format';
import type { DriverForecast } from '../../model/forecast';
import { DriverTag, ErrorNotice, Empty, Lights, Notice, Panel, Segmented, Stat } from '../../components/ui';
import { ForecastTable } from '../../components/ForecastTable';
import { TrackMap } from '../../components/TrackMap';
import { CircuitDna } from '../../components/CircuitDna';
import { Term, RookieNote } from '../../components/Term';

export function Preview({ season, previous, event, linked }: { season: Season; previous: Season | null | undefined; event: RaceEvent; linked: LinkedSessions | null }) {
  const now = useNow(30_000);
  const fc = useRaceForecast(season, previous, event);
  const quali = season.qualifying[event.round] ?? [];
  const sprint = season.sprints[event.round] ?? [];
  const raceAt = raceTime(event);
  const ran = now > raceAt + 3 * 3_600_000;
  const nextRound = season.events.find((e) => !season.results[e.round]?.length)?.round;
  const farAhead = nextRound !== undefined && event.round > nextRound;
  const [gridView, setGridView] = useState<'grid' | 'times'>('grid');

  return (
    <div className="stack" style={{ gap: 18 }}>
      {ran ? (
        <Notice>This race has been run. The full report — swing chart, strategy, replay — appears here as soon as the results are published.</Notice>
      ) : null}

      <div className="grid" style={{ alignItems: 'start' }}>
        <Panel
          className="span-8"
          title="The model's call"
          sub={
            fc.value
              ? `${fc.value.models.config.sims.toLocaleString()} simulated races · ${fc.value.gridKnown ? 'grid set by qualifying' : 'qualifying simulated too'} · trained on ${fc.value.models.training.weekends} weekends`
              : fc.computing
                ? 'Fitting the model…'
                : fc.error
                  ? 'The forecast could not be computed'
                  : 'Waiting for the entry list'
          }
          flush
          foot={
            farAhead ? (
              <>This race is a few weeks away, so the call uses current form only. It sharpens after each race, and again once qualifying sets the grid.</>
            ) : fc.value && !fc.value.gridKnown ? (
              <>Qualifying has not run yet, so each simulation also simulates qualifying. Once the grid is set the forecast updates.</>
            ) : null
          }
        >
          <RookieNote>
            Each percentage is how often that driver won (or reached the podium, or scored) across thousands of simulated versions of this race. A 30% favourite
            still loses seven times in ten.
          </RookieNote>
          {fc.error ? (
            <div style={{ padding: 18 }}>
              <ErrorNotice error={fc.error} what="the forecast" />
            </div>
          ) : fc.computing ? (
            <Lights label="Simulating the race" />
          ) : !fc.value ? (
            <Empty>No entry list yet — the forecast appears once the season's first session has run.</Empty>
          ) : (
            <ForecastTable season={season} forecast={fc.value.drivers} showPole={!fc.value.gridKnown} />
          )}
        </Panel>

        <div className="stack span-4">
          <Panel title="Weekend schedule" sub={linked ? `Your time, then circuit time (${gmtLabel(linked.meeting.gmtOffset)})` : 'In your time zone'}>
            <Schedule event={event} gmtOffset={linked?.meeting.gmtOffset ?? null} now={now} />
          </Panel>
          <Panel title="Race-day weather" sub="Forecast for the circuit at lights out">
            <RaceWeather event={event} now={now} />
          </Panel>
        </div>
      </div>

      {fc.value && fc.value.drivers.length ? (
        <Panel
          title="Where everyone finishes"
          sub="Chance of each driver finishing in each position, with retirements in the last column"
          explainer={undefined}
        >
          <RookieNote>
            Read across a row to see one driver's spread of outcomes. A tight, bright cluster is a confident call; a long smear means the race could go anywhere for
            them. The last column is the chance of a <Term id="dnf">DNF</Term>.
          </RookieNote>
          <PositionHeatmap season={season} forecast={fc.value.drivers} />
        </Panel>
      ) : null}

      {quali.length ? (
        <Panel
          title="Qualifying"
          sub={gridView === 'grid' ? 'Qualifying order — grid penalties, if any, are applied by the stewards before the start' : 'Lap times in each part of qualifying'}
          actions={
            <Segmented
              label="Qualifying view"
              value={gridView}
              onChange={setGridView}
              options={[
                { value: 'grid', label: 'Grid' },
                { value: 'times', label: 'Times' },
              ]}
            />
          }
          flush={gridView === 'times'}
        >
          {gridView === 'grid' ? <StartingGrid season={season} rows={quali} /> : <QualiTable season={season} rows={quali} />}
        </Panel>
      ) : null}

      {sprint.length ? (
        <Panel title={<><Term id="sprint">Sprint</Term> result</>} sub="Saturday's short race — points to the top eight" flush>
          <SprintTable season={season} rows={sprint} />
        </Panel>
      ) : null}

      <div className="grid">
        <Panel className="span-6" title="The circuit" sub={`${event.circuit.name} · ${event.circuit.locality}, ${event.circuit.country}`}>
          <TrackMap circuitKey={linked?.meeting.circuitKey ?? null} height={280} car label={`${event.circuit.name} layout`} />
          <p className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 8 }}>
            Traced from a real car's position data on a previous visit, not drawn by hand.
          </p>
        </Panel>
        <Panel className="span-6" title="Circuit DNA" sub="What history says about this place">
          <CircuitDna circuitId={event.circuit.id} circuitName={event.circuit.name} />
        </Panel>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Schedule({ event, gmtOffset, now }: { event: RaceEvent; gmtOffset: string | null; now: number }) {
  const sessions = sessionList(event);
  if (sessions.length === 0) return <Empty>The session timetable has not been published yet.</Empty>;
  const upcoming = sessions.find((s) => s.end > now);
  return (
    <div className="stack" style={{ gap: 10 }}>
      {upcoming ? (
        <div className="countdown" style={{ marginTop: 0 }}>
          <div className="countdown-label">{upcoming.at <= now ? `${upcoming.label} is running` : `${upcoming.label} in`}</div>
          <div className="countdown-value" style={{ fontSize: 'var(--step-3)' }}>
            {upcoming.at <= now ? 'Live now' : countdown(upcoming.at - now)}
          </div>
        </div>
      ) : null}
      <ol className="schedule compact" aria-label="Weekend schedule">
        {sessions.map((s) => {
          const done = s.end < now;
          const live = s.at <= now && now <= s.end;
          return (
            <li key={s.key} className={done ? 'done' : live ? 'live' : ''}>
              <span className="sched-name">{s.label}</span>
              <span className="sched-day">{longDate(s.at)}</span>
              <span className="sched-time num">{clock(s.at)}</span>
              {gmtOffset ? (
                <span className="sched-local num faint" title="Local time at the circuit">
                  {trackClock(s.at, gmtOffset)} local
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------

function RaceWeather({ event, now }: { event: RaceEvent; now: number }) {
  const raceAt = raceTime(event);
  const { lat, lon } = event.circuit;
  const can = lat !== null && lon !== null && event.start !== null && forecastAvailable(raceAt, now);
  // One forecast per race per hour is plenty; the key rolls over every hour.
  const hourBucket = Math.floor(now / 3_600_000);
  const res = useResource<HourlyForecast[]>(can ? `wx:v1:${event.season}:${event.round}:${hourBucket}` : null, () => fetchRaceWeather(lat!, lon!, raceAt), {
    ttlMs: 3_600_000,
  });
  if (!can) {
    if (lat === null || lon === null) return <Empty>No coordinates for this circuit.</Empty>;
    if (raceAt + 3 * 3_600_000 <= now) return <Empty>The race has been run.</Empty>;
    return <Empty>The forecast opens about two weeks before the race.</Empty>;
  }
  if (res.loading) return <Lights label="Checking the sky" />;
  if (res.error || !res.data) {
    return (
      <div className="stack" style={{ gap: 8 }}>
        <div className="faint" style={{ fontSize: 'var(--step--1)' }}>The weather service did not answer. The rest of the page is unaffected.</div>
        <div>
          <button className="btn btn-sm" onClick={res.reload}>
            Try again
          </button>
        </div>
      </div>
    );
  }
  const rows = res.data;
  const s = summariseRaceWeather(rows, raceAt);
  if (!s.atStart) return <Empty>No forecast for the race hour yet.</Empty>;
  const maxRain = Math.max(0.2, ...rows.map((r) => r.rainChance ?? 0));
  const startHour = Math.floor(raceAt / 3_600_000) * 3_600_000;
  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }}>
        <Stat label="Rain during the race" value={s.anyRainChance !== null ? pct(s.anyRainChance, 0) : '–'} note={weatherLabel(s.atStart.code)} />
        <Stat
          label="Air at lights out"
          value={s.atStart.tempC !== null ? `${s.atStart.tempC.toFixed(0)}°C` : '–'}
          note={s.atStart.windKmh !== null ? `Wind ${s.atStart.windKmh.toFixed(0)} km/h` : undefined}
        />
      </div>
      <div className="wx-strip" role="img" aria-label="Hourly chance of rain around the race">
        {rows.map((r) => {
          const isStart = r.at === startHour;
          const h = Math.round(((r.rainChance ?? 0) / maxRain) * 100);
          return (
            <div key={r.at} className={`wx-hour ${isStart ? 'is-start' : ''}`} title={`${clock(r.at)} · ${pct(r.rainChance ?? 0, 0)} rain · ${r.tempC ?? '–'}°C · ${weatherLabel(r.code)}`}>
              <div className="wx-bar-track">
                <div className="wx-bar" style={{ height: `${Math.max(3, h)}%` }} />
              </div>
              <div className="wx-val num">{r.rainChance !== null ? Math.round(r.rainChance * 100) : '–'}</div>
              <div className="wx-time num faint">{isStart ? 'Start' : hourLabel(r.at)}</div>
            </div>
          );
        })}
      </div>
      <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
        Hourly chance of rain (%). Forecast by{' '}
        <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">
          Open-Meteo
        </a>
        . The model does not know about rain — a wet race makes every forecast on this page less certain.
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PositionHeatmap({ season, forecast }: { season: Season; forecast: DriverForecast[] }) {
  const rows = useMemo(() => [...forecast].sort((a, b) => a.expectedFinish - b.expectedFinish), [forecast]);
  const n = Math.max(...rows.map((r) => r.positionProbs.length));
  const max = Math.max(0.01, ...rows.flatMap((r) => [...r.positionProbs, r.pDnf]));
  const cell = (p: number) => {
    const t = Math.pow(Math.min(1, p / max), 0.75);
    return { background: `color-mix(in srgb, var(--accent) ${Math.round(t * 100)}%, transparent)`, color: t > 0.55 ? 'var(--accent-ink)' : 'var(--ink-2)' };
  };
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="table-wrap">
        <table className="heatmap" aria-label="Probability of each finishing position for each driver">
          <thead>
            <tr>
              <th scope="col" className="hm-driver">
                Driver
              </th>
              {Array.from({ length: n }, (_, k) => (
                <th key={k} scope="col">
                  {k + 1}
                </th>
              ))}
              <th scope="col" className="hm-dnf">
                DNF
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const d = season.drivers[r.driverId];
              const code = d?.code ?? r.driverId.slice(0, 3).toUpperCase();
              return (
                <tr key={r.driverId}>
                  <th scope="row" className="hm-driver">
                    <DriverTag driver={d} driverId={r.driverId} teamId={r.teamId} showName={false} />
                  </th>
                  {Array.from({ length: n }, (_, k) => {
                    const p = r.positionProbs[k] ?? 0;
                    return (
                      <td key={k} style={cell(p)} title={`${code} finishes P${k + 1}: ${pct(p)}`}>
                        {p >= 0.095 ? Math.round(p * 100) : ''}
                      </td>
                    );
                  })}
                  <td className="hm-dnf" style={cell(r.pDnf)} title={`${code} does not finish: ${pct(r.pDnf)}`}>
                    {r.pDnf >= 0.095 ? Math.round(r.pDnf * 100) : ''}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="legend" style={{ padding: 0 }}>
        <span className="legend-item" style={{ cursor: 'default' }}>
          <span className="hm-scale" aria-hidden="true" />
          0% → {pct(max, 0)} · numbers shown from 10% · rows ordered by expected finish
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function StartingGrid({ season, rows }: { season: Season; rows: QualiRow[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  return (
    <ol className="start-grid" aria-label="Qualifying order as a starting grid">
      {sorted.map((r) => {
        const best = r.q3Ms ?? r.q2Ms ?? r.q1Ms;
        return (
          <li key={r.driverId} className={r.position % 2 === 0 ? 'even' : 'odd'}>
            <span className="slot-num">{r.position}</span>
            <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamId} showTeam />
            <span className="num faint slot-time">{best !== null ? lapTime(best) : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function QualiTable({ season, rows }: { season: Season; rows: QualiRow[] }) {
  const sorted = [...rows].sort((a, b) => a.position - b.position);
  const fastest = (k: 'q1Ms' | 'q2Ms' | 'q3Ms') => {
    const v = sorted.map((r) => r[k]).filter((x): x is number => x !== null);
    return v.length ? Math.min(...v) : null;
  };
  const best = { q1Ms: fastest('q1Ms'), q2Ms: fastest('q2Ms'), q3Ms: fastest('q3Ms') };
  const pole = sorted[0]?.q3Ms ?? null;
  const cellFor = (r: QualiRow, k: 'q1Ms' | 'q2Ms' | 'q3Ms') => {
    const v = r[k];
    if (v === null) return <span className="faint">–</span>;
    return <span className={v === best[k] ? 'purple' : ''}>{lapTime(v)}</span>;
  };
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Qualifying lap times</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Driver</th>
            <th scope="col" className="r hide-sm">
              Q1
            </th>
            <th scope="col" className="r hide-sm">
              Q2
            </th>
            <th scope="col" className="r">
              <Term id="q3">Q3</Term>
            </th>
            <th scope="col" className="r">
              To <Term id="pole">pole</Term>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.driverId}>
              <td>
                <span className="pos">{r.position}</span>
              </td>
              <td>
                <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamId} showTeam />
              </td>
              <td className="r num hide-sm">{cellFor(r, 'q1Ms')}</td>
              <td className="r num hide-sm">{cellFor(r, 'q2Ms')}</td>
              <td className="r num">{cellFor(r, 'q3Ms')}</td>
              <td className="r num">
                {r.q3Ms !== null && pole !== null ? (
                  r.position === 1 ? (
                    <span className="faint">Pole</span>
                  ) : (
                    `+${((r.q3Ms - pole) / 1000).toFixed(3)}`
                  )
                ) : (
                  <span className="faint">Out in {r.q2Ms !== null ? 'Q2' : 'Q1'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="faint" style={{ fontSize: 'var(--step--2)', padding: '8px 18px 14px' }}>
        <span className="purple">Purple</span> marks the fastest lap of each session.
      </p>
    </div>
  );
}

function SprintTable({ season, rows }: { season: Season; rows: ResultRow[] }) {
  const sorted = [...rows].sort((a, b) => a.order - b.order);
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Sprint classification</caption>
        <thead>
          <tr>
            <th scope="col">Pos</th>
            <th scope="col">Driver</th>
            <th scope="col" className="r">
              <Term id="grid">Grid</Term>
            </th>
            <th scope="col" className="r">Time / gap</th>
            <th scope="col" className="r">Pts</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.driverId}>
              <td>
                <span className="pos">{r.position ?? r.positionText}</span>
              </td>
              <td>
                <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamId} showTeam />
              </td>
              <td className="r num">{r.grid === 0 ? 'PL' : r.grid ?? '–'}</td>
              <td className="r num">{r.finish === 'finished' ? r.timeText ?? '' : <span className="faint">{r.finish.toUpperCase()}</span>}</td>
              <td className="r num">{r.points || ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
