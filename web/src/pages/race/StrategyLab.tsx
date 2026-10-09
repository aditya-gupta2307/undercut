/**
 * Strategy Lab: rewrite one car's pit strategy and see where it would have
 * finished. A per-race tyre model (fitted to every clean lap of this race)
 * simulates both the real plan and yours; only the difference is used, so the
 * model's own bias cancels out.
 */

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useComputed, type RaceBundle, type Resource } from '../../app/data';
import { setQuery, useRoute } from '../../app/router';
import { useSettings, SURFACE } from '../../app/settings';
import { useTeams } from '../../app/teams';
import type { Compound, RaceEvent, Season } from '../../data/types';
import { lapTime, ordinal } from '../../lib/format';
import { buildRaceTiming, estimatePitLoss, type RaceTiming } from '../../model/raceTiming';
import {
  fitTyreModel,
  isWetRace,
  planFromStints,
  positionWithDelta,
  searchStrategies,
  simulatePlan,
  stopsOf,
  type Plan,
  type SimContext,
  type StrategyOption,
  type TyreModel,
} from '../../model/strategy';
import { LineChart, type LineSeries } from '../../components/charts/LineChart';
import { Empty, ErrorNotice, Lights, Notice, Panel, Stat, TyreBadge } from '../../components/ui';
import { Term, RookieNote } from '../../components/Term';
import { carDirectory, compoundColour, type CarInfo } from './raceContext';

interface Props {
  season: Season;
  event: RaceEvent;
  bundle: Resource<RaceBundle>;
}

export default function StrategyLab({ season, event, bundle }: Props) {
  if (bundle.error) return <ErrorNotice error={bundle.error} onRetry={bundle.reload} what="lap timing" />;
  if (bundle.loading || !bundle.data) return <Lights label="Downloading lap timing" />;
  if (!bundle.data.laps.length) return <Empty>OpenF1 has no lap timing for this race yet.</Empty>;
  return <Lab season={season} event={event} data={bundle.data} />;
}

function secs(ms: number, digits = 1): string {
  const v = ms / 1000;
  const s = Math.abs(v).toFixed(digits);
  return v > 0 ? `+${s}s` : v < 0 ? `−${s}s` : `${s}s`;
}

