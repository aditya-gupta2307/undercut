/**
 * A circuit drawn from real car-position data (OpenF1 /location), not from an
 * image: the outline is one lap traced by an actual car, rotated so the long
 * axis lies flat. Optionally animates a "car" running laps around it.
 */

import { useEffect, useRef } from 'react';
import { useOutline, type Outline } from '../app/data';

interface TrackMapProps {
  circuitKey: number | null;
  height?: number;
  car?: boolean;
  label?: string;
  strokeWidth?: number;
  compact?: boolean;
}

export function outlinePath(o: Outline): string {
  return o.points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('') + 'Z';
}

export function TrackShape({ outline, car, strokeWidth = 14, label }: { outline: Outline; car?: boolean; strokeWidth?: number; label?: string }) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const dotRef = useRef<SVGCircleElement | null>(null);
  const pad = strokeWidth * 2;
  const d = outlinePath(outline);

  useEffect(() => {
    if (!car) return undefined;
    const path = pathRef.current;
    const dot = dotRef.current;
    if (!path || !dot) return undefined;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const len = path.getTotalLength();
    let raf = 0;
    const start = performance.now();
    const lapMs = 9000;
    const place = (t: number) => {
      const p = path.getPointAtLength(((t % lapMs) / lapMs) * len);
      dot.setAttribute('cx', String(p.x));
      dot.setAttribute('cy', String(p.y));
    };
    if (reduce) {
      place(0);
      return undefined;
    }
    const frame = (now: number) => {
      place(now - start);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [car, d]);

  return (
    <svg
      viewBox={`${-pad} ${-pad} ${outline.width + 2 * pad} ${outline.height + 2 * pad}`}
      width="100%"
      height="100%"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label ?? 'Circuit map'}
      className="track-svg"
    >
      <path d={d} fill="none" stroke="var(--line-strong)" strokeWidth={strokeWidth * 1.9} strokeLinejoin="round" strokeLinecap="round" />
      <path
        ref={pathRef}
        d={d}
        fill="none"
        stroke="var(--ink)"
        strokeWidth={strokeWidth * 0.45}
        strokeLinejoin="round"
        strokeLinecap="round"
        className="track-line"
        pathLength={1000}
      />
      {car ? <circle ref={dotRef} r={strokeWidth * 0.9} fill="var(--accent)" stroke="var(--surface-1)" strokeWidth={strokeWidth * 0.35} /> : null}
    </svg>
  );
}

export function TrackMap({ circuitKey, height = 220, car = false, label, strokeWidth, compact }: TrackMapProps) {
  const res = useOutline(circuitKey);
  const box = { height, display: 'grid', placeItems: 'center' } as const;
  if (circuitKey === null) return <div style={box} className="track-empty" />;
  if (res.loading) {
    return (
      <div style={box} className="track-loading" aria-label="Loading circuit map">
        <span className="faint" style={{ fontSize: 'var(--step--2)' }}>
          {compact ? '' : 'Tracing the circuit…'}
        </span>
      </div>
    );
  }
  if (!res.data) {
    return (
      <div style={box} className="track-empty">
        <span className="faint" style={{ fontSize: 'var(--step--2)', textAlign: 'center' }}>
          {compact ? 'No map yet' : 'No timing data from this circuit yet — the map appears after its first session.'}
        </span>
      </div>
    );
  }
  return (
    <div style={{ height }} className="track-wrap">
      <TrackShape outline={res.data} car={car} label={label} strokeWidth={strokeWidth} />
    </div>
  );
}
