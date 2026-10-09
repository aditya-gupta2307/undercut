/** The race report for a Grand Prix that has been run. */

import { useMemo, useState } from 'react';
import { useComputed, type RaceBundle, type Resource } from '../../app/data';
import { useRaceForecast, configKey, useModelConfig } from '../../app/model';
import { useSettings, SURFACE } from '../../app/settings';
import { useTeams } from '../../app/teams';
import type { LinkedSessions } from '../../data/link';
import type { RaceEvent, Season } from '../../data/types';
import { lapTime, pct, seconds } from '../../lib/format';
import { buildRaceTiming } from '../../model/raceTiming';
import { inRaceWinProbability } from '../../model/inrace';
import { Delta, DriverTag, ErrorNotice, Lights, Notice, Panel, Segmented, Stat } from '../../components/ui';
import { ForecastTable } from '../../components/ForecastTable';
import { Term, RookieNote } from '../../components/Term';
import { carDirectory, type CarInfo } from './raceContext';
import { PositionChart, RaceTraceChart, StintChart, SwingChart } from './charts';

function flagClass(flag: string | null, message: string): string {
  if (/SAFETY CAR/i.test(message)) return 'flag-SC';
  if (!flag) return 'flag-NONE';
  if (flag === 'BLACK AND WHITE') return 'flag-BW';
  if (flag === 'DOUBLE YELLOW') return 'flag-YELLOW';
  return `flag-${flag.split(' ')[0]}`;
}

