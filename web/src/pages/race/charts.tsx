/** Race-specific charts: swing chart, race trace, positions, tyre strategy, pit stops. */

import { useMemo, useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { LineChart, type Band, type LineSeries } from '../../components/charts/LineChart';
import { useWidth } from '../../app/data';
import { pct } from '../../lib/format';
import type { PitStop, Stint } from '../../data/types';
import { gapsAtLap, orderAtLap, type NeutralPeriod, type RaceTiming } from '../../model/raceTiming';
import type { InRaceOutput } from '../../model/inrace';
import { compoundColour, type CarInfo } from './raceContext';

export function neutralBands(periods: NeutralPeriod[]): Band[] {
  return periods.map((p) => ({ from: p.startLap - 0.5, to: p.endLap + 0.5, label: p.kind, tone: p.kind === 'RED' ? 'red' : 'neutral' }));
}

export function SwingChart({ swing, cars, timing }: { swing: InRaceOutput; cars: Map<number, CarInfo>; timing: RaceTiming }) {
  const series: LineSeries[] = useMemo(() => {
    const out: LineSeries[] = [];
    for (const [num, values] of swing.pWin) {
      const peak = Math.max(...values);
      const car = cars.get(num);
      out.push({
        id: String(num),
        label: car?.code ?? String(num),
        colour: car?.colour ?? '#888',
        values: values.map((v) => v * 100),
        emphasis: peak >= 0.12 || num === swing.winner,
      });
    }
    // Keep the chart readable: at most six emphasised lines, by peak probability.
    const emph = out.filter((s) => s.emphasis).sort((a, b) => Math.max(...b.values.map((v) => v ?? 0)) - Math.max(...a.values.map((v) => v ?? 0)));
    emph.slice(6).forEach((s) => (s.emphasis = String(swing.winner) === s.id));
    // Teammates share a colour: dash the second one.
    const seen = new Set<string>();
    for (const s of out.filter((x) => x.emphasis)) {
      if (seen.has(s.colour)) s.dashed = true;
      seen.add(s.colour);
    }
    return out;
  }, [swing, cars]);
  const markers = swing.decisiveLap !== null ? [{ x: swing.decisiveLap, label: `Lap ${swing.decisiveLap}: the swing` }] : [];
  return (
    <LineChart
      x={swing.laps}
      series={series}
      height={320}
      yDomain={[0, 100]}
      yTicks={[0, 25, 50, 75, 100]}
      yFormat={(v) => `${v}%`}
      xFormat={(v) => String(v)}
      xLabel="Lap"
      tooltipTitle={(l) => (l === 0 ? 'Before the start' : `End of lap ${l}`)}
      tooltipFormat={(v) => pct(v / 100)}
      bands={neutralBands(timing.neutral)}
      markers={markers}
      markerLabels="top"
      ariaLabel="Win probability for each driver at the end of every lap"
    />
  );
}

export function RaceTraceChart({ timing, cars, finishOrder }: { timing: RaceTiming; cars: Map<number, CarInfo>; finishOrder: number[] }) {
  const [cap, setCap] = useState(60);
  const laps = useMemo(() => Array.from({ length: timing.totalLaps }, (_, i) => i + 1), [timing]);
  const series: LineSeries[] = useMemo(() => {
    const gaps = laps.map((L) => gapsAtLap(timing, L));
    const top = new Set(finishOrder.slice(0, 5));
    const seen = new Set<string>();
    return timing.drivers.map((d) => {
      const car = cars.get(d);
      const emphasis = top.has(d);
      const colour = car?.colour ?? '#888';
      const dashed = emphasis && seen.has(colour);
      if (emphasis) seen.add(colour);
      return {
        id: String(d),
        label: car?.code ?? String(d),
        colour,
        emphasis,
        dashed,
        values: gaps.map((g) => {
          const v = g.get(d);
          return v === undefined ? null : v / 1000;
        }),
      };
    });
  }, [laps, timing, cars, finishOrder]);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <label className="faint" style={{ fontSize: 'var(--step--1)' }}>
          Show gaps up to{' '}
          <select className="select" value={cap} onChange={(e) => setCap(Number(e.target.value))} aria-label="Maximum gap shown">
            <option value={15}>15 s</option>
            <option value={30}>30 s</option>
            <option value={60}>60 s</option>
            <option value={120}>2 min</option>
          </select>
        </label>
      </div>
      <LineChart
        x={laps}
        series={series}
        height={340}
        yDomain={[0, cap]}
        yInvert
        yFormat={(v) => (v === 0 ? 'Leader' : `+${v}s`)}
        xLabel="Lap"
        tooltipTitle={(l) => `Lap ${l} · gap to leader`}
        tooltipFormat={(v) => (v === 0 ? 'Leader' : `+${v.toFixed(1)}s`)}
        tooltipAscending
        bands={neutralBands(timing.neutral)}
        ariaLabel="Gap to the race leader for each driver on every lap"
        maxTooltipRows={10}
      />
    </div>
  );
}

