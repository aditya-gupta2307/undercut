/**
 * Reliability diagram: forecast probability (x) against how often it came
 * true (y). Points on the diagonal are perfectly calibrated; whiskers are 95%
 * Wilson intervals, so sparse bins show how little they prove.
 */

import { useState } from 'react';
import { scaleLinear } from 'd3-scale';
import { useWidth } from '../../app/data';
import { pct } from '../../lib/format';
import type { CalibrationBin } from '../../model/metrics';

export function CalibrationChart({ bins, label }: { bins: CalibrationBin[]; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const M = { top: 12, right: 16, bottom: 40, left: 48 };
  const w = Math.max(260, Math.min(520, width));
  const inner = w - M.left - M.right;
  const h = inner + M.top + M.bottom;
  const x = scaleLinear().domain([0, 1]).range([0, inner]);
  const y = scaleLinear().domain([0, 1]).range([inner, 0]);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const used = bins.filter((b) => b.n > 0);
  const maxN = Math.max(1, ...used.map((b) => b.n));
  const hb = hover !== null ? used[hover] : null;

  return (
    <div className="chart" ref={ref} style={{ position: 'relative' }}>
      <svg width={w} height={h} role="img" aria-label={`Calibration of ${label} forecasts: predicted probability against observed frequency`}>
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line className="gridline" x1={0} x2={inner} y1={y(t)} y2={y(t)} />
              <line className="gridline" x1={x(t)} x2={x(t)} y1={0} y2={inner} />
              <text className="tick-label" x={-8} y={y(t)} dy="0.32em" textAnchor="end">
                {Math.round(t * 100)}%
              </text>
              <text className="tick-label" x={x(t)} y={inner + 16} textAnchor="middle">
                {Math.round(t * 100)}%
              </text>
            </g>
          ))}
          <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--ink-3)" strokeDasharray="4 4" strokeWidth={1} />
          <text className="tick-label" x={x(0.62)} y={y(0.62) - 8} transform={`rotate(-45 ${x(0.62)} ${y(0.62) - 8})`} textAnchor="middle">
            perfect calibration
          </text>
          {used.map((b, i) => {
            const cx = x(b.meanPredicted);
            const r = 4 + 6 * Math.sqrt(b.n / maxN);
            return (
              <g key={i} onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} style={{ cursor: 'default' }}>
                <line x1={cx} x2={cx} y1={y(b.ciLow)} y2={y(b.ciHigh)} stroke="var(--accent)" strokeWidth={2} opacity={0.55} />
                <circle cx={cx} cy={y(b.observed)} r={r} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={2} />
                <circle cx={cx} cy={y(b.observed)} r={Math.max(14, r + 6)} fill="transparent" />
              </g>
            );
          })}
          <text className="axis-title" x={inner / 2} y={inner + 34} textAnchor="middle">
            Forecast probability
          </text>
          <text className="axis-title" transform={`translate(${-36},${inner / 2}) rotate(-90)`} textAnchor="middle">
            How often it happened
          </text>
        </g>
      </svg>
      {hb ? (
        <div className="tooltip" style={{ left: Math.min(M.left + x(hb.meanPredicted) + 14, w - 220), top: M.top + y(hb.observed) - 10 }}>
          <strong>
            Forecasts of {pct(hb.lo, 0)}–{pct(Math.min(1, hb.hi), 0)}
          </strong>
          <div>
            {hb.n.toLocaleString()} forecasts, averaging {pct(hb.meanPredicted)}
          </div>
          <div>
            Happened {pct(hb.observed)} of the time (95% range {pct(hb.ciLow)}–{pct(hb.ciHigh)})
          </div>
        </div>
      ) : null}
    </div>
  );
}
