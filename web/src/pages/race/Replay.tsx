/**
 * Race replay: every car on the real circuit, lap by lap, rebuilt from the
 * timing data. The circuit is traced from one car's position samples during
 * this very race (one request), so the start line and scale are exact; the
 * cars themselves move by their recorded line crossings.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { outlineFromSamples, useResource, useWidth, type Outline, type RaceBundle, type Resource } from '../../app/data';
import { useSettings, SURFACE } from '../../app/settings';
import { useTeams } from '../../app/teams';
import { fetchLocations, fetchTeamRadio } from '../../data/openf1';
import type { F1Session, RaceEvent, Season, TeamRadio } from '../../data/types';
import { lapTime } from '../../lib/format';
import { buildRaceTiming, isCleanLap, orderAtLap, type RaceTiming } from '../../model/raceTiming';
import {
  buildReplay,
  compoundAt,
  PIT_FRAC,
  fastestLapAt,
  leaderLapAt,
  statusAt,
  towerAt,
  type TowerRow,
  type TrackStatus,
} from '../../model/replay';
import { Empty, ErrorNotice, Lights, Panel, Toggle, TyreBadge } from '../../components/ui';
import { Term, RookieNote } from '../../components/Term';
import { carDirectory, type CarInfo } from './raceContext';

interface Props {
  season: Season;
  event: RaceEvent;
  session: F1Session;
  bundle: Resource<RaceBundle>;
}

export default function Replay({ season, event, session, bundle }: Props) {
  if (bundle.error) return <ErrorNotice error={bundle.error} onRetry={bundle.reload} what="lap timing" />;
  if (bundle.loading || !bundle.data) return <Lights label="Downloading lap timing" />;
  if (!bundle.data.laps.length) return <Empty>OpenF1 has no lap timing for this race, so there is nothing to replay.</Empty>;
  return <ReplayInner season={season} event={event} session={session} data={bundle.data} />;
}

// ---------------------------------------------------------------------------
// Track geometry
// ---------------------------------------------------------------------------

interface Geometry {
  pts: [number, number][];
  cum: Float64Array;
  total: number;
  /** +1 if the inside of the circuit is to the left of the direction of travel. */
  inside: number;
  width: number;
  height: number;
}

function geometryFrom(o: Outline): Geometry {
  const pts = o.points;
  const cum = new Float64Array(pts.length + 1);
  for (let i = 1; i <= pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i % pts.length]!;
    cum[i] = cum[i - 1]! + Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % pts.length]!;
    area += a[0] * b[1] - b[0] * a[1];
  }
  return { pts, cum, total: cum[pts.length]!, inside: area > 0 ? 1 : -1, width: o.width, height: o.height };
}

