/**
 * Data hooks and loaders shared by the pages.
 *
 * Three cache layers, cheapest first: an in-memory map (instant navigation),
 * localStorage (instant reloads, survives sessions), then the network through
 * the rate-limited queues. Stale data is shown while fresh data loads.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { readStored, writeStored, removeStored } from '../lib/storage';
import { loadSeason, peekSeason, isFresh } from '../data/season';
import {
  fetchDrivers,
  fetchLaps,
  fetchLocations,
  fetchMeetings,
  fetchPits,
  fetchRaceControl,
  fetchSessionResult,
  fetchSessions,
  fetchStartingGrid,
  fetchStints,
  fetchWeather,
} from '../data/openf1';
import type {
  F1Session,
  GridSlot,
  Lap,
  Meeting,
  PitStop,
  RaceControlMessage,
  Season,
  SessionDriver,
  SessionResultRow,
  Stint,
  WeatherSample,
} from '../data/types';

// ---------------------------------------------------------------------------
// Seasons
// ---------------------------------------------------------------------------

export interface SeasonState {
  season: Season | null;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
  reload: () => void;
}

interface SeasonSlot {
  year: number | null;
  season: Season | null;
  error: unknown;
  loading: boolean;
  refreshing: boolean;
}

function seasonSlot(year: number | null): SeasonSlot {
  const cached = year !== null ? peekSeason(year) : null;
  return { year, season: cached?.season ?? null, error: null, loading: year !== null && !cached, refreshing: false };
}

export function useSeasonData(year: number | null): SeasonState {
  // A manual reload applies to the year it was asked for, not to every later one.
  const [reloads, setReloads] = useState<{ year: number | null; n: number }>({ year, n: 0 });
  const forced = reloads.year === year ? reloads.n : 0;
  const [state, setState] = useState<SeasonSlot>(() => seasonSlot(year));

  useEffect(() => {
    if (year === null) {
      setState(seasonSlot(null));
      return undefined;
    }
    let alive = true;
    const cached = peekSeason(year);
    const stale = !cached || !isFresh(cached.season, cached.savedAt, Date.now()) || forced > 0;
    setState({ year, season: cached?.season ?? null, error: null, loading: !cached, refreshing: Boolean(cached) && stale });
    if (stale) {
      loadSeason(year, { force: true })
        .then((season) => {
          if (alive) setState({ year, season, error: null, loading: false, refreshing: false });
        })
        .catch((error: unknown) => {
          if (alive) setState((s) => ({ ...s, error, loading: false, refreshing: false }));
        });
    }
    return () => {
      alive = false;
    };
  }, [year, forced]);

  const reload = useCallback(() => setReloads((r) => ({ year, n: (r.year === year ? r.n : 0) + 1 })), [year]);
  // Never hand out another year's season, even for the one render before the effect catches up.
  const s = state.year === year ? state : seasonSlot(year);
  return { season: s.season, error: s.error, loading: s.loading, refreshing: s.refreshing, reload };
}

/**
 * The season before `year`, used as a prior by the models. `undefined` while
 * it is still loading (so models wait instead of fitting twice), `null` when
 * there is none or it could not be loaded.
 */
export function usePriorSeason(year: number | null): Season | null | undefined {
  const wanted = year !== null && year - 1 >= 2022 ? year - 1 : null;
  const prev = useSeasonData(wanted);
  if (wanted === null) return null;
  if (prev.season) return prev.season;
  return prev.loading ? undefined : null;
}

// ---------------------------------------------------------------------------
// Generic cached loader
// ---------------------------------------------------------------------------

interface CacheEntry {
  value?: unknown;
  error?: unknown;
  promise?: Promise<unknown>;
}

const memory = new Map<string, CacheEntry>();

/**
 * Load once per key and share the result between every component that asks.
 * `persist` also keeps the value in localStorage for `ttlMs` (Infinity = forever).
 */
export function cachedLoad<T>(key: string, loader: () => Promise<T>, persist?: { ttlMs: number }): Promise<T> {
  const hit = memory.get(key);
  if (hit?.value !== undefined) return Promise.resolve(hit.value as T);
  if (hit?.promise) return hit.promise as Promise<T>;
  if (persist) {
    const stored = readStored<T>('cache:' + key);
    if (stored && Date.now() - stored.savedAt < persist.ttlMs) {
      memory.set(key, { value: stored.value });
      return Promise.resolve(stored.value);
    }
  }
  const promise = loader().then(
    (value) => {
      memory.set(key, { value });
      // An empty answer may just mean "not published yet": never keep that forever.
      const empty = value === null || (Array.isArray(value) && value.length === 0);
      if (persist && !(empty && !Number.isFinite(persist.ttlMs))) writeStored('cache:' + key, value);
      return value;
    },
    (error: unknown) => {
      memory.delete(key);
      throw error;
    },
  );
  memory.set(key, { promise });
  return promise;
}

