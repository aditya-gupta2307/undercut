/**
 * Race-day weather forecasts from Open-Meteo (free for non-commercial use, no
 * key). Forecasts reach about 16 days ahead, so only races inside that window
 * get one; the request is skipped entirely otherwise.
 */

import { weatherQueue } from '../lib/http';

export interface HourlyForecast {
  /** Start of the hour, epoch ms (UTC). */
  at: number;
  tempC: number | null;
  /** Chance of more than 0.1 mm of rain in the hour, 0–1. */
  rainChance: number | null;
  rainMm: number | null;
  windKmh: number | null;
  code: number | null;
}

const DAY = 86_400_000;
/** Open-Meteo serves 16 forecast days including today; stay safely inside. */
export const FORECAST_HORIZON_MS = 15 * DAY;

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function openMeteoUrl(lat: number, lon: number, fromMs: number, toMs: number): string {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly: 'temperature_2m,precipitation_probability,precipitation,wind_speed_10m,weather_code',
    timezone: 'GMT',
    start_date: isoDate(fromMs),
    end_date: isoDate(toMs),
  });
  return `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Parse the hourly block. Times are "YYYY-MM-DDTHH:MM" in GMT. */
export function parseOpenMeteo(json: unknown): HourlyForecast[] {
  const hourly = (json as { hourly?: Record<string, unknown> } | null)?.hourly;
  if (!hourly || !Array.isArray(hourly.time)) return [];
  const col = (k: string): unknown[] => (Array.isArray(hourly[k]) ? (hourly[k] as unknown[]) : []);
  const temp = col('temperature_2m');
  const prob = col('precipitation_probability');
  const mm = col('precipitation');
  const wind = col('wind_speed_10m');
  const code = col('weather_code');
  const out: HourlyForecast[] = [];
  (hourly.time as unknown[]).forEach((t, i) => {
    if (typeof t !== 'string') return;
    const at = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : `${t}:00Z`);
    if (!Number.isFinite(at)) return;
    const p = num(prob[i]);
    out.push({ at, tempC: num(temp[i]), rainChance: p === null ? null : Math.max(0, Math.min(1, p / 100)), rainMm: num(mm[i]), windKmh: num(wind[i]), code: num(code[i]) });
  });
  return out.sort((a, b) => a.at - b.at);
}

/** Whether a forecast is worth requesting for a race starting at `raceStart`. */
export function forecastAvailable(raceStart: number, now: number): boolean {
  return raceStart + 3 * 3_600_000 > now && raceStart - now < FORECAST_HORIZON_MS;
}

/** Hourly forecast from two hours before the start to three hours after. */
export async function fetchRaceWeather(lat: number, lon: number, raceStart: number): Promise<HourlyForecast[]> {
  const from = raceStart - 2 * 3_600_000;
  const to = raceStart + 3 * 3_600_000;
  const rows = parseOpenMeteo(await weatherQueue.json<unknown>(openMeteoUrl(lat, lon, from, to)));
  return rows.filter((r) => r.at >= from - 3_600_000 && r.at <= to);
}

/** WMO weather codes in plain words. */
export function weatherLabel(code: number | null): string {
  if (code === null) return '–';
  if (code === 0) return 'Clear';
  if (code <= 2) return 'Partly cloudy';
  if (code === 3) return 'Overcast';
  if (code === 45 || code === 48) return 'Fog';
  if (code >= 51 && code <= 57) return 'Drizzle';
  if (code >= 61 && code <= 67) return 'Rain';
  if (code >= 71 && code <= 77) return 'Snow';
  if (code >= 80 && code <= 82) return 'Showers';
  if (code >= 95) return 'Thunderstorms';
  return 'Mixed';
}

export interface RaceWeatherSummary {
  atStart: HourlyForecast | null;
  /** Highest hourly rain chance from lights out to two hours later. */
  peakRainChance: number | null;
  /** Chance of at least one wet hour during the race, treating hours as independent-ish (upper bound: 1). */
  anyRainChance: number | null;
  tempRange: [number, number] | null;
}

export function summariseRaceWeather(rows: readonly HourlyForecast[], raceStart: number): RaceWeatherSummary {
  const startHour = Math.floor(raceStart / 3_600_000) * 3_600_000;
  const during = rows.filter((r) => r.at >= startHour && r.at < raceStart + 2 * 3_600_000);
  const atStart = rows.find((r) => r.at === startHour) ?? during[0] ?? null;
  const chances = during.map((r) => r.rainChance).filter((x): x is number => x !== null);
  const temps = during.map((r) => r.tempC).filter((x): x is number => x !== null);
  // Hourly chances are not independent; the highest hour is a floor and the
  // independent combination a ceiling. Report the midpoint, which reads sensibly.
  const peak = chances.length ? Math.max(...chances) : null;
  const independent = chances.length ? 1 - chances.reduce((p, c) => p * (1 - c), 1) : null;
  return {
    atStart,
    peakRainChance: peak,
    anyRainChance: peak === null || independent === null ? null : (peak + independent) / 2,
    tempRange: temps.length ? [Math.min(...temps), Math.max(...temps)] : null,
  };
}
