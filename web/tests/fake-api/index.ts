/**
 * Entry point for the fake APIs: a fetch-compatible function that answers
 * requests to api.jolpi.ca and api.openf1.org from the synthetic world.
 * Used by the Node integration tests and by the Playwright e2e suite.
 */

import { handleJolpica } from './jolpica';
import { handleOpenF1 } from './openf1';
import { buildWorld, type World } from './world';

export { buildWorld };
export type { World };

export interface FakeResponse {
  status: number;
  body: string;
  contentType: string;
}

export function respond(world: World, rawUrl: string): FakeResponse | null {
  const url = new URL(rawUrl);
  let res: { status: number; body: unknown } | null = null;
  if (url.hostname === 'api.jolpi.ca') res = handleJolpica(world, url);
  else if (url.hostname === 'api.openf1.org') res = handleOpenF1(world, url);
  else if (url.hostname === 'api.open-meteo.com') res = handleOpenMeteo(url);
  if (!res) return null;
  return { status: res.status, body: JSON.stringify(res.body), contentType: 'application/json' };
}

/** A deterministic stand-in for the Open-Meteo hourly forecast. */
function handleOpenMeteo(url: URL): { status: number; body: unknown } {
  const start = url.searchParams.get('start_date');
  const end = url.searchParams.get('end_date');
  const lat = Number(url.searchParams.get('latitude'));
  const lon = Number(url.searchParams.get('longitude'));
  if (!start || !end || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { status: 400, body: { error: true, reason: 'Missing or invalid parameters' } };
  }
  const a = Date.parse(start + 'T00:00:00Z');
  const b = Date.parse(end + 'T00:00:00Z') + 86_400_000;
  const time: string[] = [];
  const temp: number[] = [];
  const prob: number[] = [];
  const mm: number[] = [];
  const wind: number[] = [];
  const code: number[] = [];
  for (let t = a; t < b; t += 3_600_000) {
    const h = new Date(t).getUTCHours();
    const s = Math.abs(Math.sin(lat * 12.9898 + lon * 78.233 + (t / 3_600_000) * 0.37));
    time.push(new Date(t).toISOString().slice(0, 16));
    temp.push(Number((26 + 5 * Math.sin(((h - 9) / 24) * 2 * Math.PI)).toFixed(1)));
    const p = Math.round(15 + 55 * s);
    prob.push(p);
    mm.push(p > 55 ? Number((s * 1.4).toFixed(1)) : 0);
    wind.push(Number((7 + 12 * s).toFixed(1)));
    code.push(p > 55 ? 61 : p > 35 ? 3 : 1);
  }
  return {
    status: 200,
    body: {
      latitude: lat,
      longitude: lon,
      timezone: 'GMT',
      hourly_units: { time: 'iso8601', temperature_2m: '°C', precipitation_probability: '%', precipitation: 'mm', wind_speed_10m: 'km/h', weather_code: 'wmo code' },
      hourly: { time, temperature_2m: temp, precipitation_probability: prob, precipitation: mm, wind_speed_10m: wind, weather_code: code },
    },
  };
}

/** A drop-in fetch for Node tests. Counts requests per host. */
export function fakeFetch(world: World, counter?: Map<string, number>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const host = new URL(u).hostname;
    counter?.set(host, (counter.get(host) ?? 0) + 1);
    const r = respond(world, u);
    if (!r) return new Response('blocked in tests', { status: 599 });
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.contentType } });
  }) as typeof fetch;
}