export function peekCached<T>(key: string): T | undefined {
  return memory.get(key)?.value as T | undefined;
}

export function forgetCached(key: string): void {
  memory.delete(key);
  removeStored('cache:' + key);
}

export interface Resource<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  reload: () => void;
}

/** React wrapper around cachedLoad. A null key means "not yet" (e.g. waiting on another load). */
export function useResource<T>(key: string | null, loader: () => Promise<T>, persist?: { ttlMs: number }): Resource<T> {
  const [token, setToken] = useState(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const [state, setState] = useState<{ key: string | null; data: T | null; error: unknown; loading: boolean }>(() => {
    const v = key ? peekCached<T>(key) : undefined;
    return { key, data: v ?? null, error: null, loading: Boolean(key) && v === undefined };
  });

  useEffect(() => {
    if (!key) {
      setState({ key, data: null, error: null, loading: false });
      return undefined;
    }
    let alive = true;
    const v = peekCached<T>(key);
    if (v !== undefined) {
      setState({ key, data: v, error: null, loading: false });
      return undefined;
    }
    setState({ key, data: null, error: null, loading: true });
    cachedLoad(key, () => loaderRef.current(), persist).then(
      (data) => alive && setState({ key, data, error: null, loading: false }),
      (error: unknown) => alive && setState({ key, data: null, error, loading: false }),
    );
    return () => {
      alive = false;
    };
    // `persist` is a static option per call site, so it is not a dependency.
  }, [key, token]);

  const reload = useCallback(() => {
    if (key) forgetCached(key);
    setToken((t) => t + 1);
  }, [key]);

  // Never return data that belongs to a previous key.
  if (state.key !== key) {
    const v = key ? peekCached<T>(key) : undefined;
    return { data: v ?? null, error: null, loading: Boolean(key) && v === undefined, reload };
  }
  return { data: state.data, error: state.error, loading: state.loading, reload };
}

// ---------------------------------------------------------------------------
// OpenF1 index (meetings + sessions for a year)
// ---------------------------------------------------------------------------

export interface F1Index {
  meetings: Meeting[];
  sessions: F1Session[];
}

const HOUR = 3_600_000;

/**
 * Cache key and lifetime for a per-year list. A past year's list is final and
 * kept forever — but under its own key, so a copy saved while the year was
 * still running (and possibly incomplete) is never mistaken for the final one.
 */
function perYear(prefix: string, year: number): { key: string; ttlMs: number; retire: () => void } {
  const final = year < new Date().getUTCFullYear();
  return {
    key: `${prefix}:${year}:${final ? 'final' : 'live'}`,
    ttlMs: final ? Number.POSITIVE_INFINITY : 6 * HOUR,
    // Once the final copy exists, the copy saved while the year was running is dead weight.
    retire: () => {
      if (final) forgetCached(`${prefix}:${year}:live`);
    },
  };
}

function sessionsFor(year: number): Promise<F1Session[]> {
  const slot = perYear('sessions:v2', year);
  return cachedLoad(slot.key, async () => {
    const sessions = await fetchSessions(year);
    slot.retire();
    return sessions;
  }, { ttlMs: slot.ttlMs });
}

export function useF1Index(year: number | null): Resource<F1Index> {
  const slot = year !== null && year >= 2023 ? perYear('f1index:v2', year) : null;
  return useResource<F1Index>(
    slot?.key ?? null,
    async () => {
      const meetingsSlot = perYear('meetings:v2', year!);
      const [meetings, sessions] = await Promise.all([
        cachedLoad(meetingsSlot.key, async () => {
          const list = await fetchMeetings(year!);
          meetingsSlot.retire();
          return list;
        }, { ttlMs: meetingsSlot.ttlMs }),
        sessionsFor(year!),
      ]);
      slot?.retire();
      return { meetings, sessions };
    },
    { ttlMs: slot?.ttlMs ?? 6 * HOUR },
  );
}

/** Every race session OpenF1 knows about (all years), for track outlines. */
export function loadAllRaceSessions(): Promise<F1Session[]> {
  return cachedLoad(
    'raceSessions:v2',
    async () => {
      const years: number[] = [];
      for (let y = 2023; y <= new Date().getUTCFullYear(); y++) years.push(y);
      const lists = await Promise.all(years.map(sessionsFor));
      return lists.flat().filter((s) => s.name === 'Race' && !s.cancelled);
    },
    { ttlMs: 6 * HOUR },
  );
}

// ---------------------------------------------------------------------------
// Race bundle: everything a completed race page needs from OpenF1
// ---------------------------------------------------------------------------

export interface RaceBundle {
  sessionKey: number;
  drivers: SessionDriver[];
  laps: Lap[];
  stints: Stint[];
  pits: PitStop[];
  raceControl: RaceControlMessage[];
  result: SessionResultRow[];
  grid: GridSlot[];
  weather: WeatherSample[];
}

export function useRaceBundle(session: F1Session | null): Resource<RaceBundle> {
  const done = session ? session.end + 30 * 60_000 < Date.now() : false;
  // Timing can be corrected for a while after a race; a day later it is final. The
  // two phases use different keys, so an early copy is never promoted to "final".
  const settled = session ? session.end + 24 * HOUR < Date.now() : false;
  return useResource<RaceBundle>(
    session && done ? `race:v2:${session.key}:${settled ? 'final' : 'live'}` : null,
    async () => {
      const k = session!.key;
      const [drivers, laps, stints, pits, raceControl, result, grid, weather] = await Promise.all([
        cachedLoad(`drivers:v1:${k}`, () => fetchDrivers(k), { ttlMs: Number.POSITIVE_INFINITY }),
        fetchLaps(k),
        fetchStints(k),
        fetchPits(k),
        fetchRaceControl(k),
        fetchSessionResult(k),
        fetchStartingGrid(k),
        fetchWeather(k),
      ]);
      if (laps.length === 0) {
        // Thrown, not returned, so an empty answer is retried rather than cached.
        throw new Error('OpenF1 has not published lap timing for this race yet — it usually appears within an hour or two of the flag.');
      }
      // The final copy supersedes any copy saved on race day.
      if (settled) forgetCached(`race:v2:${k}:live`);
      return { sessionKey: k, drivers, laps, stints, pits, raceControl, result, grid, weather };
    },
    { ttlMs: settled ? Number.POSITIVE_INFINITY : 15 * 60_000 },
  );
}

// ---------------------------------------------------------------------------
// Track outlines, drawn from real car positions
// ---------------------------------------------------------------------------

export interface Outline {
  /** Points normalised to a 1000-wide box, y down, rotated to lie flat. */
  points: [number, number][];
  width: number;
  height: number;
  sourceSession: number;
  /** Rotation and scale applied, so replays can map raw coordinates the same way. */
  transform: { cx: number; cy: number; cos: number; sin: number; scale: number; minX: number; minY: number };
}

/** Drivers who raced every season of the OpenF1 era; one is almost always on track. */
const PROBE_CARS = [16, 44, 63, 14, 55, 1, 4, 81, 10];

export function outlineFromSamples(samples: { x: number; y: number }[], sourceSession: number): Outline | null {
  // De-duplicate stationary samples.
  const pts: { x: number; y: number }[] = [];
  for (const p of samples) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 2) pts.push(p);
  }
  if (pts.length < 60) return null;
  // Cut a single lap: the first return close to the starting point after covering real distance.
  let travelled = 0;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  let end = pts.length;
  const start = pts[0]!;
  for (let i = 1; i < pts.length; i++) {
    travelled += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    if (travelled > total * 0.35 && Math.hypot(pts[i]!.x - start.x, pts[i]!.y - start.y) < Math.max(120, travelled * 0.01)) {
      end = i + 1;
      break;
    }
  }
  const lap = pts.slice(0, end);
  // Only a closed loop is a circuit: a window that ended mid-lap (a slow lap behind
  // the safety car, say) would draw a broken track, so reject it and try elsewhere.
  let perimeter = 0;
  for (let i = 1; i < lap.length; i++) perimeter += Math.hypot(lap[i]!.x - lap[i - 1]!.x, lap[i]!.y - lap[i - 1]!.y);
  const last = lap[lap.length - 1]!;
  if (Math.hypot(last.x - start.x, last.y - start.y) > Math.max(250, perimeter * 0.03)) return null;
  // Principal axis -> horizontal, so the track fills a wide box.
  const cx = lap.reduce((s, p) => s + p.x, 0) / lap.length;
  const cy = lap.reduce((s, p) => s + p.y, 0) / lap.length;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of lap) {
    sxx += (p.x - cx) ** 2;
    syy += (p.y - cy) ** 2;
    sxy += (p.x - cx) * (p.y - cy);
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  // Rotate, then flip y (data is y-up, the screen is y-down). Rotation keeps handedness.
  const rot = lap.map((p) => {
    const x = (p.x - cx) * cos - (p.y - cy) * sin;
    const y = (p.x - cx) * sin + (p.y - cy) * cos;
    return [x, -y] as [number, number];
  });
  const minX = Math.min(...rot.map((p) => p[0]));
  const maxX = Math.max(...rot.map((p) => p[0]));
  const minY = Math.min(...rot.map((p) => p[1]));
  const maxY = Math.max(...rot.map((p) => p[1]));
  const scale = 1000 / Math.max(1, maxX - minX);
  const points = rot.map(([x, y]) => [Math.round((x - minX) * scale * 10) / 10, Math.round((y - minY) * scale * 10) / 10] as [number, number]);
  return {
    points,
    width: 1000,
    height: Math.max(1, (maxY - minY) * scale),
    sourceSession,
    transform: { cx, cy, cos, sin, scale, minX, minY },
  };
}