function Lab({ season, event, data }: { season: Season; event: RaceEvent; data: RaceBundle }) {
  const { colour } = useTeams();
  const { resolvedTheme } = useSettings();
  const route = useRoute();
  const results = season.results[event.round] ?? [];
  const timing = useMemo(() => buildRaceTiming(data.laps, data.pits, data.raceControl, data.result), [data]);
  const cars = useMemo(() => carDirectory(data.drivers, results, season, colour, SURFACE[resolvedTheme]), [data, results, season, colour, resolvedTheme]);
  const model = useMemo(() => fitTyreModel(timing, data.stints), [timing, data.stints]);
  const pitLossMs = useMemo(() => estimatePitLoss(timing, data.pits), [timing, data.pits]);

  // Candidates: cars that ran the full distance on the lead lap, in finishing order.
  const candidates = useMemo(() => {
    const order = [...results].sort((a, b) => a.order - b.order).map((r) => r.carNumber).filter((n): n is number => n !== null);
    const full = (d: number) => (timing.lapsCompleted.get(d) ?? 0) === timing.totalLaps;
    const list = order.filter((d) => full(d) && data.stints.some((s) => s.driverNumber === d));
    return list.length ? list : timing.drivers.filter(full);
  }, [results, timing, data.stints]);

  const requested = Number(route.query.get('d'));
  const driver = candidates.includes(requested) ? requested : candidates[0] ?? null;

  if (isWetRace(data.stints)) {
    return (
      <Notice>
        This race used <Term id="intermediate">intermediate</Term> or <Term id="wet">wet</Term> tyres. The Strategy Lab's tyre model only handles dry races, where
        lap time follows tyre age predictably; in changing conditions the right call depends on the weather, not the tyres.
      </Notice>
    );
  }
  if (!model) return <Notice>Not enough clean laps in this race to fit a tyre model — the Strategy Lab needs at least a few dozen green-flag laps.</Notice>;
  if (driver === null) return <Empty>No car ran the full distance with tyre data, so there is nothing to re-plan.</Empty>;

  return (
    <div className="stack" style={{ gap: 18 }}>
      <RookieNote>
        Pick a driver, then drag the pit stops on their tyre bar or click a stint to change its <Term id="compound">compound</Term>. The lab re-runs their race
        with your plan and shows where they would have finished. It is the <Term id="undercut">undercut</Term> question — "what if we had stopped earlier?" —
        answered with this race's own numbers.
      </RookieNote>
      <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} role="group" aria-label="Choose a driver">
        {candidates.map((d) => {
          const car = cars.get(d);
          return (
            <button key={d} type="button" className="pick-chip" aria-pressed={d === driver} onClick={() => setQuery({ d: String(d) })}>
              <span className="bar" style={{ background: car?.colour ?? '#888' }} />
              {car?.code ?? d}
            </button>
          );
        })}
      </div>
      <DriverLab key={`${data.sessionKey}:${driver}`} driver={driver} car={cars.get(driver)} timing={timing} model={model} data={data} pitLossMs={pitLossMs} />
      <TyrePanel model={model} pitLossMs={pitLossMs} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DriverLab({ driver, car, timing, model, data, pitLossMs }: { driver: number; car: CarInfo | undefined; timing: RaceTiming; model: TyreModel; data: RaceBundle; pitLossMs: number }) {
  const totalLaps = timing.lapsCompleted.get(driver) ?? timing.totalLaps;
  const ctx: SimContext = useMemo(() => ({ model, timing, driver, totalLaps, pitLossMs }), [model, timing, driver, totalLaps, pitLossMs]);
  const actual = useMemo(() => planFromStints(data.stints, driver, totalLaps), [data.stints, driver, totalLaps]);
  const [plan, setPlan] = useState<Plan>(actual);
  const refSim = useMemo(() => simulatePlan(ctx, actual), [ctx, actual]);
  const sim = useMemo(() => simulatePlan(ctx, plan), [ctx, plan]);
  const delta = sim.totalMs - refSim.totalMs;
  const where = positionWithDelta(timing, driver, delta);
  const search = useComputed(`strategy:v1:${data.sessionKey}:${driver}:${Math.round(pitLossMs)}`, () => searchStrategies(ctx, actual));
  const realStops = stopsOf(data.pits, driver);
  const changed = JSON.stringify(plan) !== JSON.stringify(actual);
  const compounds = useMemo(() => {
    const raced = new Set<Compound>(model.compounds);
    for (const s of actual.stints) if (s.compound !== 'UNKNOWN') raced.add(s.compound);
    return (['SOFT', 'MEDIUM', 'HARD'] as Compound[]).filter((c) => raced.has(c));
  }, [model, actual]);

  // Green-flag laps only: safety-car laps (shaded) and the opening lap would flatten the scale.
  const lapSeries: LineSeries[] = useMemo(() => {
    const real = timing.lapMs.get(driver);
    const inOut = new Set([...(timing.inLaps.get(driver) ?? []), ...(timing.outLaps.get(driver) ?? [])]);
    const green = (L: number) => L > 1 && !timing.neutralLaps.has(L);
    const xs = Array.from({ length: totalLaps }, (_, i) => i + 1);
    const fromSim = (lapMs: number[]) => xs.map((L) => (green(L) && lapMs[L - 1] !== undefined ? lapMs[L - 1]! / 1000 : null));
    return [
      {
        id: 'real',
        label: 'Real laps',
        colour: 'var(--ink-3)',
        emphasis: true,
        values: xs.map((L) => {
          const v = real?.[L];
          return v === undefined || Number.isNaN(v) || !green(L) || inOut.has(L) ? null : v / 1000;
        }),
      },
      { id: 'model', label: 'Model, real plan', colour: 'var(--series-1)', emphasis: true, dashed: true, values: fromSim(refSim.lapMs) },
      { id: 'plan', label: 'Your plan', colour: 'var(--accent)', emphasis: true, values: fromSim(sim.lapMs) },
    ];
  }, [timing, driver, totalLaps, refSim, sim]);
  const yDomain = useMemo<[number, number]>(() => {
    const vals = lapSeries.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
    if (!vals.length) return [80, 100];
    const sorted = [...vals].sort((a, b) => a - b);
    const lo = sorted[Math.floor(sorted.length * 0.01)]!;
    const hi = sorted[Math.floor(sorted.length * 0.99)]!;
    const pad = Math.max(0.3, (hi - lo) * 0.15);
    return [Math.floor((lo - pad) * 2) / 2, Math.ceil((hi + pad) * 2) / 2];
  }, [lapSeries]);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Panel
        title={`${car?.name ?? `Car ${driver}`}: your strategy`}
        sub={`Real race: ${actual.stints.map((s) => s.compound[0]).join('–')}, ${realStops.length} ${realStops.length === 1 ? 'stop' : 'stops'}${realStops.length ? ` (lap ${realStops.map((s) => s.lap).join(', ')})` : ''}`}
        actions={
          changed ? (
            <button className="btn btn-sm" onClick={() => setPlan(actual)}>
              Reset to real
            </button>
          ) : null
        }
      >
        <div className="stack" style={{ gap: 16 }}>
          <PlanEditor plan={plan} totalLaps={totalLaps} compounds={compounds} onChange={setPlan} neutralLaps={timing.neutralLaps} />
          <div className="stats">
            <Stat
              label="Versus the real strategy"
              value={<span className={`big-delta ${delta < -50 ? 'delta-up' : delta > 50 ? 'delta-down' : ''}`}>{changed ? secs(delta) : '±0.0s'}</span>}
              note={changed ? (delta < 0 ? 'faster over the race distance' : 'slower over the race distance') : 'Edit the plan to compare'}
            />
            <Stat
              label="Would have finished"
              value={where.position !== null ? ordinal(where.position) : '–'}
              note={where.actual !== null ? `Actually ${ordinal(where.actual)} on the road${where.position !== null && where.position !== where.actual ? ` · ${where.position < where.actual ? 'gains' : 'loses'} ${Math.abs(where.actual - where.position)}` : ''}` : 'Not on the lead lap'}
            />
            <Stat label={<Term id="pit-loss">Pit loss here</Term>} value={secs(pitLossMs).replace('+', '')} note="Measured from this race's in- and out-laps" />
            <Stat label="Stops" value={String(plan.stints.length - 1)} note={plan.stints.map((s) => `${s.compound[0]}${s.laps}`).join(' · ')} />
          </div>
          {!sim.valid ? (
            <div className="notice notice-warn" role="status">
              <span className="icon" aria-hidden="true">
                ▲
              </span>
              <div>
                <strong>Not a legal or realistic plan:</strong> {sim.issues.join(' ')}
              </div>
            </div>
          ) : null}
        </div>
      </Panel>

      <div className="grid">
        <Panel className="span-6" title="The best plans the model can find" sub="One- and two-stop plans with new tyres at each stop, compared with the real race" flush>
          {search.computing || !search.value ? (
            <Lights label="Trying every one- and two-stop plan" />
          ) : (
            <BestPlans options={search.value.best} timing={timing} driver={driver} onTry={setPlan} />
          )}
        </Panel>
        <Panel className="span-6" title="When should they have stopped?" sub={actual.stints.length >= 2 ? `One stop, ${actual.stints[0]!.compound.toLowerCase()} to ${actual.stints[1]!.compound.toLowerCase()}: race time by stop lap` : 'Needs a real race with at least one stop'}>
          {search.computing || !search.value ? (
            <Lights label="Sweeping the pit window" />
          ) : search.value.oneStopCurve.length < 3 ? (
            <Empty>The real compound pair does not allow a one-stop comparison.</Empty>
          ) : (
            <PitWindowChart curve={search.value.oneStopCurve} realStop={realStops[0]?.lap ?? null} />
          )}
        </Panel>
      </div>

      <Panel title="Lap by lap" sub="Green-flag lap times: the real ones, the model's version of the real plan, and yours. Pit stops and safety-car laps are left out.">
        <LineChart
          x={Array.from({ length: totalLaps }, (_, i) => i + 1)}
          series={lapSeries}
          height={300}
          yDomain={yDomain}
          yFormat={(v) => `${v}s`}
          xLabel="Lap"
          tooltipTitle={(l) => `Lap ${l}`}
          tooltipFormat={(v) => lapTime(v * 1000)}
          ariaLabel="Lap times: real, modelled real plan, and your plan"
          endLabels={false}
          bands={[...timing.neutralLaps].sort((a, b) => a - b).map((L) => ({ from: L - 0.5, to: L + 0.5, tone: 'neutral' as const }))}
        />
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanEditor({ plan, totalLaps, compounds, onChange, neutralLaps }: { plan: Plan; totalLaps: number; compounds: Compound[]; onChange: (p: Plan) => void; neutralLaps: Set<number> }) {
  const barRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const stops: number[] = [];
  let acc = 0;
  for (const s of plan.stints.slice(0, -1)) stops.push((acc += s.laps));

  const setStop = (i: number, lap: number) => {
    const lo = (i === 0 ? 0 : stops[i - 1]!) + 1;
    const hi = (i === stops.length - 1 ? totalLaps : stops[i + 1]!) - 1;
    const v = Math.max(lo, Math.min(hi, Math.round(lap)));
    if (v === stops[i]) return;
    const next = [...stops];
    next[i] = v;
    const bounds = [0, ...next, totalLaps];
    onChange({ stints: plan.stints.map((s, k) => ({ ...s, laps: bounds[k + 1]! - bounds[k]! })) });
  };
  const lapFromPointer = (e: ReactPointerEvent) => {
    const r = barRef.current!.getBoundingClientRect();
    return ((e.clientX - r.left) / r.width) * totalLaps;
  };
  const cycle = (k: number) => {
    const order = compounds.length ? compounds : (['SOFT', 'MEDIUM', 'HARD'] as Compound[]);
    const cur = order.indexOf(plan.stints[k]!.compound);
    const compound = order[(cur + 1) % order.length]!;
    onChange({ stints: plan.stints.map((s, i) => (i === k ? { ...s, compound } : s)) });
  };
  const addStop = () => {
    // Split the longest stint in two, fitting a different compound for the second half.
    let k = 0;
    plan.stints.forEach((s, i) => {
      if (s.laps > plan.stints[k]!.laps) k = i;
    });
    const s = plan.stints[k]!;
    if (s.laps < 4) return;
    const first = Math.floor(s.laps / 2);
    const order = compounds.length ? compounds : (['MEDIUM', 'HARD'] as Compound[]);
    const other = order.find((c) => c !== s.compound) ?? s.compound;
    const stints = [...plan.stints.slice(0, k), { ...s, laps: first }, { compound: other, laps: s.laps - first, ageAtStart: 0 }, ...plan.stints.slice(k + 1)];
    onChange({ stints });
  };
  const removeStop = () => {
    if (plan.stints.length < 2) return;
    const a = plan.stints[plan.stints.length - 2]!;
    const b = plan.stints[plan.stints.length - 1]!;
    onChange({ stints: [...plan.stints.slice(0, -2), { ...a, laps: a.laps + b.laps }] });
  };
  const onHandleKey = (i: number) => (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setStop(i, stops[i]! - (e.shiftKey ? 5 : 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setStop(i, stops[i]! + (e.shiftKey ? 5 : 1));
    }
  };

  let start = 0;
  return (
    <div className="plan-editor">
      <div
        className="plan-bar"
        ref={barRef}
        onPointerMove={(e) => {
          if (drag !== null) setStop(drag, lapFromPointer(e));
        }}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
      >
        {[...neutralLaps]
          .filter((L) => L <= totalLaps)
          .map((L) => (
            <span key={`n${L}`} className="plan-neutral" style={{ left: `${((L - 1) / totalLaps) * 100}%`, width: `${100 / totalLaps}%` }} aria-hidden="true" />
          ))}
        {plan.stints.map((s, k) => {
          const left = (start / totalLaps) * 100;
          const width = (s.laps / totalLaps) * 100;
          start += s.laps;
          return (
            <button
              key={k}
              type="button"
              className="plan-seg"
              style={{ left: `${left}%`, width: `${width}%`, background: compoundColour(s.compound), color: '#111' }}
              onClick={() => cycle(k)}
              title={`Stint ${k + 1}: ${s.laps} laps on ${s.compound.toLowerCase()}${s.ageAtStart ? ` (used set, ${s.ageAtStart} laps old)` : ''}. Click to change compound.`}
              aria-label={`Stint ${k + 1}, ${s.compound.toLowerCase()}, ${s.laps} laps. Click to change compound.`}
            >
              {width > 7 ? `${s.compound[0]} · ${s.laps}` : s.compound[0]}
            </button>
          );
        })}
        {stops.map((lap, i) => (
          <button
            key={`h${i}`}
            type="button"
            className="plan-handle"
            style={{ left: `${(lap / totalLaps) * 100}%` }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget.parentElement as HTMLElement).setPointerCapture(e.pointerId);
              setDrag(i);
            }}
            onKeyDown={onHandleKey(i)}
            aria-label={`Pit stop ${i + 1} at the end of lap ${lap}. Use arrow keys to move it.`}
            title={`Box at the end of lap ${lap}`}
          />
        ))}
      </div>
      <div className="row spread" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="plan-stints">
          {plan.stints.map((s, k) => (
            <span key={k} className="plan-stint">
              <TyreBadge compound={s.compound} />
              {s.laps} laps
            </span>
          ))}
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={addStop} disabled={plan.stints.length >= 4}>
            + Stop
          </button>
          <button className="btn btn-sm" onClick={removeStop} disabled={plan.stints.length < 2}>
            − Stop
          </button>
        </div>
      </div>
      <div className="faint" style={{ fontSize: 'var(--step--2)' }}>
        Drag a white marker (or focus it and use the arrow keys) to move a stop. Shaded laps were under the safety car, where a stop costs about half as much.
      </div>
    </div>
  );
}

function BestPlans({ options, timing, driver, onTry }: { options: StrategyOption[]; timing: RaceTiming; driver: number; onTry: (p: Plan) => void }) {
  if (!options.length) return <Empty>No valid alternative plans for this car.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Best strategies found</caption>
        <thead>
          <tr>
            <th scope="col">Plan</th>
            <th scope="col" className="r">
              vs real
            </th>
            <th scope="col" className="r">
              Finish
            </th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {options.map((o) => {
            const pos = positionWithDelta(timing, driver, o.deltaMs);
            return (
              <tr key={o.label}>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {o.plan.stints.map((s, i) => (
                      <TyreBadge key={i} compound={s.compound} />
                    ))}
                    <span className="faint" style={{ fontSize: 'var(--step--1)', marginLeft: 6 }}>
                      {o.label.replace(/^\d-stop [SMH–]+ · /, '')}
                    </span>
                  </div>
                </td>
                <td className={`r num ${o.deltaMs < -50 ? 'delta-up' : o.deltaMs > 50 ? 'delta-down' : ''}`}>{secs(o.deltaMs)}</td>
                <td className="r num">{pos.position !== null ? `P${pos.position}` : '–'}</td>
                <td className="r">
                  <button className="btn btn-sm btn-ghost" onClick={() => onTry(o.plan)}>
                    Try
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PitWindowChart({ curve, realStop }: { curve: { lap: number; deltaMs: number }[]; realStop: number | null }) {
  const best = curve.reduce((m, c) => (c.deltaMs < m.deltaMs ? c : m), curve[0]!);
  const x = curve.map((c) => c.lap);
  const series: LineSeries[] = [{ id: 'delta', label: 'vs real', colour: 'var(--accent)', emphasis: true, values: curve.map((c) => c.deltaMs / 1000) }];
  const markers = [{ x: best.lap, label: `Best: lap ${best.lap}` }];
  if (realStop !== null && realStop !== best.lap && realStop >= x[0]! && realStop <= x[x.length - 1]!) markers.push({ x: realStop, label: `Real: lap ${realStop}` });
  return (
    <div className="stack" style={{ gap: 8 }}>
      <LineChart
        x={x}
        series={series}
        height={260}
        yFormat={(v) => `${v > 0 ? '+' : ''}${v}s`}
        xLabel="Stop at the end of lap"
        tooltipTitle={(l) => `Stop on lap ${l}`}
        tooltipFormat={(v) => secs(v * 1000)}
        markers={markers}
        endLabels={false}
        legend={false}
        ariaLabel="Race time versus the real strategy for each possible one-stop lap"
      />
      <p className="faint" style={{ fontSize: 'var(--step--1)' }}>
        Below zero is faster than what really happened. The best one-stop lap here was {best.lap}, {secs(best.deltaMs)} against the real race.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TyrePanel({ model, pitLossMs }: { model: TyreModel; pitLossMs: number }) {
  const maxAge = Math.max(10, ...model.compounds.map((c) => model.maxStint[c] ?? 0));
  const ages = Array.from({ length: maxAge + 1 }, (_, i) => i);
  const series: LineSeries[] = model.compounds.map((c) => ({
    id: c,
    label: c[0] + c.slice(1).toLowerCase(),
    colour: compoundColour(c),
    emphasis: true,
    values: ages.map((a) => (a <= (model.maxStint[c] ?? maxAge) ? ((model.offset[c] ?? 0) + (model.deg[c] ?? 0) * a) / 1000 : null)),
  }));
  // Laps for a softer compound to repay its extra stop: offset difference vs degradation.
  return (
    <Panel title="What the tyres did at this race" sub={`Fitted to ${model.laps.toLocaleString()} clean green-flag laps · typical lap-to-lap noise ±${(model.residualSd / 1000).toFixed(2)}s`}>
      <RookieNote>
        Each line is how much slower a set of tyres gets as it ages (<Term id="degradation">degradation</Term>), relative to a brand-new {model.reference.toLowerCase()}.
        Softer tyres start faster but fade quicker — the whole strategy game is in where those lines cross.
      </RookieNote>
      <div className="grid">
        <div className="span-7">
          <LineChart
            x={ages}
            series={series}
            height={260}
            yFormat={(v) => `${v > 0 ? '+' : ''}${v}s`}
            xLabel="Tyre age (laps)"
            tooltipTitle={(a) => `${a} laps old`}
            tooltipFormat={(v) => secs(v * 1000, 2)}
            tooltipAscending
            ariaLabel="Lap-time penalty by tyre age for each compound"
          />
        </div>
        <div className="span-5">
          <div className="table-wrap">
            <table className="data-table">
              <caption className="sr-only">Tyre model coefficients</caption>
              <thead>
                <tr>
                  <th scope="col">Compound</th>
                  <th scope="col" className="r">
                    Pace
                  </th>
                  <th scope="col" className="r">
                    Wear / lap
                  </th>
                  <th scope="col" className="r">
                    Longest run
                  </th>
                </tr>
              </thead>
              <tbody>
                {model.compounds.map((c) => (
                  <tr key={c}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <TyreBadge compound={c} />
                        {c[0] + c.slice(1).toLowerCase()}
                      </span>
                    </td>
                    <td className="r num">{c === model.reference ? 'reference' : secs(model.offset[c] ?? 0, 2)}</td>
                    <td className="r num">{secs(model.deg[c] ?? 0, 3)}</td>
                    <td className="r num">{model.maxStint[c] ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="faint" style={{ fontSize: 'var(--step--1)', marginTop: 10 }}>
            Track and fuel: {secs(model.fuelPerLap, 3)} per lap as the car lightens and the track rubbers in. A stop costs about {(pitLossMs / 1000).toFixed(1)}s.
            Not modelled: traffic, other cars reacting, or a tyre falling off a cliff — so stints are capped just past the longest anyone ran here.
          </p>
        </div>
      </div>
    </Panel>
  );
}
