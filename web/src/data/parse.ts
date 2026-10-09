/**
 * Total conversion helpers for API strings. They never throw: one malformed
 * field must not take a page down, so bad input becomes null.
 */

const ISO =
  /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?)?\s*(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/**
 * Parse an ISO-8601 timestamp to epoch ms, treating a missing zone as UTC.
 *
 * Written by hand because OpenF1 sends six-digit fractional seconds
 * ("13:59:07.606000+00:00"), which is outside the format Date.parse is required
 * to accept — some browsers return NaN for it.
 */
export function parseIso(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = ISO.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0', frac = '', zone] = m;
  const ms = frac ? Number((frac + '00').slice(0, 3)) : 0;
  let t = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s), ms);
  if (zone && zone.toUpperCase() !== 'Z') {
    const sign = zone.startsWith('-') ? -1 : 1;
    const digits = zone.slice(1).replace(':', '');
    const offH = Number(digits.slice(0, 2));
    const offM = Number(digits.slice(2, 4) || '0');
    t -= sign * (offH * 60 + offM) * 60_000;
  }
  return Number.isFinite(t) ? t : null;
}

/** Combine Jolpica's separate "2026-03-08" + "04:00:00Z" fields. */
export function combineDateTime(date: unknown, time: unknown): number | null {
  if (typeof date !== 'string' || !date) return null;
  if (typeof time !== 'string' || !time) return null;
  const t = time.trim().replace(/z$/i, '');
  return parseIso(`${date}T${t}Z`);
}

/**
 * "1:29.179" -> 89179, "23.456" -> 23456, "1:32:15.742" -> 5535742.
 * A leading "+" (gap notation) is ignored. Empty strings and junk -> null.
 */
export function durationToMs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 1000) : null;
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^\+/, '');
  if (!text) return null;
  const m = /^(?:(\d+):)?(?:(\d{1,2}):)?(\d{1,3})(?:\.(\d{1,3}))?$/.exec(text);
  if (!m) return null;
  const first = m[1];
  const second = m[2];
  const sec = Number(m[3]);
  const frac = m[4] ? Number(m[4].padEnd(3, '0')) : 0;
  // Two leading groups mean h:mm:ss; one means m:ss.
  const hours = first !== undefined && second !== undefined ? Number(first) : 0;
  const minutes = second !== undefined ? Number(second) : first !== undefined ? Number(first) : 0;
  return (hours * 3600 + minutes * 60 + sec) * 1000 + frac;
}

export function toInt(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export function toFloat(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Seconds (number) to integer ms; null-safe. */
export function secondsToMs(value: unknown): number | null {
  const s = toFloat(value);
  return s === null ? null : Math.round(s * 1000);
}

/** "+1 LAP" / "+3 LAPS" -> 1 / 3; anything else -> 0. */
export function lapsDown(value: unknown): number {
  if (typeof value !== 'string') return 0;
  const m = /^\+?\s*(\d+)\s*LAPS?$/i.exec(value.trim());
  return m ? Number(m[1]) : 0;
}

export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? fallback : String(value);
}

/** OpenF1 colours arrive as "3671C6" (no hash) and occasionally as null. */
export function hexColour(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().replace(/^#/, '');
  return /^[0-9a-f]{6}$/i.test(v) ? `#${v.toUpperCase()}` : null;
}