/** Map a raw OpenF1 (x, y) into outline space. */
export function toOutlineSpace(o: Outline, x: number, y: number): [number, number] {
  const { cx, cy, cos, sin, scale, minX, minY } = o.transform;
  const rx = (x - cx) * cos - (y - cy) * sin;
  const ry = -((x - cx) * sin + (y - cy) * cos);
  return [(rx - minX) * scale, (ry - minY) * scale];
}

export async function loadOutline(circuitKey: number, before: number = Date.now()): Promise<Outline | null> {
  return cachedLoad(
    `outline:v2:${circuitKey}`,
    async () => {
      const races = (await loadAllRaceSessions())
        .filter((s) => s.circuitKey === circuitKey && s.end < before)
        .sort((a, b) => b.start - a.start);
      for (const race of races.slice(0, 2)) {
        for (const car of PROBE_CARS.slice(0, 3)) {
          // Fifteen minutes in: past the start chaos, normally before the stops.
          const from = race.start + 15 * 60_000;
          const samples = await fetchLocations(race.key, from, from + 150_000, car, 'low');
          const outline = outlineFromSamples(samples, race.key);
          if (outline) return outline;
        }
      }
      return null;
    },
    { ttlMs: Number.POSITIVE_INFINITY },
  );
}

export function useOutline(circuitKey: number | null): Resource<Outline | null> {
  return useResource<Outline | null>(circuitKey !== null && circuitKey >= 0 ? `outline-hook:${circuitKey}` : null, () => loadOutline(circuitKey!));
}