export function Overview({
  season,
  previous,
  event,
  bundle,
  timingAvailable,
  linked,
}: {
  season: Season;
  previous: Season | null | undefined;
  event: RaceEvent;
  bundle: Resource<RaceBundle>;
  timingAvailable: boolean;
  linked: LinkedSessions | null;
}) {
  const results = season.results[event.round] ?? [];
  const fc = useRaceForecast(season, previous, event);
  const { colour } = useTeams();
  const { resolvedTheme } = useSettings();
  const { config } = useModelConfig();
  const [traceView, setTraceView] = useState<'trace' | 'positions'>('trace');
  const [rcFilter, setRcFilter] = useState<'key' | 'all'>('key');

  const data = bundle.data;
  const timing = useMemo(() => (data && data.laps.length ? buildRaceTiming(data.laps, data.pits, data.raceControl, data.result) : null), [data]);
  const cars = useMemo(
    () => (data ? carDirectory(data.drivers, results, season, colour, SURFACE[resolvedTheme]) : new Map()),
    [data, results, season, colour, resolvedTheme],
  );
  const finishOrder = useMemo(() => {
    const nums: number[] = [];
    for (const r of [...results].sort((a, b) => a.order - b.order)) if (r.carNumber !== null) nums.push(r.carNumber);
    return nums;
  }, [results]);
  const gridOrder = useMemo(() => {
    if (data?.grid.length) return data.grid.map((g) => g.driverNumber);
    return [...results].filter((r) => r.carNumber !== null).sort((a, b) => (a.grid || 99) - (b.grid || 99)).map((r) => r.carNumber!);
  }, [data, results]);

  const preRace = useMemo(() => {
    if (!fc.value) return null;
    const m = new Map<number, number>();
    for (const f of fc.value.drivers) {
      const car = results.find((r) => r.driverId === f.driverId)?.carNumber;
      if (car !== null && car !== undefined) m.set(car, f.pWin);
    }
    return m;
  }, [fc.value, results]);

  // Wait for the pre-race forecast (it seeds lap 0), but never block on it.
  const swingReady = timing && data && !fc.computing;
  const officialWinner = results.find((r) => r.position === 1)?.carNumber ?? 'none';
  const swing = useComputed(swingReady ? `swing:v2:${data!.sessionKey}:${officialWinner}:${configKey(config)}` : null, () => {
    const pole = data!.grid.find((g) => g.position === 1)?.lapMs ?? null;
    const qualiGapMs = new Map<number, number>();
    if (pole !== null) for (const g of data!.grid) if (g.lapMs !== null) qualiGapMs.set(g.driverNumber, g.lapMs - pole);
    return inRaceWinProbability({
      timing: timing!,
      stints: data!.stints,
      pits: data!.pits,
      gridOrder,
      qualiGapMs,
      preRace: preRace ?? undefined,
      officialWinner: results.find((r) => r.position === 1)?.carNumber ?? null,
      sims: 1800,
      seed: data!.sessionKey,
    });
  });

  // Verdict numbers.
  const winner = results.find((r) => r.position === 1);
  const favourite = fc.value?.drivers[0];
  const pWinner = winner && fc.value ? fc.value.drivers.find((d) => d.driverId === winner.driverId)?.pWin : undefined;
  const climber = [...results]
    .filter((r) => r.position !== null && r.grid !== null && r.grid > 0)
    .sort((a, b) => b.grid! - b.position! - (a.grid! - a.position!))[0];
  const fastest = results.find((r) => r.fastestLapRank === 1);
  const actual = new Map(results.map((r) => [r.driverId, r.finish === 'finished' ? r.position : null]));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="stats">
        <Stat
          label="Winner"
          value={winner ? season.drivers[winner.driverId]?.familyName ?? winner.driverId : '–'}
          note={winner ? `from ${winner.grid === 0 ? 'the pit lane' : `P${winner.grid}`} · ${winner.timeText ?? ''}` : undefined}
        />
        <Stat
          label={<>Model gave the winner</>}
          value={pWinner !== undefined ? pct(pWinner) : fc.computing ? '…' : '–'}
          note={favourite ? `Favourite: ${season.drivers[favourite.driverId]?.familyName ?? favourite.driverId} (${pct(favourite.pWin)})` : undefined}
        />
        <Stat
          label="Biggest climber"
          value={climber ? season.drivers[climber.driverId]?.familyName ?? climber.driverId : '–'}
          note={climber ? `P${climber.grid} → P${climber.position} (+${climber.grid! - climber.position!})` : undefined}
        />
        <Stat
          label={<Term id="fastest-lap">Fastest lap</Term>}
          value={<span className="fastest num">{fastest ? lapTime(fastest.fastestLapMs) : '–'}</span>}
          note={fastest ? `${season.drivers[fastest.driverId]?.familyName ?? fastest.driverId}, lap ${fastest.fastestLapNumber ?? '?'}` : undefined}
        />
        <Stat
          label={<Term id="safety-car">Neutralisations</Term>}
          value={timing ? String(timing.neutral.length) : '–'}
          note={timing ? (timing.neutral.map((n) => `${n.kind} L${n.startLap}${n.endLap > n.startLap ? `–${n.endLap}` : ''}`).join(', ') || 'Green all the way') : undefined}
        />
      </div>

      {!timingAvailable ? (
        <Notice>
          Lap-by-lap timing — the swing chart, race trace, replay and Strategy Lab — comes from OpenF1, which covers races from 2023 onwards
          {season.year >= 2023 ? ' and has not published this one yet' : ''}.
        </Notice>
      ) : bundle.error ? (
        <ErrorNotice error={bundle.error} onRetry={bundle.reload} what="lap timing" />
      ) : null}

      {timingAvailable && !bundle.error ? (
        <Panel
          title="How the race swung"
          sub={<><Term id="win-probability">Win probability</Term> at the end of every lap, from {(1800).toLocaleString()} simulations of the remaining race per lap</>}
          explainer={undefined}
        >
          <RookieNote>
            Each line is one driver's chance of winning as the race unfolded. Shaded bands are safety-car periods, which bunch the field and can swing everything. The
            marked lap is where the winner's chances jumped the most.
          </RookieNote>
          {swing.error ? (
            <ErrorNotice error={swing.error} what="the swing chart" />
          ) : bundle.loading || !timing || swing.computing || !swing.value ? (
            <Lights label={bundle.loading ? 'Downloading lap timing' : 'Replaying every lap'} />
          ) : (
            <>
              <SwingChart swing={swing.value} cars={cars} timing={timing} />
              {swing.value.lockedInLap !== null && swing.value.winner !== null ? (
                <p className="faint" style={{ fontSize: 'var(--step--1)', marginTop: 8 }}>
                  {cars.get(swing.value.winner)?.name ?? 'The winner'} stayed above 50% from{' '}
                  {swing.value.lockedInLap === 0 ? 'the start' : `lap ${swing.value.lockedInLap}`} to the flag.
                </p>
              ) : null}
            </>
          )}
        </Panel>
      ) : null}

      <div className="grid">
        <Panel className="span-7" title="Classification" flush>
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Race classification</caption>
              <thead>
                <tr>
                  <th scope="col">Pos</th>
                  <th scope="col">Driver</th>
                  <th scope="col" className="r hide-sm">
                    <Term id="grid">Grid</Term>
                  </th>
                  <th scope="col" className="r">+/−</th>
                  <th scope="col" className="r hide-sm">Laps</th>
                  <th scope="col" className="r">
                    Time / <Term id="gap">gap</Term>
                  </th>
                  <th scope="col" className="r">
                    <Term id="points">Pts</Term>
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...results]
                  .sort((a, b) => a.order - b.order)
                  .map((r) => (
                    <tr key={r.driverId}>
                      <td>
                        <span className="pos">{r.position ?? r.positionText}</span>
                      </td>
                      <td>
                        <DriverTag driver={season.drivers[r.driverId]} driverId={r.driverId} teamId={r.teamId} showTeam />
                        {r.fastestLapRank === 1 ? (
                          <span className="fastest" title="Fastest lap" style={{ marginLeft: 8, fontSize: 'var(--step--2)' }}>
                            ◆ FL
                          </span>
                        ) : null}
                      </td>
                      <td className="r num hide-sm">{r.grid === 0 ? 'PL' : r.grid ?? '–'}</td>
                      <td className="r num">{r.position !== null && r.grid ? <Delta value={r.grid - r.position} /> : <span className="faint">–</span>}</td>
                      <td className="r num hide-sm">{r.laps}</td>
                      <td className="r num">
                        {r.finish === 'finished' ? (
                          r.timeText ?? ''
                        ) : (
                          <span className="faint">
                            <Term id={r.finish === 'dnf' ? 'dnf' : r.finish === 'dsq' ? 'dsq' : 'dns'}>{r.finish.toUpperCase()}</Term>
                          </span>
                        )}
                      </td>
                      <td className="r num">{r.points || ''}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel
          className="span-5"
          title="Before lights out"
          sub="What the model said, with the real grid but nothing from the race itself"
          flush
        >
          {fc.error ? (
            <div style={{ padding: 18 }}>
              <ErrorNotice error={fc.error} what="the pre-race forecast" />
            </div>
          ) : fc.computing ? (
            <Lights label="Re-running the pre-race forecast" />
          ) : !fc.value ? (
            <div className="empty">No forecast for this race.</div>
          ) : (
            <ForecastTable season={season} forecast={fc.value.drivers} showPole={false} actual={actual} limit={8} />
          )}
        </Panel>
      </div>

      {timingAvailable && timing && data ? (
        <>
          <Panel
            title={traceView === 'trace' ? 'Race trace' : 'Running order'}
            sub={traceView === 'trace' ? 'Seconds behind the leader on every lap — the top five finishers highlighted' : 'Position at the end of every lap'}
            actions={
              <Segmented
                label="Chart"
                value={traceView}
                onChange={setTraceView}
                options={[
                  { value: 'trace', label: 'Gaps' },
                  { value: 'positions', label: 'Positions' },
                ]}
              />
            }
          >
            <RookieNote>
              {traceView === 'trace' ? (
                <>
                  A <Term id="race-trace">race trace</Term> shows how far behind the leader each car was. A sudden drop is a{' '}
                  <Term id="pit-stop">pit stop</Term>; lines converging inside a shaded band is the field bunching behind the <Term id="safety-car">safety car</Term>.
                </>
              ) : (
                <>Each line is a driver's position lap by lap. Crossing lines are overtakes — or pit stops shuffling the order.</>
              )}
            </RookieNote>
            {traceView === 'trace' ? (
              <RaceTraceChart timing={timing} cars={cars} finishOrder={finishOrder} />
            ) : (
              <PositionChart timing={timing} cars={cars} finishOrder={finishOrder} gridOrder={gridOrder} />
            )}
          </Panel>

          <Panel title="Tyre strategy" sub="Every stint, in finishing order">
            <RookieNote>
              Coloured bars are sets of tyres: <Term id="soft">soft</Term> (red), <Term id="medium">medium</Term> (yellow), <Term id="hard">hard</Term> (white). Dry
              races require two different compounds, so everyone stops at least once.
            </RookieNote>
            <StintChart stints={data.stints} pits={data.pits} cars={cars} order={finishOrder} totalLaps={timing.totalLaps} />
          </Panel>

          <div className="grid">
            <Panel className="span-6" title="Fastest pit stops" sub="Time stationary in the box, and in the pit lane" flush>
              <PitTable bundle={data} cars={cars} />
            </Panel>
            <Panel
              className="span-6"
              title="Race control"
              actions={
                <Segmented
                  label="Messages"
                  value={rcFilter}
                  onChange={setRcFilter}
                  options={[
                    { value: 'key', label: 'Key moments' },
                    { value: 'all', label: 'Everything' },
                  ]}
                />
              }
              flush
            >
              <ul className="rc-feed" aria-label="Race control messages">
                {data.raceControl
                  .filter((m) => rcFilter === 'all' || /SAFETY CAR|RED|CHEQUERED|PENALTY|INVESTIGATION|STARTED|DISQUALIF|RETIRED|STOPPED/i.test(m.message) || (m.flag !== null && !['BLUE', 'CLEAR', 'GREEN'].includes(m.flag)))
                  .map((m, i) => (
                    <li key={i}>
                      <span className="lap">{m.lap !== null ? `L${m.lap}` : ''}</span>
                      <span className={`flag ${flagClass(m.flag, m.message)}`} aria-hidden="true" />
                      <span>{m.message}</span>
                    </li>
                  ))}
              </ul>
            </Panel>
          </div>

          {data.weather.length ? (
            <Panel title="Conditions" sub={linked ? `${linked.meeting.location} during the race` : undefined}>
              <Weather bundle={data} start={linked?.race?.start ?? 0} end={linked?.race?.end ?? Number.POSITIVE_INFINITY} />
            </Panel>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PitTable({ bundle, cars }: { bundle: RaceBundle; cars: Map<number, CarInfo> }) {
  const stops = [...bundle.pits].filter((p) => p.stopMs !== null || p.laneMs !== null).sort((a, b) => (a.stopMs ?? a.laneMs ?? 1e9) - (b.stopMs ?? b.laneMs ?? 1e9));
  if (stops.length === 0) return <div className="empty">No pit stops recorded.</div>;
  return (
    <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="hide-sm">
              #
            </th>
            <th scope="col">Driver</th>
            <th scope="col" className="r">Lap</th>
            <th scope="col" className="r">Stationary</th>
            <th scope="col" className="r hide-sm">Pit lane</th>
          </tr>
        </thead>
        <tbody>
          {stops.slice(0, 15).map((p, i) => {
            const car = cars.get(p.driverNumber);
            return (
              <tr key={`${p.driverNumber}-${p.lap}`}>
                <td className="faint num hide-sm">{i + 1}</td>
                <td>
                  <span className="driver-tag">
                    <span className="bar" style={{ background: car?.colour ?? '#888' }} />
                    <span className="code">{car?.code ?? p.driverNumber}</span>
                    <span className="name">{car?.name ?? ''}</span>
                  </span>
                </td>
                <td className="r num">{p.lap}</td>
                <td className={`r num ${i === 0 && p.stopMs !== null ? 'fastest' : ''}`}>{p.stopMs !== null ? seconds(p.stopMs, 1) : '–'}</td>
                <td className="r num faint hide-sm">{p.laneMs !== null ? seconds(p.laneMs, 1) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Weather({ bundle, start, end }: { bundle: RaceBundle; start: number; end: number }) {
  const during = bundle.weather.filter((w) => w.at >= start - 600_000 && w.at <= end);
  const samples = during.length ? during : bundle.weather;
  const range = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? `${Math.min(...v).toFixed(1)}–${Math.max(...v).toFixed(1)}` : '–';
  };
  const rain = samples.some((w) => w.rainfall);
  return (
    <div className="weather-strip">
      <div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Track temperature</div>
        <div className="num">{range(samples.map((w) => w.trackTemp))} °C</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Air temperature</div>
        <div className="num">{range(samples.map((w) => w.airTemp))} °C</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Humidity</div>
        <div className="num">{range(samples.map((w) => w.humidity))} %</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Wind</div>
        <div className="num">{range(samples.map((w) => w.windSpeed))} m/s</div>
      </div>
      <div>
        <div className="faint" style={{ fontSize: 'var(--step--2)' }}>Rain</div>
        <div>{rain ? 'Yes — at some point' : 'None recorded'}</div>
      </div>
    </div>
  );
}
