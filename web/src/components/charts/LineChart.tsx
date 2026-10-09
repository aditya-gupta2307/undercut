/**
 * The workhorse chart: many series over a shared x axis.
 *
 * Emphasis first — with twenty-two drivers on screen, colour cannot carry
 * identity alone, so a few series are emphasised (team colour, 2px, labelled
 * at the line end) and the rest recede to thin grey context. Hovering a line
 * or a legend entry spotlights it; the crosshair tooltip lists values at the
 * nearest x. Bands mark safety-car periods and other events.
 */

import { useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { scaleLinear } from 'd3-scale';
import { line as d3line, curveMonotoneX, curveLinear } from 'd3-shape';
import { useWidth } from '../../app/data';

export interface LineSeries {
  id: string;
  label: string;
  colour: string;
  values: (number | null)[];
  emphasis?: boolean;
  dashed?: boolean;
}

export interface Band {
  from: number;
  to: number;
  label?: string;
  tone?: 'neutral' | 'red';
}

export interface Marker {
  x: number;
  label: string;
}

interface LineChartProps {
  x: number[];
  series: LineSeries[];
  height?: number;
  yDomain?: [number, number];
  yInvert?: boolean;
  yTicks?: number[];
  yFormat?: (v: number) => string;
  xFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  bands?: Band[];
  markers?: Marker[];
  /** Where marker labels sit: along the bottom (default) or the top of the plot. */
  markerLabels?: 'top' | 'bottom';
  endLabels?: boolean;
  tooltipFormat?: (v: number) => string;
  tooltipTitle?: (x: number) => string;
  /** Sort tooltip rows ascending (gaps, positions) instead of descending (probabilities). */
  tooltipAscending?: boolean;
  smooth?: boolean;
  step?: boolean;
  ariaLabel: string;
  legend?: boolean;
  maxTooltipRows?: number;
  footnote?: ReactNode;
}

const M = { top: 14, right: 58, bottom: 30, left: 46 };

export function LineChart(props: LineChartProps) {
  const {
    x,
    series,
    height = 300,
    yInvert = false,
    yFormat = (v) => String(v),
    xFormat = (v) => String(v),
    bands = [],
    markers = [],
    markerLabels = 'bottom',
    endLabels = true,
    tooltipFormat = yFormat,
    tooltipTitle = (v) => xFormat(v),
    tooltipAscending = false,
    smooth = false,
    ariaLabel,
    legend = true,
    maxTooltipRows = 8,
  } = props;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [spot, setSpot] = useState<string | null>(null);

  const yDomain = useMemo<[number, number]>(() => {
    if (props.yDomain) return props.yDomain;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (const s of series) for (const v of s.values) if (v !== null && Number.isFinite(v)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    if (!Number.isFinite(lo)) return [0, 1];
    if (lo === hi) return [lo - 1, hi + 1];
    return [lo, hi];
  }, [props.yDomain, series]);

  const w = Math.max(280, width);
  const innerW = w - M.left - M.right;
  const innerH = height - M.top - M.bottom;
  const xs = scaleLinear().domain([x[0] ?? 0, x[x.length - 1] ?? 1]).range([0, innerW]);
  const ys = scaleLinear().domain(yDomain).range(yInvert ? [0, innerH] : [innerH, 0]);
  const clampY = (v: number) => Math.max(Math.min(yDomain[0], yDomain[1]), Math.min(Math.max(yDomain[0], yDomain[1]), v));

  const yTicks = props.yTicks ?? ys.ticks(5);
  const xTicks = xs.ticks(Math.max(3, Math.min(12, Math.floor(innerW / 70)))).filter((t) => Number.isInteger(t));

  const gen = d3line<number | null>()
    .defined((v) => v !== null && Number.isFinite(v))
    .x((_, i) => xs(x[i]!))
    .y((v) => ys(clampY(v!)))
    .curve(smooth ? curveMonotoneX : curveLinear);

  const ordered = [...series].sort((a, b) => Number(Boolean(a.emphasis)) - Number(Boolean(b.emphasis)));
  const anyEmph = series.some((s) => s.emphasis);

  // End labels with collision avoidance (leader lines when displaced).
  const labels = (() => {
    if (!endLabels) return [];
    const items: { id: string; text: string; y: number; ty: number; x: number; colour: string }[] = [];
    for (const s of series) {
      if (anyEmph && !s.emphasis) continue;
      let last = -1;
      for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null && Number.isFinite(s.values[i]!)) {
        last = i;
        break;
      }
      if (last < 0) continue;
      const y = ys(clampY(s.values[last]!));
      items.push({ id: s.id, text: s.label, y, ty: y, x: xs(x[last]!), colour: s.colour });
    }
    items.sort((a, b) => a.y - b.y);
    const gap = 13;
    for (let i = 1; i < items.length; i++) if (items[i]!.ty - items[i - 1]!.ty < gap) items[i]!.ty = items[i - 1]!.ty + gap;
    const overflow = items.length ? items[items.length - 1]!.ty - innerH : 0;
    if (overflow > 0) for (const it of items) it.ty -= overflow;
    for (let i = items.length - 2; i >= 0; i--) if (items[i + 1]!.ty - items[i]!.ty < gap) items[i]!.ty = items[i + 1]!.ty - gap;
    return items;
  })();

  const onMove = (e: ReactPointerEvent<SVGRectElement>) => {
    const r = (e.currentTarget as SVGRectElement).getBoundingClientRect();
    const px = e.clientX - r.left;
    const xv = xs.invert(px);
    let best = 0;
    let bd = Number.POSITIVE_INFINITY;
    for (let i = 0; i < x.length; i++) {
      const d = Math.abs(x[i]! - xv);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    setHoverIdx(best);
  };

  const hoverRows =
    hoverIdx !== null
      ? series
          .map((s) => ({ s, v: s.values[hoverIdx] ?? null }))
          .filter((r) => r.v !== null && Number.isFinite(r.v))
          .sort((a, b) => {
            if (spot) {
              if (a.s.id === spot) return -1;
              if (b.s.id === spot) return 1;
            }
            return tooltipAscending ? a.v! - b.v! : b.v! - a.v!;
          })
          .slice(0, maxTooltipRows)
      : [];

  const tipLeft = hoverIdx !== null ? M.left + xs(x[hoverIdx]!) : 0;
  const tipOnLeft = tipLeft > w * 0.6;

  return (
    <div className="chart" ref={ref}>
      <svg width={w} height={height} role="img" aria-label={ariaLabel}>
        <g transform={`translate(${M.left},${M.top})`}>
          {bands.map((b, i) => {
            const x0 = xs(b.from) - (b.from === b.to ? 3 : 0);
            const x1 = xs(b.to) + (b.from === b.to ? 3 : 0);
            return (
              <g key={i}>
                <rect x={x0} y={0} width={Math.max(2, x1 - x0)} height={innerH} fill={b.tone === 'red' ? 'var(--red-band)' : 'var(--neutral-band)'} />
                {b.label && x1 - x0 > 14 ? (
                  <text className="band-label" x={x0 + 4} y={11}>
                    {b.label}
                  </text>
                ) : null}
              </g>
            );
          })}
          {yTicks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={0} x2={innerW} y1={ys(t)} y2={ys(t)} />
              <text className="tick-label" x={-8} y={ys(t)} dy="0.32em" textAnchor="end">
                {yFormat(t)}
              </text>
            </g>
          ))}
          <line className="baseline" x1={0} x2={innerW} y1={yInvert ? 0 : innerH} y2={yInvert ? 0 : innerH} />
          {xTicks.map((t) => (
            <text key={t} className="tick-label" x={xs(t)} y={innerH + 18} textAnchor="middle">
              {xFormat(t)}
            </text>
          ))}
          {props.xLabel ? (
            <text className="axis-title" x={innerW} y={innerH + 28} textAnchor="end" dy="-0.1em">
              {props.xLabel}
            </text>
          ) : null}
          {props.yLabel ? (
            <text className="axis-title" x={-M.left + 2} y={-4}>
              {props.yLabel}
            </text>
          ) : null}
          {(() => {
            // Stagger labels of nearby markers onto separate rows, and flip them left near the right edge.
            const placed: { x: number; w: number; row: number }[] = [];
            return markers.map((m, i) => {
              const mx = xs(m.x);
              const w = m.label.length * 6.4 + 8;
              const flip = mx + w > innerW;
              const x0 = flip ? mx - w : mx;
              let row = 0;
              while (placed.some((p) => p.row === row && x0 < p.x + p.w && p.x < x0 + w)) row++;
              placed.push({ x: x0, w, row });
              return (
                <g key={i}>
                  <line x1={mx} x2={mx} y1={0} y2={innerH} stroke="var(--accent)" strokeWidth={1} opacity={0.7} />
                  <text
                    className="band-label"
                    x={flip ? mx - 4 : mx + 4}
                    y={markerLabels === 'top' ? 12 + row * 14 : innerH - 6 - row * 14}
                    textAnchor={flip ? 'end' : 'start'}
                    style={{ fill: 'var(--accent-text)', paintOrder: 'stroke', stroke: 'var(--surface-1)', strokeWidth: 3, strokeLinejoin: 'round' }}
                  >
                    {m.label}
                  </text>
                </g>
              );
            });
          })()}
          {ordered.map((s) => {
            const dim = spot !== null && spot !== s.id;
            const emph = s.emphasis || spot === s.id;
            const colour = !anyEmph || emph ? s.colour : 'var(--series-muted)';
            const d = gen(s.values) ?? '';
            return (
              <path
                key={s.id}
                d={d}
                fill="none"
                stroke={colour}
                strokeWidth={emph ? 2 : 1.25}
                strokeDasharray={s.dashed ? '5 3' : undefined}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={dim ? 0.18 : emph || !anyEmph ? 1 : 0.55}
                onPointerEnter={() => setSpot(s.id)}
                onPointerLeave={() => setSpot(null)}
              />
            );
          })}
          {labels.map((l) => (
            <g key={l.id} opacity={spot !== null && spot !== l.id ? 0.25 : 1}>
              {Math.abs(l.ty - l.y) > 3 ? <line x1={l.x + 2} y1={l.y} x2={innerW + 6} y2={l.ty} stroke={l.colour} strokeWidth={1} opacity={0.6} /> : null}
              <circle cx={l.x} cy={l.y} r={3.5} fill={l.colour} stroke="var(--surface-1)" strokeWidth={2} />
              <text className="end-label" x={innerW + 8} y={l.ty} dy="0.32em">
                {l.text}
              </text>
            </g>
          ))}
          {hoverIdx !== null ? <line className="crosshair" x1={xs(x[hoverIdx]!)} x2={xs(x[hoverIdx]!)} y1={0} y2={innerH} /> : null}
          {hoverIdx !== null
            ? hoverRows.slice(0, 4).map((r) => (
                <circle key={r.s.id} cx={xs(x[hoverIdx]!)} cy={ys(clampY(r.v!))} r={4} fill={r.s.colour} stroke="var(--surface-1)" strokeWidth={2} />
              ))
            : null}
          <rect
            x={0}
            y={0}
            width={innerW}
            height={innerH}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHoverIdx(null)}
            style={{ cursor: 'crosshair' }}
          />
        </g>
      </svg>
      {hoverIdx !== null && hoverRows.length > 0 ? (
        <div
          className="tooltip"
          style={{ top: M.top + 6, left: tipOnLeft ? undefined : tipLeft + 14, right: tipOnLeft ? w - tipLeft + 14 : undefined }}
        >
          <div className="tt-title">{tooltipTitle(x[hoverIdx]!)}</div>
          {hoverRows.map((r) => (
            <div className="tt-row" key={r.s.id}>
              <span className="tt-val">{tooltipFormat(r.v!)}</span>
              <span className="tt-key" style={{ background: r.s.colour }} />
              <span className="tt-name">{r.s.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {legend && series.length > 1 ? (
        <div className="legend" style={{ padding: '6px 0 0' }}>
          {series
            .filter((s) => !anyEmph || s.emphasis)
            .map((s) => (
              <button
                key={s.id}
                type="button"
                className="legend-item"
                onPointerEnter={() => setSpot(s.id)}
                onPointerLeave={() => setSpot(null)}
                onFocus={() => setSpot(s.id)}
                onBlur={() => setSpot(null)}
              >
                <span className="legend-key" style={{ background: s.colour }} />
                {s.label}
              </button>
            ))}
          {anyEmph && series.some((s) => !s.emphasis) ? (
            <span className="legend-item" style={{ cursor: 'default' }}>
              <span className="legend-key" style={{ background: 'var(--series-muted)' }} />
              Everyone else
            </span>
          ) : null}
        </div>
      ) : null}
      {props.footnote ? <div className="faint" style={{ fontSize: 'var(--step--2)', marginTop: 6 }}>{props.footnote}</div> : null}
    </div>
  );
}