// ---------------------------------------------------------------------------
// Deferred heavy computation (model fits and simulations)
// ---------------------------------------------------------------------------

const computed = new Map<string, unknown>();
const COMPUTED_LIMIT = 40;

/**
 * Run an expensive pure function after the browser has painted, cache the
 * result by key, and report progress state. `compute` may be async.
 */
export function useComputed<T>(key: string | null, compute: () => T | Promise<T>): { value: T | null; computing: boolean; error: unknown } {
  const fnRef = useRef(compute);
  fnRef.current = compute;
  const [state, setState] = useState<{ key: string | null; value: T | null; computing: boolean; error: unknown }>(() => ({
    key,
    value: key && computed.has(key) ? (computed.get(key) as T) : null,
    computing: Boolean(key) && !computed.has(key!),
    error: null,
  }));

  useEffect(() => {
    if (!key) {
      setState({ key, value: null, computing: false, error: null });
      return undefined;
    }
    if (computed.has(key)) {
      setState({ key, value: computed.get(key) as T, computing: false, error: null });
      return undefined;
    }
    let alive = true;
    setState({ key, value: null, computing: true, error: null });
    const id = setTimeout(async () => {
      try {
        const value = await fnRef.current();
        computed.set(key, value);
        if (computed.size > COMPUTED_LIMIT) computed.delete(computed.keys().next().value as string);
        if (alive) setState({ key, value, computing: false, error: null });
      } catch (error) {
        if (alive) setState({ key, value: null, computing: false, error });
      }
    }, 16);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [key]);

  if (state.key !== key) {
    return { value: key && computed.has(key) ? (computed.get(key) as T) : null, computing: Boolean(key) && !computed.has(key!), error: null };
  }
  return { value: state.value, computing: state.computing, error: state.error };
}

/** Re-render every `ms` milliseconds (for countdowns). */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Width of an element, tracked with ResizeObserver. */
export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w !== undefined) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

/** Stable memo for objects derived from inputs (thin wrapper for readability). */
export const useDerived = useMemo;