export function PositionChart({ timing, cars, finishOrder, gridOrder }: { timing: RaceTiming; cars: Map<number, CarInfo>; finishOrder: number[]; gridOrder: number[] }) {
  const laps = useMemo(() => Array.from({ length: timing.totalLaps + 1 }, (_, i) => i), [timing]);
  const series: LineSeries[] = useMemo(() => {
    const orders = laps.map((L) => (L === 0 ? gridOrder : orderAtLap(timing, L)));
    const top = new Set(finishOrder.slice(0, 5));
    const seen = new Set<string>();
    return timing.drivers.map((d) => {
      const car = cars.get(d);
      const colour = car?.colour ?? '#888';
      const emphasis = top.has(d);
      const dashed = emphasis && seen.has(colour);
      if (emphasis) seen.add(colour);
      return {
        id: String(d),
        label: car?.code ?? String(d),
        colour,
        emphasis,
        dashed,
        values: orders.map((o) => {
          const i = o.indexOf(d);
          return i < 0 ? null : i + 1;
        }),
      };
    });
  }, [laps, timing, cars, finishOrder, gridOrder]);
  const n = timing.drivers.length;
  return (
    <LineChart
      x={laps}
      series={series}
      height={360}
      yDomain={[1, n]}
      yInvert
      yTicks={[1, 5, 10, 15, 20].filter((t) => t <= n)}
      yFormat={(v) => `P${v}`}
      xFormat={(v) => (v === 0 ? 'Grid' : String(v))}
      xLabel="Lap"
      tooltipTitle={(l) => (l === 0 ? 'Starting grid' : `Lap ${l}`)}
      tooltipFormat={(v) => `P${v}`}
      tooltipAscending
      bands={neutralBands(timing.neutral)}
      ariaLabel="Running position of each driver on every lap"
      maxTooltipRows={10}
    />
  );
}

export function StintChart({ stints, pits, cars, order, totalLaps }: { stints: Stint[]; pits: PitStop[]; cars: Map<number, CarInfo>; order: number[]; totalLaps: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null);
  const rowH = 20;
  const gap = 6;
  const left = 54;
  const right = 12;
  const w = Math.max(320, width);
  const xs = scaleLinear().domain([0, totalLaps]).range([left, w - right]);
  const rows = order.filter((d) => stints.some((s) => s.driverNumber === d));
  const height = rows.length * (rowH + gap) + 26;
  const ticks = xs.ticks(Math.min(10, Math.floor((w - left) / 60))).filter(Number.isInteger);
  return (
    <div className="chart stints" ref={ref}>
      <svg width={w} height={height} role="img" aria-label="Tyre strategy: stints and compounds for each driver">
        {ticks.map((t) => (
          <g key={t}>
            <line className="gridline" x1={xs(t)} x2={xs(t)} y1={0} y2={height - 22} />
            <text className="tick-label" x={xs(t)} y={height - 6} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        {rows.map((d, i) => {
          const y = i * (rowH + gap);
          const car = cars.get(d);
          const mine = stints.filter((s) => s.driverNumber === d).sort((a, b) => a.lapStart - b.lapStart);
          return (
            <g key={d}>
              <rect x={left - 46} y={y + 4} width={4} height={rowH - 8} rx={2} fill={car?.colour ?? '#888'} />
              <text className="row-label" x={left - 38} y={y + rowH / 2} dy="0.35em">
                {car?.code ?? d}
              </text>
              {mine.map((s) => {
                const x0 = xs(s.lapStart - 1);
                const x1 = xs(Math.min(totalLaps, s.lapEnd));
                const laps = s.lapEnd - s.lapStart + 1;
                const text = `${car?.code ?? d} · ${s.compound.toLowerCase()} · laps ${s.lapStart}–${s.lapEnd} (${laps})${s.tyreAgeAtStart > 0 ? ` · used set, ${s.tyreAgeAtStart} laps old` : ' · new set'}`;
                return (
                  <g key={s.stint}>
                    <rect
                      x={x0 + 1}
                      y={y}
                      width={Math.max(2, x1 - x0 - 2)}
                      height={rowH}
                      rx={3}
                      fill={compoundColour(s.compound)}
                      opacity={0.92}
                      onPointerMove={(e) => {
                        const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                        setHover({ x: e.clientX - r.left, y: e.clientY - r.top, text });
                      }}
                      onPointerLeave={() => setHover(null)}
                    >
                      <title>{text}</title>
                    </rect>
                    {x1 - x0 > 26 ? (
                      <text x={(x0 + x1) / 2} y={y + rowH / 2} dy="0.35em" textAnchor="middle" style={{ fill: '#111', fontSize: 10.5, fontWeight: 700, fontFamily: 'var(--font-mono)', pointerEvents: 'none' }}>
                        {laps}
                      </text>
                    ) : null}
                  </g>
                );
              })}
              {pits
                .filter((p) => p.driverNumber === d)
                .map((p, k) => (
                  <line key={k} x1={xs(p.lap)} x2={xs(p.lap)} y1={y - 2} y2={y + rowH + 2} stroke="var(--ink)" strokeWidth={1.5} opacity={0.8} />
                ))}
            </g>
          );
        })}
      </svg>
      {hover ? (
        <div className="tooltip" style={{ left: Math.min(hover.x + 12, w - 290), top: hover.y + 12 }}>
          {hover.text}
        </div>
      ) : null}
      <div className="legend" style={{ padding: '8px 0 0' }}>
        {['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'].map((c) => (
          <span key={c} className="legend-item" style={{ cursor: 'default' }}>
            <span className="legend-swatch" style={{ background: compoundColour(c) }} />
            {c[0] + c.slice(1).toLowerCase()}
          </span>
        ))}
        <span className="legend-item" style={{ cursor: 'default' }}>
          <span className="legend-key" style={{ background: 'var(--ink)', width: 2, height: 12 }} />
          Pit stop · numbers are laps per stint
        </span>
      </div>
    </div>
  );
}