/** Point and unit tangent at fraction f (0–1) of the lap. */
function pointAt(g: Geometry, f: number): { x: number; y: number; tx: number; ty: number } {
  const s = (((f % 1) + 1) % 1) * g.total;
  let lo = 0;
  let hi = g.pts.length;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (g.cum[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const a = g.pts[lo]!;
  const b = g.pts[(lo + 1) % g.pts.length]!;
  const seg = g.cum[lo + 1]! - g.cum[lo]! || 1;
  const k = (s - g.cum[lo]!) / seg;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return { x: a[0] + dx * k, y: a[1] + dy * k, tx: dx / len, ty: dy / len };
}

async function loadReplayOutline(sessionKey: number, timing: RaceTiming, preferred: number[]): Promise<Outline | null> {
  const tried = new Set<number>();
  for (const car of [...preferred, ...timing.drivers]) {
    if (tried.has(car) || tried.size >= 3) continue;
    tried.add(car);
    const cross = timing.crossing.get(car);
    if (!cross) continue;
    const done = timing.lapsCompleted.get(car) ?? 0;
    let lap = -1;
    for (let L = 3; L <= done; L++) {
      if (isCleanLap(timing, car, L) && !Number.isNaN(cross[L - 1]!) && !Number.isNaN(cross[L]!)) {
        lap = L;
        break;
      }
    }
    if (lap < 0) continue;
    const samples = await fetchLocations(sessionKey, cross[lap - 1]!, cross[lap]! + 1500, car, 'high');
    const outline = outlineFromSamples(samples, sessionKey);
    if (outline) return outline;
  }
  // Not cached: position data can appear a little after the timing data does.
  throw new Error('No car position data for this race yet.');
}

// ---------------------------------------------------------------------------

const SPEEDS = [1, 5, 10, 20, 50];

function raceClock(ms: number): string {
  const neg = ms < 0;
  const s = Math.floor(Math.abs(ms) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
  return neg ? `−${body}` : body;
}

const STATUS_LABEL: Record<TrackStatus, string> = { GREEN: '', SC: 'SAFETY CAR', VSC: 'VIRTUAL SC', RED: 'RED FLAG', CHEQUERED: 'CHEQUERED FLAG' };

interface Moment {
  at: number;
  label: string;
  kind: 'lead' | 'sc' | 'vsc' | 'red' | 'start' | 'finish';
}

function ReplayInner({ season, event, session, data }: { season: Season; event: RaceEvent; session: F1Session; data: RaceBundle }) {
  const { colour } = useTeams();
  const { resolvedTheme } = useSettings();
  const results = season.results[event.round] ?? [];
  const timing = useMemo(() => buildRaceTiming(data.laps, data.pits, data.raceControl, data.result), [data]);
  const cars = useMemo(() => carDirectory(data.drivers, results, season, colour, SURFACE[resolvedTheme]), [data, results, season, colour, resolvedTheme]);
  const gridOrder = useMemo(() => {
    if (data.grid.length) return data.grid.map((g) => g.driverNumber);
    return [...results].filter((r) => r.carNumber !== null).sort((a, b) => (a.grid || 99) - (b.grid || 99)).map((r) => r.carNumber!);
  }, [data, results]);
  const finishOrder = useMemo(() => {
    const fromResults = [...results].sort((a, b) => a.order - b.order).map((r) => r.carNumber).filter((n): n is number => n !== null);
    return fromResults.length ? fromResults : data.result.map((r) => r.driverNumber);
  }, [results, data]);
  const model = useMemo(
    () => buildReplay({ timing, laps: data.laps, pits: data.pits, raceControl: data.raceControl, gridOrder, result: data.result }),
    [timing, data, gridOrder],
  );

  // Teammates share a colour: the second car of a team is drawn as a ring.
  const secondary = useMemo(() => {
    const out = new Set<number>();
    const byColour = new Map<string, number[]>();
    for (const c of cars.values()) byColour.set(c.colour, [...(byColour.get(c.colour) ?? []), c.number]);
    for (const nums of byColour.values()) nums.sort((a, b) => a - b).slice(1).forEach((n) => out.add(n));
    return out;
  }, [cars]);

  const outlineRes = useResource<Outline | null>(`replay-outline:v1:${session.key}`, () => loadReplayOutline(session.key, timing, finishOrder.slice(0, 3)), {
    ttlMs: Number.POSITIVE_INFINITY,
  });
  const geometry = useMemo(() => (outlineRes.data ? geometryFrom(outlineRes.data) : null), [outlineRes.data]);

  const moments = useMemo<Moment[]>(() => {
    const out: Moment[] = [{ at: model.start - 4000, label: 'Lights out', kind: 'start' }];
    let prevLeader: number | null = null;
    for (let L = 1; L <= timing.totalLaps; L++) {
      const lead = orderAtLap(timing, L)[0];
      if (lead === undefined) continue;
      if (prevLeader !== null && lead !== prevLeader) {
        const at = model.leaderCrossing[L] ?? model.start;
        out.push({ at: at - 8000, label: `L${L} · ${cars.get(lead)?.code ?? lead} leads`, kind: 'lead' });
      }
      prevLeader = lead;
    }
    for (const s of model.status) {
      if (s.status === 'SC' || s.status === 'VSC' || s.status === 'RED') {
        const lap = leaderLapAt(model, s.at);
        out.push({ at: s.at - 3000, label: `L${lap} · ${s.status === 'RED' ? 'Red flag' : s.status === 'SC' ? 'Safety car' : 'Virtual SC'}`, kind: s.status === 'RED' ? 'red' : s.status === 'SC' ? 'sc' : 'vsc' });
      }
    }
    const fin = model.leaderCrossing[model.totalLaps];
    if (fin !== undefined && Number.isFinite(fin)) out.push({ at: fin - 10_000, label: 'The finish', kind: 'finish' });
    return out.sort((a, b) => a.at - b.at);
  }, [model, timing, cars]);

  // Playback state. The animation reads refs; React state mirrors them a few times a second.
  const begin = model.start - 15_000;
  const timeRef = useRef(begin);
  const [uiTime, setUiTime] = useState(begin);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(20);
  const [labels, setLabels] = useState<'top' | 'all' | 'off'>('top');
  const [focus, setFocus] = useState<number | null>(null);
  const [radioOn, setRadioOn] = useState(false);

  const seek = useCallback(
    (t: number) => {
      const v = Math.max(begin, Math.min(model.end, t));
      timeRef.current = v;
      setUiTime(v);
    },
    [begin, model.end],
  );

  const [stageRef, stageWidth] = useWidth<HTMLDivElement>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const aspect = geometry ? (geometry.height + 80) / (geometry.width + 80) : 0.55;
  const cssW = Math.max(280, Math.floor(stageWidth));
  const cssH = Math.round(Math.max(260, Math.min(560, cssW * aspect)));

  // Everything the draw loop needs, refreshed every render without restarting it.
  const drawRef = useRef<() => void>(() => undefined);
  drawRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!geometry) return;
    const css = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
    const surface = v('--surface-1', '#11161c');
    const road = v('--surface-3', '#1f2731');
    const kerb = v('--line-strong', '#2f3947');
    const ink = v('--ink', '#eaeff4');
    const ink3 = v('--ink-3', '#727d8b');
    const accent = v('--accent', '#ffb21e');

    const pad = 40;
    const scale = Math.min((cssW - 2 * pad) / geometry.width, (cssH - 2 * pad) / Math.max(1, geometry.height));
    const ox = (cssW - geometry.width * scale) / 2;
    const oy = (cssH - geometry.height * scale) / 2;
    const X = (x: number) => ox + x * scale;
    const Y = (y: number) => oy + y * scale;

    // The circuit.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    geometry.pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
    ctx.closePath();
    ctx.strokeStyle = kerb;
    ctx.lineWidth = 16;
    ctx.stroke();
    ctx.strokeStyle = road;
    ctx.lineWidth = 12;
    ctx.stroke();

    // Pit lane, alongside the line on the inside.
    const PIT = PIT_FRAC;
    const off = 13;
    ctx.beginPath();
    for (let k = 0; k <= 20; k++) {
      const f = -PIT + (2 * PIT * k) / 20;
      const p = pointAt(geometry, f);
      const nx = -p.ty * geometry.inside;
      const ny = p.tx * geometry.inside;
      const px = X(p.x) + nx * off;
      const py = Y(p.y) + ny * off;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = kerb;
    ctx.lineWidth = 5;
    ctx.setLineDash([]);
    ctx.stroke();

    // Start / finish line, chequered.
    {
      const p = pointAt(geometry, 0);
      const nx = -p.ty;
      const ny = p.tx;
      for (let k = -3; k < 3; k++) {
        ctx.fillStyle = k % 2 === 0 ? '#ffffff' : '#111111';
        const cx = X(p.x) + nx * (k + 0.5) * 2.4;
        const cy = Y(p.y) + ny * (k + 0.5) * 2.4;
        ctx.fillRect(cx - 1.4, cy - 1.4, 2.8, 2.8);
      }
    }

    const t = timeRef.current;
    const tower = towerAt(model, timing, t, finishOrder);
    const top = new Set(tower.filter((r) => r.visible).slice(0, 3).map((r) => r.driver));
    const states = tower.filter((r) => r.visible);
    // Draw from the back of the field forwards, so the leaders sit on top; focus last.
    const ordered = [...states].reverse().sort((a, b) => (a.driver === focus ? 1 : 0) - (b.driver === focus ? 1 : 0));
    // Labels are placed after the cars, nudged outwards until they stop overlapping.
    const pendingLabels: { text: string; x: number; y: number; nx: number; ny: number; focus: boolean; faded: boolean }[] = [];
    for (const s of ordered) {
      const car = cars.get(s.driver);
      const p = pointAt(geometry, s.progress);
      let x = X(p.x);
      let y = Y(p.y);
      const nx = -p.ty * geometry.inside;
      const ny = p.tx * geometry.inside;
      if (s.phase === 'pit') {
        x += nx * off;
        y += ny * off;
      } else if (s.phase === 'grid') {
        const side = s.position % 2 === 0 ? -1 : 1;
        x += nx * 4 * side;
        y += ny * 4 * side;
      }
      const isFocus = focus === s.driver;
      const dim = focus !== null && !isFocus;
      const r = isFocus ? 8.5 : 6.5;
      ctx.globalAlpha = s.phase === 'finished' ? 0.55 : dim ? 0.5 : 1;
      if (isFocus) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = car?.colour ?? '#888';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = surface;
      ctx.stroke();
      if (secondary.has(s.driver)) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
        ctx.fillStyle = surface;
        ctx.fill();
      }
      const showLabel = labels === 'all' || isFocus || (labels === 'top' && top.has(s.driver));
      if (showLabel) pendingLabels.push({ text: car?.code ?? String(s.driver), x, y, nx, ny, focus: isFocus, faded: s.phase === 'finished' });
      ctx.globalAlpha = 1;
    }
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    // Focused label first so it always gets the closest spot.
    pendingLabels.sort((a, b) => Number(b.focus) - Number(a.focus));
    for (const l of pendingLabels) {
      ctx.font = `600 ${l.focus ? 12 : 11}px "IBM Plex Mono", ui-monospace, monospace`;
      const w = ctx.measureText(l.text).width;
      const h = 12;
      let lx = 0;
      let ly = 0;
      for (let k = 0; k < 6; k++) {
        const d = 13 + k * 11;
        // Outward from the car: the normal points inside the circuit, so go the other way.
        // Keep labels inside the canvas.
        lx = Math.max(3, Math.min(cssW - w - 3, l.x - l.nx * d - w / 2));
        ly = Math.max(h + 2, Math.min(cssH - 4, l.y - l.ny * d + 4));
        const box = { x: lx - 2, y: ly - h, w: w + 4, h: h + 3 };
        if (!boxes.some((b) => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h)) break;
      }
      boxes.push({ x: lx - 2, y: ly - h, w: w + 4, h: h + 3 });
      ctx.lineWidth = 3;
      ctx.strokeStyle = surface;
      ctx.strokeText(l.text, lx, ly);
      ctx.fillStyle = l.faded ? ink3 : ink;
      ctx.fillText(l.text, lx, ly);
    }
  };

  // Animation loop: only runs while playing; paused frames are drawn on demand.
  useEffect(() => {
    if (!playing) return undefined;
    let raf = 0;
    let last = performance.now();
    let lastUi = 0;
    const tick = (now: number) => {
      const dt = Math.min(250, now - last);
      last = now;
      timeRef.current = Math.min(model.end, timeRef.current + dt * speed);
      if (timeRef.current >= model.end) {
        setUiTime(model.end);
        setPlaying(false);
        drawRef.current();
        return;
      }
      if (now - lastUi > 200) {
        lastUi = now;
        setUiTime(timeRef.current);
      }
      drawRef.current();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      setUiTime(timeRef.current);
    };
  }, [playing, speed, model.end]);

  // Redraw once when paused state changes (time, focus, labels, size, theme).
  useEffect(() => {
    drawRef.current();
  }, [uiTime, focus, labels, cssW, cssH, geometry, resolvedTheme]);

  const tower = useMemo(() => towerAt(model, timing, uiTime, finishOrder), [model, timing, uiTime, finishOrder]);
  const status = statusAt(model, uiTime);
  const lap = leaderLapAt(model, uiTime);
  const fastest = fastestLapAt(model, uiTime);
  const clockMs = uiTime - model.start;

  const onKey = (e: ReactKeyboardEvent) => {
    // Only when the stage itself has focus: buttons, the slider and menus keep their own keys.
    if (e.target !== e.currentTarget) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seek(timeRef.current + (e.shiftKey ? 60_000 : 10_000));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seek(timeRef.current - (e.shiftKey ? 60_000 : 10_000));
    }
  };

  const togglePlay = () => {
    if (!playing && timeRef.current >= model.end) seek(begin);
    setPlaying((p) => !p);
  };

  const messages = useMemo(() => data.raceControl.filter((m) => m.at <= uiTime && m.at >= model.start - 30 * 60_000).slice(-8).reverse(), [data.raceControl, uiTime, model.start]);

  return (
    <div className="stack" style={{ gap: 16 }}>
      <RookieNote>
        Press play to watch the race unfold on the real circuit. Every dot is a car in its team colour (the second car of each team has a hollow centre). Click a
        driver in the timing tower to follow them. Positions come from the official line-crossing times, so the order is exact at every crossing.
      </RookieNote>
      <div className="replay">
        <div className="stack" style={{ gap: 14, minWidth: 0 }}>
          <div className="replay-stage" tabIndex={0} onKeyDown={onKey} aria-label="Race replay. Space to play or pause, arrow keys to skip.">
            <div ref={stageRef} style={{ position: 'relative' }}>
              {outlineRes.loading ? (
                <div style={{ height: cssH }}>
                  <Lights label="Tracing the circuit from car positions" />
                </div>
              ) : !geometry ? (
                <div style={{ height: cssH, display: 'grid', placeItems: 'center', padding: 20 }}>
                  <span className="faint" style={{ textAlign: 'center' }}>
                    {outlineRes.error ? 'Could not load car positions to draw the circuit.' : 'No position data for this race, so the circuit cannot be drawn.'} The timing
                    tower still replays the race.
                  </span>
                </div>
              ) : (
                <canvas ref={canvasRef} style={{ height: cssH }} role="img" aria-label={`Track map of ${event.circuit.name} with every car's position`} />
              )}
              <div className="replay-hud" aria-live="off">
                <span className="replay-lap">{uiTime < model.start ? 'GRID' : `LAP ${lap}/${model.totalLaps}`}</span>
                <span className="num faint">{raceClock(clockMs)}</span>
                {status !== 'GREEN' ? <span className={`replay-flag ${status === 'SC' ? 'sc' : status === 'VSC' ? 'vsc' : status === 'RED' ? 'red' : 'chq'}`}>{STATUS_LABEL[status]}</span> : null}
              </div>
              {fastest ? (
                <div className="replay-fl">
                  <span className="purple">◆</span> Fastest lap <strong>{cars.get(fastest.driver)?.code ?? fastest.driver}</strong>{' '}
                  <span className="num purple">{lapTime(fastest.ms)}</span> <span className="faint">L{fastest.lap}</span>
                </div>
              ) : null}
            </div>
            <div className="replay-controls">
              <button className="btn btn-sm btn-primary" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'} style={{ minWidth: 76 }}>
                {playing ? '❚❚ Pause' : uiTime >= model.end ? '↺ Again' : '▶ Play'}
              </button>
              <button className="btn btn-sm" onClick={() => seek(timeRef.current - 30_000)} aria-label="Back 30 seconds">
                −30s
              </button>
              <button className="btn btn-sm" onClick={() => seek(timeRef.current + 30_000)} aria-label="Forward 30 seconds">
                +30s
              </button>
              <input
                type="range"
                min={begin}
                max={model.end}
                step={1000}
                value={uiTime}
                onChange={(e) => seek(Number(e.target.value))}
                aria-label="Race time"
                aria-valuetext={`Lap ${lap}, ${raceClock(clockMs)}`}
              />
              <label className="faint" style={{ fontSize: 'var(--step--1)' }}>
                Speed{' '}
                <select className="select" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed">
                  {SPEEDS.map((s) => (
                    <option key={s} value={s}>
                      {s}×
                    </option>
                  ))}
                </select>
              </label>
              <label className="faint" style={{ fontSize: 'var(--step--1)' }}>
                Labels{' '}
                <select className="select" value={labels} onChange={(e) => setLabels(e.target.value as 'top' | 'all' | 'off')} aria-label="Car labels">
                  <option value="top">Top 3</option>
                  <option value="all">All</option>
                  <option value="off">Off</option>
                </select>
              </label>
            </div>
          </div>

          <div className="row" style={{ flexWrap: 'wrap', gap: 6 }} aria-label="Key moments">
            <span className="faint" style={{ fontSize: 'var(--step--1)', marginRight: 4 }}>
              Jump to
            </span>
            {moments.map((m, i) => (
              <button key={i} className="pick-chip" onClick={() => seek(m.at)}>
                <span className={`flag ${m.kind === 'sc' ? 'flag-SC' : m.kind === 'vsc' ? 'flag-YELLOW' : m.kind === 'red' ? 'flag-RED' : m.kind === 'finish' ? 'flag-CHEQUERED' : m.kind === 'lead' ? 'flag-NONE' : 'flag-GREEN'}`} aria-hidden="true" />
                {m.label}
              </button>
            ))}
          </div>

          <div className="grid">
            <Panel className="span-7" title="Race control" sub="Messages up to this moment, newest first" flush>
              {messages.length ? (
                <ul className="ticker" aria-label="Race control messages">
                  {messages.map((m, i) => (
                    <li key={`${m.at}-${i}`} className={uiTime - m.at < 20_000 ? 'fresh' : ''}>
                      <span className="num faint">{m.lap !== null ? `L${m.lap}` : ''}</span>
                      <span>{m.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Nothing from race control yet.</Empty>
              )}
            </Panel>
            <Panel
              className="span-5"
              title="Team radio"
              sub="Clips broadcast during the race"
              actions={
                <Toggle on={radioOn} onChange={setRadioOn} title="Load the list of radio clips">
                  Load
                </Toggle>
              }
            >
              {radioOn ? <RadioList sessionKey={session.key} now={uiTime} cars={cars} start={model.start} /> : <div className="faint" style={{ fontSize: 'var(--step--1)' }}>Off by default to save requests. Switch on to hear the radio as it happened.</div>}
            </Panel>
          </div>
        </div>

        <TimingTower rows={tower} cars={cars} secondary={secondary} focus={focus} onFocus={(d) => setFocus((f) => (f === d ? null : d))} stints={data.stints} lap={lap} total={model.totalLaps} />
      </div>
      <p className="faint" style={{ fontSize: 'var(--step--2)' }}>
        Between line crossings each car is assumed to run at an even pace; time lost in a <Term id="pit-stop">pit stop</Term> is placed in the pit lane. Keyboard:
        space plays or pauses, arrows skip 10 s (shift for a minute).
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function TimingTower({
  rows,
  cars,
  secondary,
  focus,
  onFocus,
  stints,
  lap,
  total,
}: {
  rows: TowerRow[];
  cars: Map<number, CarInfo>;
  secondary: Set<number>;
  focus: number | null;
  onFocus: (d: number) => void;
  stints: RaceBundle['stints'];
  lap: number;
  total: number;
}) {
  return (
    <div className="tower" aria-label="Timing tower">
      <div className="tower-head">
        <span>Lap {lap}/{total}</span>
        <span className="faint">
          <Term id="gap">Gap</Term>
        </span>
      </div>
      {rows.map((r) => {
        const car = cars.get(r.driver);
        const stint = compoundAt(stints, r.driver, Math.max(1, r.lap + 1));
        const gapText =
          r.phase === 'grid'
            ? ''
            : r.phase === 'out'
              ? 'OUT'
              : r.phase === 'pit'
                ? 'PIT'
                : r.position === 1
                  ? r.phase === 'finished'
                    ? '🏁'
                    : 'Leader'
                  : r.lapsDown > 0
                    ? `+${r.lapsDown} LAP${r.lapsDown > 1 ? 'S' : ''}`
                    : r.gapMs !== null
                      ? `+${(r.gapMs / 1000).toFixed(1)}`
                      : '';
        const battle = r.intervalMs !== null && r.intervalMs < 1000 && r.phase === 'running' && r.position > 1;
        return (
          <button
            key={r.driver}
            type="button"
            className={`tower-row ${r.phase === 'out' ? 'out' : ''} ${focus === r.driver ? 'focus' : ''} ${battle ? 'battle' : ''}`}
            onClick={() => onFocus(r.driver)}
            aria-pressed={focus === r.driver}
            title={`${car?.name ?? r.driver}${battle ? ' — within a second of the car ahead' : ''}`}
          >
            <span className="tpos">{r.position}</span>
            <span className={`tbar ${secondary.has(r.driver) ? 'ring' : ''}`} style={{ background: car?.colour ?? '#888', borderColor: car?.colour ?? '#888' }} />
            <span className="tcode">{car?.code ?? r.driver}</span>
            <span className={`tgap ${r.phase === 'pit' ? 'pit' : ''}`}>{gapText}</span>
            <span>{stint && r.phase !== 'out' ? <TyreBadge compound={stint.compound} /> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

function RadioList({ sessionKey, now, cars, start }: { sessionKey: number; now: number; cars: Map<number, CarInfo>; start: number }) {
  const res = useResource<TeamRadio[]>(`radio:v1:${sessionKey}`, () => fetchTeamRadio(sessionKey), { ttlMs: Number.POSITIVE_INFINITY });
  if (res.loading) return <Lights label="Fetching radio clips" />;
  if (res.error) return <ErrorNotice error={res.error} onRetry={res.reload} what="team radio" />;
  const clips = (res.data ?? []).filter((c) => c.at <= now).slice(-6).reverse();
  if (!res.data?.length) return <Empty>No radio clips were published for this race.</Empty>;
  if (!clips.length) return <Empty>No radio yet at this point of the race — {res.data.length} clips to come.</Empty>;
  return (
    <ul className="radio-list">
      {clips.map((c) => {
        const car = cars.get(c.driverNumber);
        return (
          <li key={`${c.at}-${c.driverNumber}`}>
            <div className="row" style={{ gap: 8 }}>
              <span className="driver-tag">
                <span className="bar" style={{ background: car?.colour ?? '#888' }} />
                <span className="code">{car?.code ?? c.driverNumber}</span>
              </span>
              <span className="num faint">{raceClock(c.at - start)}</span>
            </div>
            <audio controls preload="none" src={c.url} aria-label={`Radio from ${car?.name ?? c.driverNumber}`} />
          </li>
        );
      })}
      <li className="faint" style={{ fontSize: 'var(--step--2)' }}>
        Audio © Formula 1, streamed from the official timing service.
      </li>
    </ul>
  );
}
